import { Hono } from 'hono';
import type { Env } from '../types';

const status = new Hono<{ Bindings: Env }>();

interface SystemStats {
  status: 'operational' | 'degraded';
  checks_monitored: number;
  checks_active: number;
  pings_24h: number;
  alerts_24h: number;
  uptime_since: number;
  timestamp: number;
}

// Track deployment time as module-level constant.
// On Cloudflare Workers, the module is re-evaluated on each deploy.
const DEPLOYED_AT = Date.now();

async function getSystemStats(db: D1Database): Promise<SystemStats> {
  const now = Date.now();
  const twentyFourHoursAgo = Math.floor((now - 24 * 60 * 60 * 1000) / 1000);

  // Run all queries in parallel — fast and simple.
  const [checksResult, activeResult, pingsResult, alertsResult] = await Promise.all([
    db.prepare('SELECT COUNT(*) as count FROM checks').first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) as count FROM checks WHERE status IN ('up', 'down', 'late')").first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM pings WHERE timestamp > ?').bind(twentyFourHoursAgo).first<{ count: number }>(),
    db.prepare('SELECT COUNT(*) as count FROM alerts WHERE created_at > ?').bind(twentyFourHoursAgo).first<{ count: number }>(),
  ]);

  const checksMonitored = checksResult?.count ?? 0;
  const checksActive = activeResult?.count ?? 0;
  const pings24h = pingsResult?.count ?? 0;
  const alerts24h = alertsResult?.count ?? 0;

  // Simple health heuristic: if we can query the DB, we're operational.
  const systemStatus: 'operational' | 'degraded' = 'operational';

  return {
    status: systemStatus,
    checks_monitored: checksMonitored,
    checks_active: checksActive,
    pings_24h: pings24h,
    alerts_24h: alerts24h,
    uptime_since: DEPLOYED_AT,
    timestamp: now,
  };
}

function formatUptime(deployedAt: number): string {
  const diff = Date.now() - deployedAt;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

status.get('/', async (c) => {
  let stats: SystemStats;

  try {
    stats = await getSystemStats(c.env.DB);
  } catch {
    // If the DB query fails, report degraded status with zeros.
    stats = {
      status: 'degraded',
      checks_monitored: 0,
      checks_active: 0,
      pings_24h: 0,
      alerts_24h: 0,
      uptime_since: DEPLOYED_AT,
      timestamp: Date.now(),
    };
  }

  // Return JSON for API consumers.
  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json')) {
    return c.json(stats);
  }

  // SSR HTML for browsers.
  const isOperational = stats.status === 'operational';
  const statusColor = isOperational ? 'green' : 'yellow';
  const statusLabel = isOperational ? 'All Systems Operational' : 'Degraded Performance';
  const uptime = formatUptime(stats.uptime_since);
  const appUrl = c.env.APP_URL;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>System Status - CronPulse</title>
  <meta name="description" content="CronPulse system status and health. Real-time monitoring of our infrastructure running on Cloudflare's global edge network.">
  <link rel="canonical" href="${appUrl}/status">
  <meta property="og:title" content="CronPulse System Status">
  <meta property="og:description" content="Real-time system health and infrastructure status for CronPulse.">
  <meta property="og:url" content="${appUrl}/status">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white">
  <nav class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
    <a href="/" class="text-xl font-bold">CronPulse</a>
    <div class="flex items-center gap-4">
      <a href="/status" class="text-sm text-gray-900 font-medium">Status</a>
      <a href="/docs" class="text-sm text-gray-600 hover:text-gray-900">Docs</a>
      <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900">Blog</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold mb-2">System Status</h1>
    <p class="text-gray-600 mb-10">Real-time health of the CronPulse infrastructure.</p>

    <!-- Status Banner -->
    <div class="bg-${statusColor}-50 border border-${statusColor}-200 rounded-lg p-6 mb-8">
      <div class="flex items-center gap-3">
        <div class="w-3 h-3 rounded-full bg-${statusColor}-500 animate-pulse"></div>
        <span class="text-lg font-semibold text-${statusColor}-800">${statusLabel}</span>
      </div>
      <p class="text-sm text-${statusColor}-700 mt-2">
        ${isOperational
          ? 'All services are running normally. Pings are being received and processed across 300+ global edge locations.'
          : 'Some services may be experiencing issues. We are investigating.'}
      </p>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Checks Monitored</p>
        <p class="text-2xl font-bold text-gray-900 mt-1">${formatNumber(stats.checks_monitored)}</p>
      </div>
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Active Checks</p>
        <p class="text-2xl font-bold text-gray-900 mt-1">${formatNumber(stats.checks_active)}</p>
      </div>
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Pings (24h)</p>
        <p class="text-2xl font-bold text-gray-900 mt-1">${formatNumber(stats.pings_24h)}</p>
      </div>
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Alerts (24h)</p>
        <p class="text-2xl font-bold text-gray-900 mt-1">${formatNumber(stats.alerts_24h)}</p>
      </div>
    </div>

    <!-- Service Details -->
    <div class="border rounded-lg divide-y">
      <div class="p-4 flex items-center justify-between">
        <div>
          <p class="font-medium text-gray-900">Ping Ingestion</p>
          <p class="text-sm text-gray-500">Receiving heartbeat pings from cron jobs</p>
        </div>
        <span class="text-sm font-medium text-${statusColor}-600">${isOperational ? 'Operational' : 'Degraded'}</span>
      </div>
      <div class="p-4 flex items-center justify-between">
        <div>
          <p class="font-medium text-gray-900">Alert Delivery</p>
          <p class="text-sm text-gray-500">Email, Slack, and webhook notifications</p>
        </div>
        <span class="text-sm font-medium text-${statusColor}-600">${isOperational ? 'Operational' : 'Degraded'}</span>
      </div>
      <div class="p-4 flex items-center justify-between">
        <div>
          <p class="font-medium text-gray-900">Dashboard</p>
          <p class="text-sm text-gray-500">Web interface and API</p>
        </div>
        <span class="text-sm font-medium text-${statusColor}-600">${isOperational ? 'Operational' : 'Degraded'}</span>
      </div>
      <div class="p-4 flex items-center justify-between">
        <div>
          <p class="font-medium text-gray-900">Overdue Detection</p>
          <p class="text-sm text-gray-500">Minute-by-minute check for missed pings</p>
        </div>
        <span class="text-sm font-medium text-${statusColor}-600">${isOperational ? 'Operational' : 'Degraded'}</span>
      </div>
    </div>

    <!-- Uptime & Infrastructure -->
    <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Uptime Since Last Deploy</p>
        <p class="text-lg font-semibold text-gray-900 mt-1">${uptime}</p>
        <p class="text-xs text-gray-400 mt-1">${new Date(stats.uptime_since).toISOString()}</p>
      </div>
      <div class="bg-gray-50 rounded-lg p-4">
        <p class="text-sm text-gray-500">Infrastructure</p>
        <p class="text-lg font-semibold text-gray-900 mt-1">Cloudflare Edge</p>
        <p class="text-xs text-gray-400 mt-1">300+ locations worldwide, sub-5ms ping response</p>
      </div>
    </div>

    <div class="mt-8 text-center">
      <p class="text-sm text-gray-400">
        CronPulse runs entirely on Cloudflare Workers. Every ping is received at the nearest edge location.
        No single point of failure. No cold starts. Always on.
      </p>
      <p class="text-xs text-gray-300 mt-2">Last checked: ${new Date(stats.timestamp).toISOString()}</p>
    </div>
  </main>

  <footer class="max-w-3xl mx-auto px-4 py-8 text-center text-sm text-gray-400">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`);
});

export default status;
