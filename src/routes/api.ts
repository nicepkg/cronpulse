import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, User, Check } from '../types';
import { generateCheckId } from '../utils/id';
import { now } from '../utils/time';

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

// GET /api/v1/checks - List all checks
api.get('/checks', async (c) => {
  const user = c.get('user');
  const tagFilter = (c.req.query('tag') || '').trim().toLowerCase();

  const checks = await c.env.DB.prepare(
    'SELECT id, name, period, grace, status, tags, last_ping_at, next_expected_at, alert_count, ping_count, created_at, updated_at FROM checks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all<Check>();

  const results = tagFilter
    ? checks.results.filter(check => check.tags && check.tags.split(',').map(t => t.trim()).includes(tagFilter))
    : checks.results;

  return c.json({ checks: results });
});

// POST /api/v1/checks - Create a check
api.post('/checks', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { name?: string; period?: number; grace?: number; tags?: string | string[] };

  // Check limit
  const count = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE user_id = ?'
  ).bind(user.id).first();

  if ((count?.count as number) >= user.check_limit) {
    return c.json({ error: `Check limit reached (${user.check_limit} on ${user.plan} plan)` }, 403);
  }

  const id = generateCheckId();
  const name = (body.name || '').trim() || 'Unnamed Check';
  const period = body.period || 3600;
  const grace = body.grace || 300;
  const tags = parseTags(body.tags);
  const timestamp = now();

  // Validate period and grace
  if (period < 60 || period > 604800) {
    return c.json({ error: 'Period must be between 60 and 604800 seconds' }, 400);
  }
  if (grace < 60 || grace > 3600) {
    return c.json({ error: 'Grace must be between 60 and 3600 seconds' }, 400);
  }

  await c.env.DB.prepare(
    'INSERT INTO checks (id, user_id, name, period, grace, tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, name, period, grace, tags, 'new', timestamp, timestamp).run();

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
    'SELECT name, period, grace, tags FROM checks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  return c.json({
    version: 1,
    exported_at: new Date().toISOString(),
    checks: checks.results.map((ch: any) => ({
      name: ch.name,
      period: ch.period,
      grace: ch.grace,
      tags: ch.tags || '',
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
    const timestamp = now();

    await c.env.DB.prepare(
      'INSERT INTO checks (id, user_id, name, period, grace, tags, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, user.id, name, period, grace, tags, 'new', timestamp, timestamp).run();
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
  const body = await c.req.json().catch(() => ({})) as { name?: string; period?: number; grace?: number; tags?: string | string[] };

  const existing = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first();

  if (!existing) return c.json({ error: 'Check not found' }, 404);

  const name = body.name !== undefined ? (body.name || '').trim() || 'Unnamed Check' : existing.name as string;
  const period = body.period || existing.period as number;
  const grace = body.grace || existing.grace as number;
  const tags = body.tags !== undefined ? parseTags(body.tags) : (existing.tags as string || '');

  if (period < 60 || period > 604800) {
    return c.json({ error: 'Period must be between 60 and 604800 seconds' }, 400);
  }
  if (grace < 60 || grace > 3600) {
    return c.json({ error: 'Grace must be between 60 and 3600 seconds' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE checks SET name = ?, period = ?, grace = ?, tags = ?, updated_at = ? WHERE id = ?'
  ).bind(name, period, grace, tags, now(), checkId).run();

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

async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default api;
