import { Hono } from 'hono';
import type { Env, CheckConfig } from '../types';
import { now } from '../utils/time';
import { sendEmail, htmlEmail } from '../services/email';
import { signWebhookPayload } from '../utils/webhook-sign';

const ping = new Hono<{ Bindings: Env }>();

// Standard success ping: /ping/:checkId
ping.all('/:checkId', async (c) => {
  const checkId = c.req.param('checkId');
  const timestamp = now();

  c.executionCtx.waitUntil(recordPing(checkId, timestamp, c.env, c.req.header('CF-Connecting-IP') || '', 'success'));

  return c.text('OK', 200, { 'X-CronPulse': '1' });
});

// Start signal: /ping/:checkId/start — marks job as "running"
ping.all('/:checkId/start', async (c) => {
  const checkId = c.req.param('checkId');
  const timestamp = now();

  c.executionCtx.waitUntil(recordPing(checkId, timestamp, c.env, c.req.header('CF-Connecting-IP') || '', 'start'));

  return c.text('OK', 200, { 'X-CronPulse': '1' });
});

// Fail signal: /ping/:checkId/fail — marks job as "failed"
ping.all('/:checkId/fail', async (c) => {
  const checkId = c.req.param('checkId');
  const timestamp = now();

  c.executionCtx.waitUntil(recordPing(checkId, timestamp, c.env, c.req.header('CF-Connecting-IP') || '', 'fail'));

  return c.text('OK', 200, { 'X-CronPulse': '1' });
});

async function recordPing(checkId: string, timestamp: number, env: Env, sourceIp: string, pingType: 'success' | 'start' | 'fail') {
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

  // Handle different ping types
  if (pingType === 'start') {
    // Start signal: record the ping, update last_started_at, but don't reset the timer fully
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO pings (check_id, timestamp, source_ip, type) VALUES (?, ?, ?, ?)'
        ).bind(checkId, timestamp, sourceIp, 'start'),
        env.DB.prepare(
          `UPDATE checks SET last_started_at = ?, ping_count = ping_count + 1, updated_at = ? WHERE id = ?`
        ).bind(timestamp, timestamp, checkId),
      ]);
    } catch {
      // Write failed, ping already accepted
    }
    return;
  }

  if (pingType === 'fail') {
    // Fail signal: record the ping and immediately mark as down
    const wasDown = check.status === 'down';
    try {
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO pings (check_id, timestamp, source_ip, type) VALUES (?, ?, ?, ?)'
        ).bind(checkId, timestamp, sourceIp, 'fail'),
        env.DB.prepare(
          `UPDATE checks SET status = 'down', last_ping_at = ?, last_alert_at = ?, alert_count = alert_count + 1, ping_count = ping_count + 1, updated_at = ? WHERE id = ?`
        ).bind(timestamp, timestamp, timestamp, checkId),
      ]);
    } catch {
      return;
    }

    // Send down alert (only if wasn't already down)
    if (!wasDown) {
      try {
        await sendFailAlerts(checkId, check.user_id, env, timestamp);
      } catch {
        // Alert failure shouldn't affect ping acceptance
      }
    }

    // Update KV cache
    try {
      await env.KV.put(`check:${checkId}`, JSON.stringify({
        ...check,
        status: 'down',
        last_ping_at: timestamp,
      }), { expirationTtl: 300 });
    } catch {}
    return;
  }

  // Standard success ping
  const wasDown = check.status === 'down';

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
    return;
  }

  // If recovering from down, send recovery notification
  if (wasDown) {
    try {
      await sendRecoveryAlerts(checkId, check.user_id, env, timestamp);
    } catch {
      // Alert failure shouldn't affect ping acceptance
    }
  }

  // Update KV cache
  try {
    await env.KV.put(`check:${checkId}`, JSON.stringify({
      ...check,
      status: 'up',
      last_ping_at: timestamp,
    }), { expirationTtl: 300 });
  } catch {}
}

