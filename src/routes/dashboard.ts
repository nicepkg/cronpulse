import { Hono } from 'hono';
import type { Env, User, Check, Channel } from '../types';
import { requireAuth } from '../middleware/session';
import { generateCheckId, generateId } from '../utils/id';
import { now, timeAgo, formatDuration, periodOptions, graceOptions } from '../utils/time';

type DashboardEnv = { Bindings: Env; Variables: { user: User } };
const dashboard = new Hono<DashboardEnv>();

dashboard.use('*', requireAuth);

// Dashboard home - Check list
dashboard.get('/', async (c) => {
  const user = c.get('user');
  const checks = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all<Check>();

  return c.html(renderLayout(user, 'Checks', renderCheckList(checks.results, user, c.env.APP_URL)));
});

// New check form
dashboard.get('/checks/new', async (c) => {
  const user = c.get('user');
  const checkCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE user_id = ?'
  ).bind(user.id).first();

  if ((checkCount?.count as number) >= user.check_limit) {
    return c.html(renderLayout(user, 'Limit Reached', `
      <div class="max-w-lg mx-auto bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <h2 class="text-lg font-semibold text-yellow-800">Check Limit Reached</h2>
        <p class="text-yellow-700 mt-2">You've used all ${user.check_limit} checks on your ${user.plan} plan.</p>
        <a href="/dashboard" class="text-blue-600 hover:underline mt-4 inline-block">Back to dashboard</a>
      </div>
    `));
  }

  return c.html(renderLayout(user, 'New Check', renderCheckForm()));
});

// Create check
dashboard.post('/checks', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();

  const checkCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE user_id = ?'
  ).bind(user.id).first();

  if ((checkCount?.count as number) >= user.check_limit) {
    return c.redirect('/dashboard');
  }

  const id = generateCheckId();
  const name = (body.name as string || '').trim() || 'Unnamed Check';
  const period = parseInt(body.period as string) || 3600;
  const grace = parseInt(body.grace as string) || 300;
  const timestamp = now();

  await c.env.DB.prepare(
    'INSERT INTO checks (id, user_id, name, period, grace, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, name, period, grace, 'new', timestamp, timestamp).run();

  // Link to default channels
  const defaultChannels = await c.env.DB.prepare(
    'SELECT id FROM channels WHERE user_id = ? AND is_default = 1'
  ).bind(user.id).all();

  for (const ch of defaultChannels.results) {
    await c.env.DB.prepare(
      'INSERT INTO check_channels (check_id, channel_id) VALUES (?, ?)'
    ).bind(id, (ch as any).id).run();
  }

  return c.redirect(`/dashboard/checks/${id}`);
});

// Check detail
dashboard.get('/checks/:id', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first<Check>();

  if (!check) return c.redirect('/dashboard');

  const pings = await c.env.DB.prepare(
    'SELECT * FROM pings WHERE check_id = ? ORDER BY timestamp DESC LIMIT 50'
  ).bind(checkId).all();

  const alerts = await c.env.DB.prepare(
    'SELECT * FROM alerts WHERE check_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(checkId).all();

  return c.html(renderLayout(user, check.name, renderCheckDetail(check, pings.results, alerts.results, c.env.APP_URL)));
});

// Edit check form
dashboard.get('/checks/:id/edit', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');
  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first<Check>();

  if (!check) return c.redirect('/dashboard');

  return c.html(renderLayout(user, `Edit ${check.name}`, renderCheckForm(check)));
});

