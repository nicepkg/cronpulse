import type { Env } from '../types';
import { now } from '../utils/time';

export async function cleanupAndSync(env: Env) {
  const timestamp = now();

  // Self-healing migrations: add columns if missing
  try { await env.DB.prepare('ALTER TABLE checks ADD COLUMN maint_start INTEGER DEFAULT NULL').run(); } catch {}
  try { await env.DB.prepare('ALTER TABLE checks ADD COLUMN maint_end INTEGER DEFAULT NULL').run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE checks ADD COLUMN maint_schedule TEXT NOT NULL DEFAULT ''").run(); } catch {}
  try { await env.DB.prepare("ALTER TABLE users ADD COLUMN webhook_signing_secret TEXT NOT NULL DEFAULT ''").run(); } catch {}

  // Clean up expired auth tokens
  await env.DB.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(timestamp).run();

  // Clean up expired sessions
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(timestamp).run();

  // Clean up old pings for free users (>7 days)
  const sevenDaysAgo = timestamp - 7 * 86400;
  await env.DB.prepare(`
    DELETE FROM pings WHERE check_id IN (
      SELECT c.id FROM checks c
      INNER JOIN users u ON c.user_id = u.id
      WHERE u.plan = 'free'
    ) AND timestamp < ?
  `).bind(sevenDaysAgo).run();
}
