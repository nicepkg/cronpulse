import { Hono } from 'hono';
import type { Env } from '../types';

const analytics = new Hono<{ Bindings: Env }>();

// Simple admin auth: check for admin_key query param matching SESSION_SECRET
// This is a quick approach — admin access via shared secret
function isAdmin(c: any): boolean {
  const key = c.req.query('key');
  return !!key && key === c.env.SESSION_SECRET;
}

analytics.get('/', async (c) => {
  if (!isAdmin(c)) {
    return c.text('Unauthorized. Append ?key=YOUR_SESSION_SECRET', 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const day = 86400;
  const week = day * 7;
  const month = day * 30;

  // Run all queries in parallel
  const [
    totalUsers,
    totalChecks,
    activeChecks,
    totalPings24h,
    totalAlerts24h,
    signupsBySource,
    signupsLast7d,
    signupsLast30d,
    recentSignups,
    checksByStatus,
    alertsByType24h,
  ] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM checks').first(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM checks WHERE status IN ('up', 'down')").first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM pings WHERE timestamp > ?').bind(now - day).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM alerts WHERE created_at > ?').bind(now - day).first(),
    c.env.DB.prepare(
      "SELECT COALESCE(NULLIF(utm_source, ''), 'direct') as source, COUNT(*) as count FROM signups GROUP BY source ORDER BY count DESC LIMIT 20"
    ).all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM signups WHERE created_at > ?').bind(now - week).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM signups WHERE created_at > ?').bind(now - month).first(),
    c.env.DB.prepare(
      "SELECT email, utm_source, utm_medium, referrer, created_at FROM signups ORDER BY created_at DESC LIMIT 50"
    ).all(),
    c.env.DB.prepare(
      "SELECT status, COUNT(*) as count FROM checks GROUP BY status"
    ).all(),
    c.env.DB.prepare(
      "SELECT type, status, COUNT(*) as count FROM alerts WHERE created_at > ? GROUP BY type, status"
    ).bind(now - day).all(),
  ]);

  const adminKey = c.req.query('key');

  return c.html(renderAnalytics({
    totalUsers: (totalUsers?.count as number) || 0,
    totalChecks: (totalChecks?.count as number) || 0,
    activeChecks: (activeChecks?.count as number) || 0,
    totalPings24h: (totalPings24h?.count as number) || 0,
    totalAlerts24h: (totalAlerts24h?.count as number) || 0,
    signupsBySource: (signupsBySource?.results as any[]) || [],
    signupsLast7d: (signupsLast7d?.count as number) || 0,
    signupsLast30d: (signupsLast30d?.count as number) || 0,
    recentSignups: (recentSignups?.results as any[]) || [],
    checksByStatus: (checksByStatus?.results as any[]) || [],
    alertsByType24h: (alertsByType24h?.results as any[]) || [],
    adminKey: adminKey || '',
  }));
});

// JSON export endpoint
analytics.get('/json', async (c) => {
  if (!isAdmin(c)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const day = 86400;

  const [totalUsers, totalChecks, totalPings24h, totalAlerts24h, signupsBySource] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM checks').first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM pings WHERE timestamp > ?').bind(now - day).first(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM alerts WHERE created_at > ?').bind(now - day).first(),
    c.env.DB.prepare(
      "SELECT COALESCE(NULLIF(utm_source, ''), 'direct') as source, COUNT(*) as count FROM signups GROUP BY source ORDER BY count DESC"
    ).all(),
  ]);

  return c.json({
    timestamp: new Date().toISOString(),
    users: (totalUsers?.count as number) || 0,
    checks: (totalChecks?.count as number) || 0,
    pings_24h: (totalPings24h?.count as number) || 0,
    alerts_24h: (totalAlerts24h?.count as number) || 0,
    signups_by_source: signupsBySource?.results || [],
  });
});