// Update check
dashboard.post('/checks/:id', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');
  const body = await c.req.parseBody();

  const check = await c.env.DB.prepare(
    'SELECT * FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).first();

  if (!check) return c.redirect('/dashboard');

  const name = (body.name as string || '').trim() || 'Unnamed Check';
  const period = parseInt(body.period as string) || 3600;
  const grace = parseInt(body.grace as string) || 300;

  await c.env.DB.prepare(
    'UPDATE checks SET name = ?, period = ?, grace = ?, updated_at = ? WHERE id = ?'
  ).bind(name, period, grace, now(), checkId).run();

  // Invalidate KV cache
  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Delete check
dashboard.post('/checks/:id/delete', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  await c.env.DB.prepare(
    'DELETE FROM checks WHERE id = ? AND user_id = ?'
  ).bind(checkId, user.id).run();

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.redirect('/dashboard');
});

// Pause check
dashboard.post('/checks/:id/pause', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  await c.env.DB.prepare(
    "UPDATE checks SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now(), checkId, user.id).run();

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Resume check
dashboard.post('/checks/:id/resume', async (c) => {
  const user = c.get('user');
  const checkId = c.req.param('id');

  await c.env.DB.prepare(
    "UPDATE checks SET status = 'new', updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now(), checkId, user.id).run();

  try { await c.env.KV.delete(`check:${checkId}`); } catch {}

  return c.redirect(`/dashboard/checks/${checkId}`);
});

// Channels page
dashboard.get('/channels', async (c) => {
  const user = c.get('user');
  const channels = await c.env.DB.prepare(
    'SELECT * FROM channels WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all<Channel>();

  return c.html(renderLayout(user, 'Notification Channels', renderChannels(channels.results)));
});

// Create channel
dashboard.post('/channels', async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();

  const id = generateId();
  const kind = body.kind as string || 'email';
  const target = (body.target as string || '').trim();
  const name = (body.name as string || '').trim() || kind;
  const isDefault = body.is_default ? 1 : 0;

  if (!target) return c.redirect('/dashboard/channels');

  // Validate target based on channel kind
  if (kind === 'email') {
    if (!target.includes('@') || target.length > 320) {
      return c.redirect('/dashboard/channels');
    }
  } else if (kind === 'webhook' || kind === 'slack') {
    if (!target.startsWith('https://') || target.length > 2048) {
      return c.redirect('/dashboard/channels');
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO channels (id, user_id, kind, target, name, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, kind, target, name, isDefault, now()).run();

  return c.redirect('/dashboard/channels');
});

// Delete channel
dashboard.post('/channels/:id/delete', async (c) => {
  const user = c.get('user');
  const channelId = c.req.param('id');

  await c.env.DB.prepare(
    'DELETE FROM channels WHERE id = ? AND user_id = ?'
  ).bind(channelId, user.id).run();

  return c.redirect('/dashboard/channels');
});

// Billing page
dashboard.get('/billing', async (c) => {
  const user = c.get('user');
  return c.html(renderLayout(user, 'Billing', renderBilling(user, c.env.LEMONSQUEEZY_STORE_URL)));
});

// Settings page
dashboard.get('/settings', async (c) => {
  const user = c.get('user');
  return c.html(renderLayout(user, 'Settings', renderSettings(user)));
});

// Generate API key
dashboard.post('/settings/api-key', async (c) => {
  const user = c.get('user');

  if (user.plan !== 'pro' && user.plan !== 'business') {
    return c.redirect('/dashboard/settings');
  }

  // Generate a new API key
  const { nanoid } = await import('nanoid');
  const apiKey = `cpk_${nanoid(40)}`;

  // Hash and store
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  await c.env.DB.prepare(
    'UPDATE users SET api_key_hash = ?, updated_at = ? WHERE id = ?'
  ).bind(hashHex, now(), user.id).run();

  // Show the key once
  return c.html(renderLayout(user, 'API Key Generated', `
    <div class="max-w-lg">
      <h1 class="text-2xl font-bold mb-6">API Key Generated</h1>
      <div class="bg-green-50 border border-green-200 rounded-lg p-6">
        <p class="text-sm text-green-800 font-medium mb-2">Copy your API key now. It won't be shown again.</p>
        <code class="block bg-white border rounded p-3 text-sm break-all">${apiKey}</code>
        <p class="text-xs text-green-600 mt-3">Use this key in the Authorization header: <code>Bearer ${apiKey}</code></p>
      </div>
      <a href="/dashboard/settings" class="text-blue-600 hover:underline text-sm mt-4 inline-block">Back to Settings</a>
    </div>
  `));
});

// --- View Renderers ---

function renderLayout(user: User, title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - CronPulse</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-white border-b">
    <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-6">
        <a href="/dashboard" class="text-lg font-bold text-gray-900">CronPulse</a>
        <a href="/dashboard" class="text-sm text-gray-600 hover:text-gray-900">Checks</a>
        <a href="/dashboard/channels" class="text-sm text-gray-600 hover:text-gray-900">Channels</a>
        <a href="/dashboard/billing" class="text-sm text-gray-600 hover:text-gray-900">Billing</a>
        <a href="/dashboard/settings" class="text-sm text-gray-600 hover:text-gray-900">Settings</a>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-xs text-gray-400">${user.email} (${user.plan})</span>
        <form method="POST" action="/auth/logout" style="display:inline">
          <button type="submit" class="text-sm text-gray-500 hover:text-gray-700">Logout</button>
        </form>
      </div>
    </div>
  </nav>
  <main class="max-w-5xl mx-auto px-4 py-8">
    ${content}
  </main>
</body>
</html>`;
}

function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    up: 'bg-green-100 text-green-800',
    down: 'bg-red-100 text-red-800',
    new: 'bg-gray-100 text-gray-800',
    paused: 'bg-yellow-100 text-yellow-800',
  };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${colors[status] || colors.new}">${status}</span>`;
}

function renderCheckList(checks: Check[], user: User, appUrl: string): string {
  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Your Checks</h1>
      <a href="/dashboard/checks/new" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
        + New Check
      </a>
    </div>
    <p class="text-sm text-gray-500 mb-4">${checks.length} / ${user.check_limit} checks used</p>
    ${checks.length === 0 ? `
      <div class="bg-white rounded-lg border p-12 text-center">
        <p class="text-gray-500">No checks yet. Create your first one!</p>
        <a href="/dashboard/checks/new" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Create a check</a>
      </div>
    ` : `
      <div class="bg-white rounded-lg border divide-y">
        ${checks.map(check => `
          <a href="/dashboard/checks/${check.id}" class="block px-4 py-3 hover:bg-gray-50 flex items-center justify-between">
            <div>
              <span class="font-medium text-gray-900">${escapeHtml(check.name)}</span>
              ${statusBadge(check.status)}
            </div>
            <div class="text-sm text-gray-400">
              ${check.last_ping_at ? timeAgo(check.last_ping_at) : 'Never pinged'}
              &middot; every ${formatDuration(check.period)}
            </div>
          </a>
        `).join('')}
      </div>
    `}`;
}

function renderCheckForm(check?: Check): string {
  const isEdit = !!check;
  return `
    <div class="max-w-lg mx-auto">
      <h1 class="text-2xl font-bold mb-6">${isEdit ? 'Edit Check' : 'New Check'}</h1>
      <form method="POST" action="${isEdit ? `/dashboard/checks/${check!.id}` : '/dashboard/checks'}" class="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" name="name" value="${isEdit ? escapeHtml(check!.name) : ''}" required
            class="w-full px-3 py-2 border rounded-md text-sm" placeholder="e.g. DB Backup">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Expected Period</label>
          <select name="period" class="w-full px-3 py-2 border rounded-md text-sm">
            ${periodOptions().map(o => `<option value="${o.value}" ${check && check.period === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <p class="text-xs text-gray-400 mt-1">How often your cron job runs</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Grace Period</label>
          <select name="grace" class="w-full px-3 py-2 border rounded-md text-sm">
            ${graceOptions().map(o => `<option value="${o.value}" ${check && check.grace === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
          <p class="text-xs text-gray-400 mt-1">Extra time before alerting</p>
        </div>
        <div class="flex gap-3">
          <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
            ${isEdit ? 'Save Changes' : 'Create Check'}
          </button>
          <a href="/dashboard" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Cancel</a>
        </div>
      </form>
    </div>`;
}

function renderCheckDetail(check: Check, pings: any[], alerts: any[], appUrl: string): string {
  const pingUrl = `${appUrl}/ping/${check.id}`;
  return `
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">${escapeHtml(check.name)}</h1>
        <span class="text-sm text-gray-500">ID: ${check.id}</span>
      </div>
      <div class="flex gap-2">
        <a href="/dashboard/checks/${check.id}/edit" class="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Edit</a>
        ${check.status === 'paused' ? `
          <form method="POST" action="/dashboard/checks/${check.id}/resume" style="display:inline">
            <button class="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">Resume</button>
          </form>
        ` : `
          <form method="POST" action="/dashboard/checks/${check.id}/pause" style="display:inline">
            <button class="px-3 py-1.5 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600">Pause</button>
          </form>
        `}
        <form method="POST" action="/dashboard/checks/${check.id}/delete" style="display:inline"
          onsubmit="return confirm('Delete this check?')">
          <button class="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700">Delete</button>
        </form>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg border p-4">
        <p class="text-xs text-gray-500 uppercase">Status</p>
        <p class="text-lg font-semibold mt-1">${statusBadge(check.status)}</p>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <p class="text-xs text-gray-500 uppercase">Last Ping</p>
        <p class="text-lg font-semibold mt-1">${check.last_ping_at ? timeAgo(check.last_ping_at) : 'Never'}</p>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <p class="text-xs text-gray-500 uppercase">Period</p>
        <p class="text-lg font-semibold mt-1">${formatDuration(check.period)}</p>
      </div>
      <div class="bg-white rounded-lg border p-4">
        <p class="text-xs text-gray-500 uppercase">Total Pings</p>
        <p class="text-lg font-semibold mt-1">${check.ping_count}</p>
      </div>
    </div>

    <div class="bg-white rounded-lg border p-4 mb-6">
      <p class="text-sm font-medium mb-2">Ping URL</p>
      <div class="flex items-center gap-2">
        <code class="bg-gray-100 px-3 py-1.5 rounded text-sm flex-1 overflow-x-auto">${pingUrl}</code>
      </div>
      <p class="text-xs text-gray-400 mt-2">Add to your cron job: <code class="bg-gray-100 px-1 py-0.5 rounded">curl -fsS --retry 3 ${pingUrl}</code></p>
    </div>

    <div class="grid md:grid-cols-2 gap-6">
      <div>
        <h2 class="text-lg font-semibold mb-3">Recent Pings</h2>
        <div class="bg-white rounded-lg border divide-y">
          ${pings.length === 0 ? '<p class="p-4 text-sm text-gray-400">No pings received yet.</p>' :
            pings.map((p: any) => `
              <div class="px-4 py-2 flex justify-between text-sm">
                <span class="text-gray-600">${new Date(p.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19)}</span>
                <span class="${p.type === 'success' ? 'text-green-600' : 'text-red-600'}">${p.type}</span>
              </div>
            `).join('')}
        </div>
      </div>
      <div>
        <h2 class="text-lg font-semibold mb-3">Recent Alerts</h2>
        <div class="bg-white rounded-lg border divide-y">
          ${alerts.length === 0 ? '<p class="p-4 text-sm text-gray-400">No alerts sent yet.</p>' :
            alerts.map((a: any) => `
              <div class="px-4 py-2 flex justify-between text-sm">
                <span class="text-gray-600">${new Date(a.created_at * 1000).toISOString().replace('T', ' ').slice(0, 19)}</span>
                <span class="${a.type === 'recovery' ? 'text-green-600' : 'text-red-600'}">${a.type}</span>
                <span class="${a.status === 'sent' ? 'text-green-600' : 'text-red-600'}">${a.status}</span>
              </div>
            `).join('')}
        </div>
      </div>
    </div>`;
}

function renderChannels(channels: Channel[]): string {
  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Notification Channels</h1>
    </div>

    <div class="max-w-lg">
      <form method="POST" action="/dashboard/channels" class="bg-white rounded-lg border p-6 space-y-4 mb-6">
        <h2 class="font-semibold">Add Channel</h2>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select name="kind" class="w-full px-3 py-2 border rounded-md text-sm">
            <option value="email">Email</option>
            <option value="webhook">Webhook</option>
            <option value="slack">Slack Webhook</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Target</label>
          <input type="text" name="target" required class="w-full px-3 py-2 border rounded-md text-sm"
            placeholder="email@example.com or https://...">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" name="name" class="w-full px-3 py-2 border rounded-md text-sm" placeholder="My Slack">
        </div>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_default" value="1"> Use as default for new checks
        </label>
        <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
          Add Channel
        </button>
      </form>

      ${channels.length === 0 ? '<p class="text-sm text-gray-400">No channels configured.</p>' : `
        <div class="bg-white rounded-lg border divide-y">
          ${channels.map(ch => `
            <div class="px-4 py-3 flex items-center justify-between">
              <div>
                <span class="font-medium text-sm">${escapeHtml(ch.name || ch.kind)}</span>
                <span class="text-xs text-gray-400 ml-2">${ch.kind}</span>
                ${ch.is_default ? '<span class="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-2">default</span>' : ''}
                <p class="text-xs text-gray-500 mt-0.5">${escapeHtml(ch.target)}</p>
              </div>
              <form method="POST" action="/dashboard/channels/${ch.id}/delete" style="display:inline">
                <button class="text-red-500 text-xs hover:underline">Delete</button>
              </form>
            </div>
          `).join('')}
        </div>
      `}
    </div>`;
}

function renderSettings(user: User): string {
  const hasApiAccess = user.plan === 'pro' || user.plan === 'business';
  return `
    <div class="max-w-lg">
      <h1 class="text-2xl font-bold mb-6">Settings</h1>
      <div class="bg-white rounded-lg border p-6 space-y-4">
        <div>
          <p class="text-sm font-medium text-gray-700">Email</p>
          <p class="text-gray-900">${escapeHtml(user.email)}</p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-700">Plan</p>
          <p class="text-gray-900 capitalize">${user.plan} (${user.check_limit} checks)</p>
        </div>
        <div>
          <p class="text-sm font-medium text-gray-700">Member since</p>
          <p class="text-gray-900">${new Date(user.created_at * 1000).toISOString().slice(0, 10)}</p>
        </div>
      </div>

      <div class="bg-white rounded-lg border p-6 mt-6">
        <h2 class="font-semibold mb-3">API Access</h2>
        ${hasApiAccess ? `
          <p class="text-sm text-gray-600 mb-3">${user.api_key_hash ? 'You have an active API key.' : 'Generate an API key to manage checks programmatically.'}</p>
          <form method="POST" action="/dashboard/settings/api-key">
            <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
              onclick="return ${user.api_key_hash ? "confirm('This will replace your existing API key. Continue?')" : 'true'}">
              ${user.api_key_hash ? 'Regenerate API Key' : 'Generate API Key'}
            </button>
          </form>
          <p class="text-xs text-gray-400 mt-3">API docs: <code>GET/POST/PATCH/DELETE /api/v1/checks</code></p>
        ` : `
          <p class="text-sm text-gray-500">API access is available on Pro and Business plans.</p>
          <a href="/dashboard/billing" class="text-blue-600 hover:underline text-sm mt-2 inline-block">Upgrade your plan</a>
        `}
      </div>
    </div>`;
}

function renderBilling(user: User, storeUrl: string): string {
  const plans = [
    { name: 'Free', price: '$0', period: 'forever', checks: 10, features: ['Email alerts', '7 day history', '5 min interval'], current: user.plan === 'free' },
    { name: 'Starter', price: '$5', period: '/mo', checks: 50, features: ['Email + Webhook + Slack', '30 day history', '1 min interval'], current: user.plan === 'starter', popular: true },
    { name: 'Pro', price: '$15', period: '/mo', checks: 200, features: ['All notifications', '90 day history', 'API access'], current: user.plan === 'pro' },
    { name: 'Business', price: '$49', period: '/mo', checks: 1000, features: ['All notifications', '1 year history', 'API access', 'Priority support'], current: user.plan === 'business' },
  ];

  return `
    <div class="max-w-3xl mx-auto">
      <h1 class="text-2xl font-bold mb-2">Billing</h1>
      <p class="text-sm text-gray-500 mb-6">Current plan: <span class="font-medium capitalize">${user.plan}</span> (${user.check_limit} checks)</p>

      <div class="grid md:grid-cols-2 gap-4">
        ${plans.map(plan => `
          <div class="bg-white rounded-lg border ${plan.current ? 'border-blue-500 ring-1 ring-blue-500' : ''} ${plan.popular ? 'border-blue-500' : ''} p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold">${plan.name}</h3>
              ${plan.current ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Current</span>' : ''}
              ${plan.popular && !plan.current ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Popular</span>' : ''}
            </div>
            <p class="text-2xl font-bold">${plan.price}<span class="text-sm font-normal text-gray-500">${plan.period}</span></p>
            <p class="text-sm text-gray-500 mt-1">${plan.checks} checks</p>
            <ul class="mt-3 space-y-1">
              ${plan.features.map(f => `<li class="text-sm text-gray-600">&#10003; ${f}</li>`).join('')}
            </ul>
            ${plan.current
              ? '<p class="mt-4 text-center text-sm text-gray-400">Your current plan</p>'
              : plan.name === 'Free'
                ? ''
                : `<a href="${storeUrl || '#'}" target="_blank" rel="noopener"
                    class="block mt-4 text-center bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700">
                    ${user.plan === 'free' ? 'Upgrade' : 'Change Plan'}
                  </a>`
            }
          </div>
        `).join('')}
      </div>

      ${user.plan !== 'free' ? `
        <div class="mt-6 bg-white rounded-lg border p-4">
          <p class="text-sm text-gray-600">Need to manage your subscription? <a href="${storeUrl || '#'}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">Manage billing</a></p>
        </div>
      ` : ''}
    </div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default dashboard;
