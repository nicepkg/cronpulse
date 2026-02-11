import type { Env } from '../types';
import { now } from '../utils/time';
import { signWebhookPayload } from '../utils/webhook-sign';

const MAX_RETRIES = 3;

export async function retryFailedAlerts(env: Env) {
  const timestamp = now();

  // Find failed alerts that are due for retry (webhook and slack only — email uses Resend which has its own retry)
  const failedAlerts = await env.DB.prepare(`
    SELECT a.id, a.check_id, a.channel_id, a.type, a.retry_count, a.error,
           ch.kind, ch.target,
           c.name as check_name, c.user_id, c.period, c.last_ping_at, c.status as check_status
    FROM alerts a
    INNER JOIN channels ch ON a.channel_id = ch.id
    INNER JOIN checks c ON a.check_id = c.id
    WHERE a.status = 'failed'
      AND a.retry_count < ?
      AND (a.next_retry_at IS NULL OR a.next_retry_at <= ?)
      AND ch.kind IN ('webhook', 'slack')
    ORDER BY a.created_at ASC
    LIMIT 50
  `).bind(MAX_RETRIES, timestamp).all();

  if (!failedAlerts.results.length) return;

  for (const alert of failedAlerts.results) {
    const a = alert as any;
    try {
      await retrySend(env, a, timestamp);
      // Success — mark as sent
      await env.DB.prepare(
        'UPDATE alerts SET status = ?, sent_at = ?, retry_count = ?, next_retry_at = NULL, error = NULL WHERE id = ?'
      ).bind('sent', timestamp, a.retry_count + 1, a.id).run();
    } catch (e) {
      const nextRetry = a.retry_count + 1;
      if (nextRetry >= MAX_RETRIES) {
        // Max retries reached — mark as permanently failed
        await env.DB.prepare(
          'UPDATE alerts SET retry_count = ?, error = ?, next_retry_at = NULL WHERE id = ?'
        ).bind(nextRetry, `retry exhausted: ${String(e)}`, a.id).run();
      } else {
        // Schedule next retry with exponential backoff: 30s, 120s, 480s
        const backoff = 30 * Math.pow(4, nextRetry);
        await env.DB.prepare(
          'UPDATE alerts SET retry_count = ?, next_retry_at = ?, error = ? WHERE id = ?'
        ).bind(nextRetry, timestamp + backoff, String(e), a.id).run();
      }
    }
  }
}

async function retrySend(env: Env, alert: any, timestamp: number) {
  // Get user's webhook signing secret if needed
  let signingSecret = '';
  if (alert.kind === 'webhook') {
    const user = await env.DB.prepare('SELECT webhook_signing_secret FROM users WHERE id = ?').bind(alert.user_id).first();
    signingSecret = (user?.webhook_signing_secret as string) || '';
  }

  if (alert.kind === 'webhook') {
    const event = alert.type === 'recovery' ? 'check.up' : 'check.down';
    const body = JSON.stringify({
      event,
      check: {
        id: alert.check_id,
        name: alert.check_name,
        status: alert.type === 'recovery' ? 'up' : 'down',
        last_ping_at: alert.last_ping_at,
        period: alert.period,
      },
      timestamp,
      retry: alert.retry_count + 1,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signingSecret) {
      headers['X-CronPulse-Signature'] = await signWebhookPayload(body, signingSecret);
    }
    const resp = await fetch(alert.target, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
  } else if (alert.kind === 'slack') {
    const isRecovery = alert.type === 'recovery';
    const emoji = isRecovery ? '\u2705' : '\uD83D\uDEA8';
    const statusText = isRecovery ? 'back UP' : 'DOWN';
    const resp = await fetch(alert.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${emoji} ${alert.check_name} is ${statusText} (retry ${alert.retry_count + 1}/${MAX_RETRIES})`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
  }
}
