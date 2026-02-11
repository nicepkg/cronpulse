import { Hono } from 'hono';
import type { Env, CheckConfig } from '../types';
import { now } from '../utils/time';
import { sendEmail, htmlEmail } from '../services/email';
import { signWebhookPayload } from '../utils/webhook-sign';

const ping = new Hono<{ Bindings: Env }>();

ping.all('/:checkId', async (c) => {
  const checkId = c.req.param('checkId');
  const timestamp = now();

  // Respond immediately, process in background
  c.executionCtx.waitUntil(recordPing(checkId, timestamp, c.env, c.req.header('CF-Connecting-IP') || ''));

  return c.text('OK', 200, { 'X-CronPulse': '1' });
});

async function recordPing(checkId: string, timestamp: number, env: Env, sourceIp: string) {
  // Step 1: Read check config (KV -> D1 fallback)
  let check: CheckConfig | null = null;

  try {
    const cached = await env.KV.get(`check:${checkId}`, 'json');
    if (cached) {
      check = cached as CheckConfig;
    }
  } catch {
    // KV failure, fall back to D1
  }

  if (!check) {
    try {
      const row = await env.DB.prepare(
        'SELECT id, period, grace, status, user_id FROM checks WHERE id = ?'
      ).bind(checkId).first<CheckConfig>();
      if (!row) return; // Unknown check, silently ignore
      check = row;
    } catch {
      // D1 also failed, silently accept the ping
      return;
    }
  }

  if (check.status === 'paused') return;

  // Step 2: Check if recovering from down state
  const wasDown = check.status === 'down';

  // Step 3: Write to D1
  try {
    const batch = [
      env.DB.prepare(
        'INSERT INTO pings (check_id, timestamp, source_ip, type) VALUES (?, ?, ?, ?)'
      ).bind(checkId, timestamp, sourceIp, 'success'),
      env.DB.prepare(
        `UPDATE checks SET
          last_ping_at = ?,
          next_expected_at = ? + period,
          status = 'up',
          ping_count = ping_count + 1,
          updated_at = ?
        WHERE id = ?`
      ).bind(timestamp, timestamp, timestamp, checkId),
    ];
    await env.DB.batch(batch);
  } catch {
    // D1 write failed, ping already accepted
    return;
  }

  // Step 4: If recovering from down, send recovery notification
  if (wasDown) {
    try {
      await sendRecoveryAlerts(checkId, check.user_id, env, timestamp);
    } catch {
      // Alert failure shouldn't affect ping acceptance
    }
  }

  // Step 5: Update KV cache
  try {
    await env.KV.put(`check:${checkId}`, JSON.stringify({
      ...check,
      status: 'up',
      last_ping_at: timestamp,
    }), { expirationTtl: 300 });
  } catch {
    // KV write failure is acceptable
  }
}

async function sendRecoveryAlerts(checkId: string, userId: string, env: Env, timestamp: number) {
  const check = await env.DB.prepare(
    'SELECT id, name, user_id FROM checks WHERE id = ?'
  ).bind(checkId).first();
  if (!check) return;

  // Get channels linked to this check, or default channels
  const channels = await env.DB.prepare(`
    SELECT ch.* FROM channels ch
    INNER JOIN check_channels cc ON ch.id = cc.channel_id
    WHERE cc.check_id = ?
    UNION
    SELECT ch.* FROM channels ch
    WHERE ch.user_id = ? AND ch.is_default = 1
    AND ch.id NOT IN (SELECT channel_id FROM check_channels WHERE check_id = ?)
  `).bind(checkId, userId, checkId).all();

  if (!channels.results.length) {
    // No channels configured, try sending to user email
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    if (user) {
      await sendAlertEmail(
        env,
        user.email as string,
        `[CronPulse] ${(check as any).name} is back UP`,
        `Your check "${(check as any).name}" has recovered and is now reporting as UP.`,
        (check as any).name,
        `${env.APP_URL}/dashboard/checks/${checkId}`
      );
    }
    return;
  }

  // Get user's webhook signing secret
  const hasWebhookChannel = channels.results.some((ch: any) => ch.kind === 'webhook');
  let signingSecret = '';
  if (hasWebhookChannel) {
    const userRow = await env.DB.prepare('SELECT webhook_signing_secret FROM users WHERE id = ?').bind(userId).first();
    signingSecret = (userRow?.webhook_signing_secret as string) || '';
  }

  for (const channel of channels.results) {
    const ch = channel as any;
    try {
      if (ch.kind === 'email') {
        await sendAlertEmail(
          env,
          ch.target,
          `[CronPulse] ${(check as any).name} is back UP`,
          `Your check "${(check as any).name}" has recovered and is now reporting as UP.`,
          (check as any).name,
          `${env.APP_URL}/dashboard/checks/${checkId}`
        );
      } else if (ch.kind === 'webhook') {
        const body = JSON.stringify({
          event: 'check.up',
          check: { id: checkId, name: (check as any).name },
          timestamp,
        });
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (signingSecret) {
          headers['X-CronPulse-Signature'] = await signWebhookPayload(body, signingSecret);
        }
        await fetch(ch.target, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        });
      } else if (ch.kind === 'slack') {
        const detailUrl = `${env.APP_URL}/dashboard/checks/${checkId}`;
        await fetch(ch.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `✅ ${(check as any).name} is back UP`,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: `✅ ${(check as any).name} is back UP`, emoji: true },
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Status:*\n🟢 Recovered` },
                  { type: 'mrkdwn', text: `*Recovered At:*\n${new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC` },
                ],
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View Details', emoji: true },
                    url: detailUrl,
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
        });
      }
      await env.DB.prepare(
        'INSERT INTO alerts (check_id, channel_id, type, status, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(checkId, ch.id, 'recovery', 'sent', timestamp, timestamp).run();
    } catch (e) {
      const shouldRetry = ch.kind === 'webhook' || ch.kind === 'slack';
      await env.DB.prepare(
        'INSERT INTO alerts (check_id, channel_id, type, status, error, created_at, retry_count, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      ).bind(checkId, ch.id, 'recovery', 'failed', String(e), timestamp, shouldRetry ? timestamp + 30 : null).run();
    }
  }
}

async function sendAlertEmail(env: Env, to: string, subject: string, text: string, checkName?: string, detailUrl?: string) {
  await sendEmail(env, {
    to,
    subject,
    text,
    html: htmlEmail({
      title: subject,
      heading: checkName ? `${checkName} is back UP` : subject,
      body: `<p style="margin:0;color:#059669"><strong>Your check has recovered and is now reporting as UP.</strong></p>`,
      ctaUrl: detailUrl,
      ctaText: detailUrl ? 'View Check Details' : undefined,
    }),
  });
}

export default ping;
