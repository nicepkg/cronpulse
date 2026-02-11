import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, User, Check } from '../types';
import { generateCheckId } from '../utils/id';
import { now } from '../utils/time';
import { rateLimit } from '../middleware/rate-limit';
import { parseCronExpression } from '../utils/cron-parser';

type ApiEnv = { Bindings: Env; Variables: { user: User } };
const api = new Hono<ApiEnv>();

function parseTags(input: string | string[] | undefined | null): string {
  if (!input) return '';
  const raw = Array.isArray(input) ? input.join(',') : input;
  const tags = raw
    .split(',')
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0);
  return [...new Set(tags)].join(',');
}

// CORS for API consumers
api.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));

// API key auth middleware
api.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header. Use: Bearer YOUR_API_KEY' }, 401);
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return c.json({ error: 'API key is empty' }, 401);
  }

  // Hash the API key and look up the user
  const hash = await hashApiKey(apiKey);
  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE api_key_hash = ?'
  ).bind(hash).first<User>();

  if (!user) {
    return c.json({ error: 'Invalid API key' }, 401);
  }

  // Check if user has API access (pro or business plan)
  if (user.plan !== 'pro' && user.plan !== 'business') {
    return c.json({ error: 'API access requires Pro or Business plan' }, 403);
  }

  c.set('user', user);
  await next();
});

// Rate limiting: 60 requests per minute per user
api.use('*', rateLimit({
  windowMs: 60_000,
  max: 60,
  keyPrefix: 'rl:api',
}));

// GET /api/v1/checks - List all checks
api.get('/checks', async (c) => {
  const user = c.get('user');
  const tagFilter = (c.req.query('tag') || '').trim().toLowerCase();
  const groupFilter = (c.req.query('group') || '').trim();

  const checks = await c.env.DB.prepare(
    'SELECT id, name, period, grace, status, tags, group_name, maint_start, maint_end, last_ping_at, next_expected_at, alert_count, ping_count, created_at, updated_at FROM checks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all<Check>();

  let results = checks.results;
  if (tagFilter) {
    results = results.filter(check => check.tags && check.tags.split(',').map(t => t.trim()).includes(tagFilter));
  }
  if (groupFilter) {
    results = results.filter(check => check.group_name === groupFilter);
  }

  return c.json({ checks: results });
});

// POST /api/v1/checks - Create a check
api.post('/checks', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { name?: string; period?: number; grace?: number; tags?: string | string[]; group_name?: string; cron_expression?: string; maint_start?: number | null; maint_end?: number | null; maint_schedule?: string };

  // Check limit
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE user_id = ?'
  ).bind(user.id).first();

  if ((count?.count as number) >= user.check_limit) {
    return c.json({ error: `Check limit reached (${user.check_limit} on ${user.plan} plan)` }, 403);
  }

  const id = generateCheckId();
  const name = (body.name || '').trim() || 'Unnamed Check';
  const cronExpr = (body.cron_expression || '').trim();
  let period = body.period || 3600;
  let grace = body.grace || 300;

  // If cron expression is provided, parse and use it
  if (cronExpr) {
    const parsed = parseCronExpression(cronExpr);
    if (!parsed.valid) {
      return c.json({ error: `Invalid cron expression: ${parsed.error}` }, 400);
    }
    // Only override period/grace if not explicitly provided
    if (!body.period) period = parsed.periodSeconds;
    if (!body.grace) grace = parsed.graceSeconds;
  }

  const tags = parseTags(body.tags);
  const groupName = (body.group_name || '').trim();
  const maintStart = body.maint_start ?? null;
  const maintEnd = body.maint_end ?? null;
  const maintSchedule = (body.maint_schedule || '').trim();
  const timestamp = now();

  // Validate period and grace
  if (period < 60 || period > 604800) {
    return c.json({ error: 'Period must be between 60 and 604800 seconds' }, 400);
  }
  if (grace < 60 || grace > 3600) {
    return c.json({ error: 'Grace must be between 60 and 3600 seconds' }, 400);
  }

  // Validate maintenance window
  if (maintStart != null && maintEnd != null && maintEnd <= maintStart) {
    return c.json({ error: 'maint_end must be after maint_start' }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO checks (id, user_id, name, period, grace, tags, group_name, cron_expression, maint_start, maint_end, maint_schedule, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, name, period, grace, tags, groupName, cronExpr, maintStart, maintEnd, maintSchedule, 'new', timestamp, timestamp).run();

  // Link to default channels
  const defaultChannels = await c.env.DB.prepare(
    'SELECT id FROM channels WHERE user_id = ? AND is_default = 1'
  ).bind(user.id).all();

  for (const ch of defaultChannels.results) {
    await c.env.DB.prepare(
      'INSERT INTO check_channels (check_id, channel_id) VALUES (?, ?)'
    ).bind(id, (ch as any).id).run();
  }

  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ?'
  ).bind(id).first<Check>();

  return c.json({
    check,
    ping_url: `${c.env.APP_URL}/ping/${id}`,
  }, 201);
});

