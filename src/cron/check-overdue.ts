import type { Env } from '../types';
import { now, isInMaintSchedule } from '../utils/time';
import { sendEmail, htmlEmail } from '../services/email';

export async function checkOverdue(env: Env) {
  const timestamp = now();
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const overdueChecks = await env.DB.prepare(`
      SELECT c.id, c.name, c.user_id, c.period, c.grace, c.last_ping_at, c.maint_schedule
      FROM checks c
      WHERE c.status IN ('up', 'new')
        AND c.next_expected_at IS NOT NULL
        AND (c.next_expected_at + c.grace) < ?
        AND (c.maint_start IS NULL OR c.maint_end IS NULL OR ? NOT BETWEEN c.maint_start AND c.maint_end)
      LIMIT ? OFFSET ?
    `).bind(timestamp, timestamp, batchSize, offset).all();

    if (!overdueChecks.results.length) break;

    await processOverdueChecks(overdueChecks.results, env, timestamp);
    offset += batchSize;

    // Safety valve: max 5000 per cycle
    if (offset >= 5000) break;
  }
}

async function processOverdueChecks(checks: any[], env: Env, timestamp: number) {
  for (const check of checks) {
    try {
      // Skip if in recurring maintenance schedule
      if (check.maint_schedule && isInMaintSchedule(check.maint_schedule, timestamp)) {
        continue;
      }

      // Mark check as down
      await env.DB.prepare(
        `UPDATE checks SET status = 'down', last_alert_at = ?, alert_count = alert_count + 1, updated_at = ? WHERE id = ?`
      ).bind(timestamp, timestamp, check.id).run();

      // Update KV cache
      try {
        await env.KV.delete(`check:${check.id}`);
      } catch {
        // KV failure acceptable
      }

      // Get notification channels
      const channels = await env.DB.prepare(`
        SELECT ch.* FROM channels ch
        INNER JOIN check_channels cc ON ch.id = cc.channel_id
        WHERE cc.check_id = ?
        UNION
        SELECT ch.* FROM channels ch
        WHERE ch.user_id = ? AND ch.is_default = 1
        AND ch.id NOT IN (SELECT channel_id FROM check_channels WHERE check_id = ?)
      `).bind(check.id, check.user_id, check.id).all();

      if (!channels.results.length) {
        // Fallback: send to user's email
        const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(check.user_id).first();
        if (user) {
          await sendDownAlert(env, check, { kind: 'email', target: user.email as string, id: null }, timestamp);
        }
        continue;
      }

      // Send alerts to all channels
      for (const channel of channels.results) {
        await sendDownAlert(env, check, channel as any, timestamp);
      }
    } catch (e) {
      console.error(`Error processing overdue check ${check.id}:`, e);
    }
  }
}

async function sendDownAlert(
  env: Env,
  check: any,
  channel: { kind: string; target: string; id: string | null },
  timestamp: number
) {
  try {
    if (channel.kind === 'email') {
      const lastPing = check.last_ping_at ? new Date(check.last_ping_at * 1000).toISOString() : 'never';
      const detailUrl = `${env.APP_URL}/dashboard/checks/${check.id}`;
      await sendEmail(env, {
        to: channel.target,
        subject: `[CronPulse] ${check.name} is DOWN`,
        text: `Your check "${check.name}" has not reported in on time.\n\nExpected ping every ${formatPeriod(check.period)} with ${formatPeriod(check.grace)} grace period.\n\nLast ping: ${lastPing}\n\nView details: ${detailUrl}`,
        html: htmlEmail({
          title: `${check.name} is DOWN`,
          heading: `${check.name} is DOWN`,
          body: `
            <p style="margin:0 0 12px"><strong style="color:#dc2626">Your check has not reported in on time.</strong></p>
            <table style="width:100%;font-size:13px;color:#374151">
              <tr><td style="padding:4px 0;color:#6b7280">Check</td><td style="padding:4px 0;font-weight:600">${check.name}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Expected every</td><td style="padding:4px 0">${formatPeriod(check.period)}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Grace period</td><td style="padding:4px 0">${formatPeriod(check.grace)}</td></tr>
              <tr><td style="padding:4px 0;color:#6b7280">Last ping</td><td style="padding:4px 0">${lastPing}</td></tr>
            </table>`,
          ctaUrl: detailUrl,
          ctaText: 'View Check Details',
        }),
      });
    } else if (channel.kind === 'webhook') {
      await fetch(channel.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'check.down',
          check: {
            id: check.id,
            name: check.name,
            status: 'down',
            last_ping_at: check.last_ping_at,
            period: check.period,
          },
          timestamp,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } else if (channel.kind === 'slack') {
      const lastPingText = check.last_ping_at ? new Date(check.last_ping_at * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : 'never';
      const detailUrl = `${env.APP_URL}/dashboard/checks/${check.id}`;
      await fetch(channel.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `🚨 ${check.name} is DOWN`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: `🚨 ${check.name} is DOWN`, emoji: true },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Status:*\n🔴 Down` },
                { type: 'mrkdwn', text: `*Last Ping:*\n${lastPingText}` },
                { type: 'mrkdwn', text: `*Expected Every:*\n${formatPeriod(check.period)}` },
                { type: 'mrkdwn', text: `*Grace Period:*\n${formatPeriod(check.grace)}` },
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

    if (channel.id) {
      await env.DB.prepare(
        'INSERT INTO alerts (check_id, channel_id, type, status, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(check.id, channel.id, 'down', 'sent', timestamp, timestamp).run();
    }
  } catch (e) {
    console.error(`Failed to send alert for ${check.id} via ${channel.kind}:`, e);
    if (channel.id) {
      await env.DB.prepare(
        'INSERT INTO alerts (check_id, channel_id, type, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(check.id, channel.id, 'down', 'failed', String(e), timestamp).run();
    }
  }
}

function formatPeriod(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