async function sendFailAlerts(checkId: string, userId: string, env: Env, timestamp: number) {
  const check = await env.DB.prepare(
    'SELECT id, name, user_id, period, grace, last_ping_at FROM checks WHERE id = ?'
  ).bind(checkId).first();
  if (!check) return;

  const channels = await env.DB.prepare(`
    SELECT ch.* FROM channels ch
    INNER JOIN check_channels cc ON ch.id = cc.channel_id
    WHERE cc.check_id = ?
    UNION
    SELECT ch.* FROM channels ch
    WHERE ch.user_id = ? AND ch.is_default = 1
    AND ch.id NOT IN (SELECT channel_id FROM check_channels WHERE check_id = ?)
  `).bind(checkId, userId, checkId).all();

  const hasWebhookChannel = channels.results.some((ch: any) => ch.kind === 'webhook');
  let signingSecret = '';
  if (hasWebhookChannel) {
    const user = await env.DB.prepare('SELECT webhook_signing_secret FROM users WHERE id = ?').bind(userId).first();
    signingSecret = (user?.webhook_signing_secret as string) || '';
  }

  if (!channels.results.length) {
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first();
    if (user) {
      await sendAlertEmail(
        env,
        user.email as string,
        `[CronPulse] ${(check as any).name} FAILED`,
        `Your check "${(check as any).name}" reported a failure signal.`,
        (check as any).name,
        `${env.APP_URL}/dashboard/checks/${checkId}`,
        true,
      );
    }
    return;
  }

  for (const channel of channels.results) {
    const ch = channel as any;
    try {
      if (ch.kind === 'email') {
        await sendAlertEmail(
          env,
          ch.target,
          `[CronPulse] ${(check as any).name} FAILED`,
          `Your check "${(check as any).name}" reported a failure signal.`,
          (check as any).name,
          `${env.APP_URL}/dashboard/checks/${checkId}`,
          true,
        );
      } else if (ch.kind === 'webhook') {
        const body = JSON.stringify({
          event: 'check.fail',
          check: { id: checkId, name: (check as any).name, status: 'down' },
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
            text: `🚨 ${(check as any).name} FAILED`,
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: `🚨 ${(check as any).name} FAILED`, emoji: true },
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Status:*\n🔴 Failed (explicit signal)` },
                  { type: 'mrkdwn', text: `*Time:*\n${new Date(timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC` },
                ],
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'View Details', emoji: true },
                    url: detailUrl,
                    style: 'danger',
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
      ).bind(checkId, ch.id, 'down', 'sent', timestamp, timestamp).run();
    } catch (e) {
      const shouldRetry = ch.kind === 'webhook' || ch.kind === 'slack';
      await env.DB.prepare(
        'INSERT INTO alerts (check_id, channel_id, type, status, error, created_at, retry_count, next_retry_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
      ).bind(checkId, ch.id, 'down', 'failed', String(e), timestamp, shouldRetry ? timestamp + 30 : null).run();
    }
  }
}

async function sendRecoveryAlerts(checkId: string, userId: string, env: Env, timestamp: number) {
  const check = await env.DB.prepare(
    'SELECT id, name, user_id FROM checks WHERE id = ?'
  ).bind(checkId).first();
  if (!check) return;

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

async function sendAlertEmail(env: Env, to: string, subject: string, text: string, checkName?: string, detailUrl?: string, isFail?: boolean) {
  const heading = isFail
    ? `${checkName || 'Check'} FAILED`
    : checkName
    ? `${checkName} is back UP`
    : subject;
  const bodyHtml = isFail
    ? `<p style="margin:0;color:#dc2626"><strong>Your check reported an explicit failure signal.</strong></p>`
    : `<p style="margin:0;color:#059669"><strong>Your check has recovered and is now reporting as UP.</strong></p>`;

  await sendEmail(env, {
    to,
    subject,
    text,
    html: htmlEmail({
      title: subject,
      heading,
      body: bodyHtml,
      ctaUrl: detailUrl,
      ctaText: detailUrl ? 'View Check Details' : undefined,
    }),
  });
}

export default ping;
