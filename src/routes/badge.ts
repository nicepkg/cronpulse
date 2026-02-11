import { Hono } from 'hono';
import type { Env } from '../types';

const badge = new Hono<{ Bindings: Env }>();

interface BadgeConfig {
  label: string;
  message: string;
  color: string;
}

function statusToBadge(status: string | null): BadgeConfig {
  switch (status) {
    case 'up':
      return { label: 'cronpulse', message: 'up', color: '#22c55e' };
    case 'down':
      return { label: 'cronpulse', message: 'down', color: '#ef4444' };
    case 'late':
      return { label: 'cronpulse', message: 'late', color: '#f59e0b' };
    case 'paused':
      return { label: 'cronpulse', message: 'paused', color: '#6b7280' };
    case 'new':
      return { label: 'cronpulse', message: 'new', color: '#3b82f6' };
    default:
      return { label: 'cronpulse', message: 'unknown', color: '#9ca3af' };
  }
}

function renderBadgeSvg(cfg: BadgeConfig): string {
  const labelWidth = cfg.label.length * 7 + 10;
  const messageWidth = cfg.message.length * 7 + 10;
  const totalWidth = labelWidth + messageWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${cfg.label}: ${cfg.message}">
  <title>${cfg.label}: ${cfg.message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${cfg.color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${cfg.label}</text>
    <text x="${labelWidth / 2}" y="14">${cfg.label}</text>
    <text aria-hidden="true" x="${labelWidth + messageWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${cfg.message}</text>
    <text x="${labelWidth + messageWidth / 2}" y="14">${cfg.message}</text>
  </g>
</svg>`;
}

// GET /badge/:checkId - Public SVG status badge
badge.get('/:checkId', async (c) => {
  const checkId = c.req.param('checkId');

  // Try KV cache first for speed
  let status: string | null = null;

  try {
    const cached = await c.env.KV.get(`check:${checkId}`, 'json') as any;
    if (cached) status = cached.status;
  } catch {}

  if (!status) {
    const check = await c.env.DB.prepare(
      'SELECT status FROM checks WHERE id = ?'
    ).bind(checkId).first<{ status: string }>();

    if (!check) {
      const cfg = { label: 'cronpulse', message: 'not found', color: '#9ca3af' };
      return c.body(renderBadgeSvg(cfg), 404, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-cache, no-store',
      });
    }
    status = check.status;
  }

  const cfg = statusToBadge(status);
  return c.body(renderBadgeSvg(cfg), 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'max-age=30, s-maxage=30',
  });
});

// GET /badge/:checkId/uptime - Uptime percentage badge
badge.get('/:checkId/uptime', async (c) => {
  const checkId = c.req.param('checkId');
  const period = c.req.query('period') || '24h';

  let seconds = 86400;
  if (period === '7d') seconds = 7 * 86400;
  else if (period === '30d') seconds = 30 * 86400;

  const since = Math.floor(Date.now() / 1000) - seconds;

  const check = await c.env.DB.prepare(
    'SELECT id FROM checks WHERE id = ?'
  ).bind(checkId).first();

  if (!check) {
    const cfg = { label: 'uptime', message: 'not found', color: '#9ca3af' };
    return c.body(renderBadgeSvg(cfg), 404, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache, no-store',
    });
  }

  const result = await c.env.DB.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN type = 'success' THEN 1 ELSE 0 END) as ok FROM pings WHERE check_id = ? AND timestamp > ?"
  ).bind(checkId, since).first<{ total: number; ok: number }>();

  let message = 'N/A';
  let color = '#9ca3af';

  if (result && result.total > 0) {
    const pct = (result.ok / result.total) * 100;
    message = pct.toFixed(1) + '%';
    if (pct >= 99.5) color = '#22c55e';
    else if (pct >= 95) color = '#f59e0b';
    else color = '#ef4444';
  }

  const cfg = { label: `uptime ${period}`, message, color };
  return c.body(renderBadgeSvg(cfg), 200, {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'max-age=60, s-maxage=60',
  });
});

export default badge;
