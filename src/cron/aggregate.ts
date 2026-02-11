import type { Env } from '../types';
import { now } from '../utils/time';

export async function aggregateStats(env: Env) {
  const timestamp = now();

  // Clean up old pings for starter users (>30 days)
  const thirtyDaysAgo = timestamp - 30 * 86400;
  await env.DB.prepare(`
    DELETE FROM pings WHERE check_id IN (
      SELECT c.id FROM checks c
      INNER JOIN users u ON c.user_id = u.id
      WHERE u.plan = 'starter'
    ) AND timestamp < ?
  `).bind(thirtyDaysAgo).run();

  // Clean up old pings for pro users (>90 days)
  const ninetyDaysAgo = timestamp - 90 * 86400;
  await env.DB.prepare(`
    DELETE FROM pings WHERE check_id IN (
      SELECT c.id FROM checks c
      INNER JOIN users u ON c.user_id = u.id
      WHERE u.plan = 'pro'
    ) AND timestamp < ?
  `).bind(ninetyDaysAgo).run();

  // Clean up old alerts (>90 days for all)
  await env.DB.prepare('DELETE FROM alerts WHERE created_at < ?').bind(ninetyDaysAgo).run();
}