function renderAnalytics(data: {
  totalUsers: number;
  totalChecks: number;
  activeChecks: number;
  totalPings24h: number;
  totalAlerts24h: number;
  signupsBySource: any[];
  signupsLast7d: number;
  signupsLast30d: number;
  recentSignups: any[];
  checksByStatus: any[];
  alertsByType24h: any[];
  adminKey: string;
}): string {
  const statusColors: Record<string, string> = {
    up: 'bg-green-100 text-green-800',
    down: 'bg-red-100 text-red-800',
    new: 'bg-gray-100 text-gray-800',
    paused: 'bg-yellow-100 text-yellow-800',
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analytics - CronPulse Admin</title>
  <meta name="robots" content="noindex,nofollow">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gray-900 text-white">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-4">
        <span class="font-bold">CronPulse Admin</span>
        <a href="/analytics?key=${esc(data.adminKey)}" class="text-sm text-gray-300 hover:text-white">Dashboard</a>
        <a href="/analytics/json?key=${esc(data.adminKey)}" class="text-sm text-gray-300 hover:text-white">JSON Export</a>
      </div>
      <span class="text-xs text-gray-400">${new Date().toISOString()}</span>
    </div>
  </nav>

  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- KPI Cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
      ${kpiCard('Total Users', data.totalUsers)}
      ${kpiCard('Total Checks', data.totalChecks)}
      ${kpiCard('Active Checks', data.activeChecks)}
      ${kpiCard('Pings (24h)', data.totalPings24h)}
      ${kpiCard('Alerts (24h)', data.totalAlerts24h)}
    </div>

    <div class="grid md:grid-cols-2 gap-6 mb-8">
      <!-- Signup Sources -->
      <div class="bg-white rounded-lg border p-6">
        <h2 class="text-lg font-semibold mb-4">Signup Sources</h2>
        <div class="space-y-2 mb-4">
          <div class="flex justify-between text-sm text-gray-500">
            <span>Last 7 days: <strong class="text-gray-900">${data.signupsLast7d}</strong></span>
            <span>Last 30 days: <strong class="text-gray-900">${data.signupsLast30d}</strong></span>
          </div>
        </div>
        ${data.signupsBySource.length === 0 ? '<p class="text-sm text-gray-400">No signups yet.</p>' : `
        <table class="w-full text-sm">
          <thead><tr class="border-b"><th class="text-left py-2 text-gray-500 font-medium">Source</th><th class="text-right py-2 text-gray-500 font-medium">Count</th></tr></thead>
          <tbody>
            ${data.signupsBySource.map(s => `
              <tr class="border-b last:border-0">
                <td class="py-2"><span class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">${esc(s.source)}</span></td>
                <td class="py-2 text-right font-mono">${s.count}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
      </div>

      <!-- Checks by Status -->
      <div class="bg-white rounded-lg border p-6">
        <h2 class="text-lg font-semibold mb-4">Checks by Status</h2>
        ${data.checksByStatus.length === 0 ? '<p class="text-sm text-gray-400">No checks yet.</p>' : `
        <div class="space-y-3">
          ${data.checksByStatus.map(s => `
            <div class="flex items-center justify-between">
              <span class="px-2 py-0.5 rounded text-xs font-medium ${statusColors[s.status] || 'bg-gray-100 text-gray-800'}">${s.status}</span>
              <span class="font-mono text-sm">${s.count}</span>
            </div>
          `).join('')}
        </div>`}

        <h3 class="text-sm font-semibold mt-6 mb-3 text-gray-700">Alerts (24h)</h3>
        ${data.alertsByType24h.length === 0 ? '<p class="text-sm text-gray-400">No alerts in the last 24h.</p>' : `
        <div class="space-y-2">
          ${data.alertsByType24h.map(a => `
            <div class="flex items-center justify-between text-sm">
              <span>${a.type} / ${a.status}</span>
              <span class="font-mono">${a.count}</span>
            </div>
          `).join('')}
        </div>`}
      </div>
    </div>

    <!-- Recent Signups -->
    <div class="bg-white rounded-lg border p-6">
      <h2 class="text-lg font-semibold mb-4">Recent Signups</h2>
      ${data.recentSignups.length === 0 ? '<p class="text-sm text-gray-400">No signups recorded yet.</p>' : `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="border-b text-left">
            <th class="py-2 text-gray-500 font-medium">Email</th>
            <th class="py-2 text-gray-500 font-medium">Source</th>
            <th class="py-2 text-gray-500 font-medium">Medium</th>
            <th class="py-2 text-gray-500 font-medium">Referrer</th>
            <th class="py-2 text-gray-500 font-medium">Date</th>
          </tr></thead>
          <tbody>
            ${data.recentSignups.map(s => `
              <tr class="border-b last:border-0">
                <td class="py-2 font-mono text-xs">${esc(s.email)}</td>
                <td class="py-2"><span class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">${esc(s.utm_source || 'direct')}</span></td>
                <td class="py-2 text-gray-500 text-xs">${esc(s.utm_medium || '-')}</td>
                <td class="py-2 text-gray-500 text-xs max-w-[200px] truncate">${esc(s.referrer || '-')}</td>
                <td class="py-2 text-gray-500 text-xs">${new Date(s.created_at * 1000).toISOString().slice(0, 16).replace('T', ' ')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`}
    </div>
  </main>
</body>
</html>`;
}

function kpiCard(label: string, value: number): string {
  return `<div class="bg-white rounded-lg border p-4">
    <p class="text-xs text-gray-500 uppercase tracking-wide">${label}</p>
    <p class="text-2xl font-bold mt-1">${value.toLocaleString()}</p>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default analytics;