// GET /api/v1/checks/export - Export all checks as JSON
api.get('/checks/export', async (c) => {
  const user = c.get('user');
  const checks = await c.env.DB.prepare(
    'SELECT name, period, grace, tags, group_name, cron_expression FROM checks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  return c.json({
    version: 1,
    exported_at: new Date().toISOString(),
    checks: checks.results.map((ch: any) => ({
      name: ch.name,
      period: ch.period,
      grace: ch.grace,
      tags: ch.tags || '',
      group_name: ch.group_name || '',
      cron_expression: ch.cron_expression || '',
    })),
  });
});

// POST /api/v1/checks/import - Import checks from JSON body
api.post('/checks/import', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { checks?: any[] };

  if (!body.checks || !Array.isArray(body.checks)) {
    return c.json({ error: 'Invalid format. Expected { checks: [...] }' }, 400);
  }

  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE user_id = ?'
  ).bind(user.id).first();
  const currentCount = (countResult?.count as number) || 0;
  const remaining = user.check_limit - currentCount;

  if (remaining <= 0) {
    return c.json({ error: `Check limit reached (${user.check_limit} on ${user.plan} plan)` }, 403);
  }

  const toImport = body.checks.slice(0, remaining);
  const imported: { id: string; name: string; ping_url: string }[] = [];

  for (const ch of toImport) {
    if (!ch.name) continue;
    const id = generateCheckId();
    const name = String(ch.name).trim().slice(0, 200) || 'Imported Check';
    const period = Math.max(60, Math.min(604800, parseInt(ch.period) || 3600));
    const grace = Math.max(60, Math.min(3600, parseInt(ch.grace) || 300));
    const tags = parseTags(ch.tags || '');
    const groupName = (ch.group_name || '').trim().slice(0, 100);
    const timestamp = now();

    await c.env.DB.prepare(
      'INSERT INTO checks (id, user_id, name, period, grace, tags, group_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, name, period, grace, tags, groupName, 'new', timestamp, timestamp).run();
    imported.push({ id, name, ping_url: `${c.env.APP_URL}/ping/${id}` });
  }

  return c.json({
    imported: imported.length,
    skipped: body.checks.length - imported.length,
    checks: imported,
  }, 201);
});

// GET /api/v1/checks/:id - Get a check
api.get('/checks/:id', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first<Check>();

  if (!check) return c.json({ error: 'Check not found' }, 404);

  return c.json({
    check,
    ping_url: `${c.env.APP_URL}/ping/${checkId}`,
  });
});

// PATCH /api/v1/checks/:id - Update a check
api.patch('/checks/:id', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { name?: string; period?: number; grace?: number; tags?: string | string[]; group_name?: string; cron_expression?: string; maint_start?: number | null; maint_end?: number | null; maint_schedule?: string };

  const existing = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first();

  if (!existing) return c.json({ error: 'Check not found' }, 404);

  const name = body.name !== undefined ? (body.name || '').trim() || 'Unnamed Check' : existing.name as string;
  const cronExpr = body.cron_expression !== undefined ? (body.cron_expression || '').trim() : (existing.cron_expression as string || '');
  let period = body.period || existing.period as number;
  let grace = body.grace || existing.grace as number;

  // If cron expression is provided and changed, parse it
  if (body.cron_expression !== undefined && cronExpr) {
    const parsed = parseCronExpression(cronExpr);
    if (!parsed.valid) {
      return c.json({ error: `Invalid cron expression: ${parsed.error}` }, 400);
    }
    if (!body.period) period = parsed.periodSeconds;
    if (!body.grace) grace = parsed.graceSeconds;
  }

  const tags = body.tags !== undefined ? parseTags(body.tags) : (existing.tags as string || '');
  const groupName = body.group_name !== undefined ? (body.group_name || '').trim() : (existing.group_name as string || '');
  const maintStart = body.maint_start !== undefined ? (body.maint_start ?? null) : (existing.maint_start as number | null);
  const maintEnd = body.maint_end !== undefined ? (body.maint_end ?? null) : (existing.maint_end as number | null);
  const maintSchedule = body.maint_schedule !== undefined ? (body.maint_schedule || '').trim() : (existing.maint_schedule as string || '');

  if (period < 60 || period > 604800) {
    return c.json({ error: 'Period must be between 60 and 604800 seconds' }, 400);
  }
  if (grace < 60 || grace > 3600) {
    return c.json({ error: 'Grace must be between 60 and 3600 seconds' }, 400);
  }

  // Validate maintenance window
  if (maintStart != null && maintEnd != null && maintEnd <= maintStart) {
    return c.json({ error: 'maint_end must be after maint_start' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE checks SET name = ?, period = ?, grace = ?, tags = ?, group_name = ?, cron_expression = ?, maint_start = ?, maint_end = ?, maint_schedule = ?, updated_at = ? WHERE id = ?'
  ).bind(name, period, grace, tags, groupName, cronExpr, maintStart, maintEnd, maintSchedule, now(), checkId).run();

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ?'
  ).bind(checkId).first<Check>();

  return c.json({ check });
});

