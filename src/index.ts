import { Hono } from 'hono';
import type { Env } from './types';
import ping from './routes/ping';
import auth from './routes/auth';
import dashboard from './routes/dashboard';
import webhooks from './routes/webhooks';
import { checkOverdue } from './cron/check-overdue';
import { retryFailedAlerts } from './cron/retry-alerts';
import { cleanupAndSync } from './cron/cleanup';
import { aggregateStats } from './cron/aggregate';
import blog from './routes/blog';
import docsRoute from './routes/docs';
import api from './routes/api';
import status from './routes/status';
import badge from './routes/badge';
import analytics from './routes/analytics';
import { renderLandingPage } from './views/landing';

const app = new Hono<{ Bindings: Env }>();

// Landing page
app.get('/', (c) => c.html(renderLandingPage(c.env.APP_URL)));

// Ping endpoint (public, no auth)
app.route('/ping', ping);

// Auth routes
app.route('/auth', auth);

// Webhooks (public, signature-verified)
app.route('/webhooks', webhooks);

// Blog (public, SEO content)
app.route('/blog', blog);

// API docs (public)
app.route('/docs', docsRoute);

// Status page (public)
app.route('/status', status);

// Status badge SVG (public)
app.route('/badge', badge);

// Analytics (admin only, requires SESSION_SECRET as key)
app.route('/analytics', analytics);

// API v1 (API key auth)
app.route('/api/v1', api);

// Dashboard (requires auth)
app.route('/dashboard', dashboard);

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// SEO: robots.txt
app.get('/robots.txt', (c) => {
  return c.text(`User-agent: *
Allow: /
Allow: /blog/
Disallow: /dashboard/
Disallow: /api/
Disallow: /auth/
Disallow: /webhooks/
Disallow: /analytics/

Sitemap: ${c.env.APP_URL}/sitemap.xml`);
});

// SEO: sitemap.xml
app.get('/sitemap.xml', (c) => {
  const urls = [
    { loc: '', priority: '1.0' },
    { loc: '/blog', priority: '0.8' },
    { loc: '/blog/how-to-monitor-cron-jobs', priority: '0.7' },
    { loc: '/blog/cron-job-failures', priority: '0.7' },
    { loc: '/blog/healthchecks-vs-cronitor-vs-cronpulse', priority: '0.7' },
    { loc: '/docs', priority: '0.8' },
    { loc: '/status', priority: '0.6' },
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${c.env.APP_URL}${u.loc}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;
  return c.text(xml, 200, { 'Content-Type': 'application/xml' });
});

// 404
app.notFound((c) => c.text('Not Found', 404));

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.text('Internal Server Error', 500);
});

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const cron = event.cron;

    switch (cron) {
      case '*/1 * * * *':
        // Every minute: check for overdue checks and send alerts
        ctx.waitUntil(checkOverdue(env));
        ctx.waitUntil(retryFailedAlerts(env));
        break;

      case '*/5 * * * *':
        // Every 5 minutes: cleanup expired tokens, sync KV
        ctx.waitUntil(cleanupAndSync(env));
        break;

      case '0 * * * *':
        // Every hour: aggregate stats, cleanup old data
        ctx.waitUntil(aggregateStats(env));
        break;
    }
  },
};