// DELETE /api/v1/checks/:id - Delete a check
api.delete('/checks/:id', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  const result = await c.env.DB.prepare(
    'DELETE FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).run();

  if (!result.meta.changes) return c.json({ error: 'Check not found' }, 404);

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.json({ deleted: true });
});

// POST /api/v1/checks/:id/pause - Pause a check
api.post('/checks/:id/pause', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  const result = await c.env.DB.prepare(
    "UPDATE checks SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now(), checkId, user.id).run();

  if (!result.meta.changes) return c.json({ error: 'Check not found' }, 404);

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.json({ paused: true });
});

// POST /api/v1/checks/:id/resume - Resume a check
api.post('/checks/:id/resume', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  const result = await c.env.DB.prepare(
    "UPDATE checks SET status = 'new', updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now(), checkId, user.id).run();

  if (!result.meta.changes) return c.json({ error: 'Check not found' }, 404);

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.json({ resumed: true });
});

// GET /api/v1/checks/:id/pings - Get ping history
api.get('/checks/:id/pings', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0') || 0, 0);

  // Verify ownership
  const check = await c.env.DB.prepare(
    'SELECT id FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first();

  if (!check) return c.json({ error: 'Check not found' }, 404);

  const pings = await c.env.DB.prepare(
    'SELECT id, check_id, timestamp, source_ip, duration, type FROM pings WHERE check_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  ).bind(checkId, limit, offset).all();

  return c.json({ pings: pings.results });
});

// GET /api/v1/checks/:id/alerts - Get alert history
api.get('/checks/:id/alerts', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0') || 0, 0);

  const check = await c.env.DB.prepare(
    'SELECT id FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first();

  if (!check) return c.json({ error: 'Check not found' }, 404);

  const alerts = await c.env.DB.prepare(
    'SELECT * FROM alerts WHERE check_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(checkId, limit, offset).all();

  return c.json({ alerts: alerts.results });
});

// GET /api/v1/incidents - List all incidents across all checks
// GET /api/v1/alerts - Alias for incidents
const incidentsHandler = async (c: any) => {
  const user = c.get('user');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0') || 0, 0);
  const typeFilter = (c.req.query('type') || '').trim().toLowerCase();
  const checkFilter = (c.req.query('check_id') || '').trim();

  // Build WHERE clause dynamically
  let where = 'c.user_id = ?';
  const params: any[] = [user.id];

  if (checkFilter) {
    where += ' AND a.check_id = ?';
    params.push(checkFilter);
  }
  if (typeFilter === 'down' || typeFilter === 'recovery') {
    where += ' AND a.type = ?';
    params.push(typeFilter);
  }

  const [incidents, totalResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT a.id, a.check_id, c.name as check_name, a.channel_id, a.type, a.status, a.error, a.created_at, a.sent_at
      FROM alerts a
      INNER JOIN checks c ON a.check_id = c.id
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all(),
    c.env.DB.prepare(`
      SELECT COUNT(*) as total FROM alerts a
      INNER JOIN checks c ON a.check_id = c.id
      WHERE ${where}
    `).bind(...params).first(),
  ]);

  return c.json({
    incidents: incidents.results,
    total: (totalResult as any)?.total || 0,
  });
};

api.get('/incidents', incidentsHandler);
api.get('/alerts', incidentsHandler);

// POST /api/v1/cron/parse - Parse a cron expression
api.post('/cron/parse', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { expression?: string };
  const expr = (body.expression || '').trim();
  if (!expr) {
    return c.json({ error: 'Missing "expression" field' }, 400);
  }
  const result = parseCronExpression(expr);
  return c.json(result);
});

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default api;
