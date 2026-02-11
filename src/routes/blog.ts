import { Hono } from 'hono';
import type { Env } from '../types';

const blog = new Hono<{ Bindings: Env }>();

interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  content: string;
}

const posts: BlogPost[] = [
  {
    slug: 'how-to-monitor-cron-jobs',
    title: 'How to Monitor Cron Jobs: A Complete Guide (2026)',
    description: 'Learn why cron jobs fail silently and how to monitor them with a simple curl command. Covers log-based, heartbeat, and agent-based monitoring approaches.',
    date: '2026-02-12',
    content: renderPost1(),
  },
  {
    slug: 'cron-job-failures',
    title: '5 Cron Job Failures That Will Wake You Up at 3 AM',
    description: 'Real stories of cron job failures: phantom backups, overlapping jobs, timezone disasters, silent permission errors, and dependency chain collapses.',
    date: '2026-02-12',
    content: renderPost2(),
  },
  {
    slug: 'healthchecks-vs-cronitor-vs-cronpulse',
    title: 'Healthchecks.io vs Cronitor vs CronPulse: Cron Monitoring Compared',
    description: 'An honest comparison of the three most popular cron monitoring tools. Features, pricing, architecture, and which fits your use case.',
    date: '2026-02-12',
    content: renderPost3(),
  },
];

// Blog index
blog.get('/', (c) => {
  return c.html(renderBlogIndex(posts, c.env.APP_URL));
});

// Individual blog post
blog.get('/:slug', (c) => {
  const slug = c.req.param('slug');
  const post = posts.find(p => p.slug === slug);
  if (!post) return c.notFound();
  return c.html(renderBlogPost(post, c.env.APP_URL));
});

function renderBlogIndex(posts: BlogPost[], appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog - CronPulse</title>
  <meta name="description" content="Practical guides on cron job monitoring, alerting, and reliability. From the team behind CronPulse.">
  <link rel="canonical" href="${appUrl}/blog">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white">
  <nav class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
    <a href="/" class="text-xl font-bold">CronPulse</a>
    <div class="flex items-center gap-4">
      <a href="/blog" class="text-sm text-gray-900 font-medium">Blog</a>
      <a href="/#pricing" class="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto px-4 py-12">
    <h1 class="text-3xl font-bold mb-2">Blog</h1>
    <p class="text-gray-600 mb-10">Practical guides on cron job monitoring and reliability.</p>

    <div class="space-y-8">
      ${posts.map(post => `
        <article class="border-b pb-8">
          <a href="/blog/${post.slug}" class="group">
            <h2 class="text-xl font-semibold group-hover:text-blue-600">${esc(post.title)}</h2>
            <p class="text-gray-600 mt-2 text-sm">${esc(post.description)}</p>
            <time class="text-xs text-gray-400 mt-2 block">${post.date}</time>
          </a>
        </article>
      `).join('')}
    </div>
  </main>

  <footer class="max-w-3xl mx-auto px-4 py-8 text-center text-sm text-gray-400">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`;
}

function renderBlogPost(post: BlogPost, appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(post.title)} - CronPulse Blog</title>
  <meta name="description" content="${esc(post.description)}">
  <link rel="canonical" href="${appUrl}/blog/${post.slug}">
  <meta property="og:title" content="${esc(post.title)}">
  <meta property="og:description" content="${esc(post.description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${appUrl}/blog/${post.slug}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .prose h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2rem; margin-bottom: 0.75rem; }
    .prose h3 { font-size: 1.25rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .prose p { margin-bottom: 1rem; line-height: 1.75; color: #374151; }
    .prose ul, .prose ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    .prose li { margin-bottom: 0.25rem; line-height: 1.75; color: #374151; }
    .prose ul { list-style-type: disc; }
    .prose ol { list-style-type: decimal; }
    .prose code { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; }
    .prose pre { background: #111827; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; }
    .prose pre code { background: transparent; padding: 0; color: inherit; }
    .prose blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; margin-bottom: 1rem; color: #6b7280; font-style: italic; }
    .prose table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.875rem; }
    .prose th, .prose td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
    .prose th { background: #f9fafb; font-weight: 600; }
    .prose strong { font-weight: 700; }
    .prose a { color: #2563eb; text-decoration: underline; }
  </style>
</head>
<body class="bg-white">
  <nav class="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
    <a href="/" class="text-xl font-bold">CronPulse</a>
    <div class="flex items-center gap-4">
      <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900">Blog</a>
      <a href="/#pricing" class="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
    </div>
  </nav>

  <main class="max-w-3xl mx-auto px-4 py-12">
    <article>
      <header class="mb-8">
        <a href="/blog" class="text-sm text-blue-600 hover:underline">&larr; Back to blog</a>
        <h1 class="text-3xl font-bold mt-4">${esc(post.title)}</h1>
        <time class="text-sm text-gray-400 mt-2 block">${post.date}</time>
      </header>
      <div class="prose">
        ${post.content}
      </div>
    </article>

    <div class="mt-12 bg-blue-50 rounded-lg p-6 text-center">
      <h3 class="text-lg font-semibold">Start monitoring your cron jobs in 30 seconds</h3>
      <p class="text-gray-600 text-sm mt-2">Free for up to 10 checks. No credit card required.</p>
      <a href="/auth/login" class="inline-block mt-4 bg-blue-600 text-white px-6 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started Free</a>
    </div>
  </main>

  <footer class="max-w-3xl mx-auto px-4 py-8 text-center text-sm text-gray-400">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`;
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPost1(): string {
  return `
<p><em>Your database backup runs every night at 2 AM. Your invoice generator fires every Monday morning. Your cache warmer triggers every 15 minutes. But how do you know they actually ran?</em></p>

<h2>Why Cron Jobs Fail Silently</h2>
<p>Cron jobs are the silent workhorses of every production system. They handle backups, send emails, sync data, generate reports, and clean up temporary files. They run in the background, and nobody thinks about them &mdash; until they stop.</p>
<p>The dangerous thing about cron jobs is that <strong>they fail silently</strong>. A web server goes down and your monitoring tool screams immediately. A cron job stops running and... nothing happens. No error. No alert. Just silence.</p>

<h2>Three Approaches to Cron Monitoring</h2>

<h3>1. Log-Based Monitoring</h3>
<p>Parse cron output logs and alert on anomalies. Works for simple setups but doesn't catch jobs that never ran.</p>

<h3>2. Heartbeat / Dead Man's Switch</h3>
<p>Your cron job pings a URL when it completes. If the ping doesn't arrive on time, you get an alert. This is the most reliable approach because it catches <em>all</em> failure modes: crashed scripts, deleted crontabs, server outages, and permission errors.</p>
<pre><code># Add this to the end of your cron job:
curl -fsS --retry 3 https://cron-pulse.com/ping/YOUR_CHECK_ID</code></pre>

<h3>3. Agent-Based Monitoring</h3>
<p>Install an agent on the server that watches the cron daemon directly. Heavier but provides the most detail.</p>

<h2>Setting Up Heartbeat Monitoring with CronPulse</h2>
<ol>
  <li><strong>Create a check</strong> &mdash; Set the expected interval (e.g., every 1 hour) and grace period (e.g., 5 minutes)</li>
  <li><strong>Add one line to your script</strong> &mdash; <code>curl -fsS https://cron-pulse.com/ping/YOUR_ID</code></li>
  <li><strong>Get alerted</strong> &mdash; If the ping doesn't arrive, CronPulse sends email, Slack, or webhook alerts</li>
</ol>

<h2>Best Practices</h2>
<ul>
  <li>Monitor <em>every</em> cron job, not just the "important" ones</li>
  <li>Set grace periods to avoid false alarms from slow runs</li>
  <li>Use recovery notifications to know when issues resolve</li>
  <li>Set up multiple notification channels (email + Slack)</li>
  <li>Test your monitoring by temporarily pausing a job</li>
</ul>

<h2>Conclusion</h2>
<p>Cron job monitoring isn't optional &mdash; it's a fundamental part of production reliability. The heartbeat pattern (ping a URL on success) is the simplest and most reliable approach. Set it up once and never worry about silent cron failures again.</p>
`;
}

function renderPost2(): string {
  return `
<p><em>Every one of these stories is based on real incidents. The names have been changed, but the cold sweats were real.</em></p>

<h2>1. The Phantom Backup</h2>
<h3>The Story</h3>
<p>Marcus set up automated PostgreSQL backups six months ago. The crontab was clean, the script was tested, and the backups ran faithfully to S3 every night at 1 AM.</p>
<p>Then the company upgraded from Ubuntu 22.04 to 24.04. The upgrade reset the crontab for the <code>postgres</code> user. No backup ran for <strong>17 days</strong> until a disaster recovery drill revealed empty S3 directories.</p>
<h3>The Fix</h3>
<p>Heartbeat monitoring. If the backup script doesn't ping a monitoring endpoint after completion, alert immediately. Marcus would have known within hours, not weeks.</p>

<h2>2. The Overlapping Stampede</h2>
<h3>The Story</h3>
<p>A data pipeline job was scheduled every 15 minutes. Normally it took 3 minutes. One day the upstream API slowed down, and the job started taking 20 minutes. Multiple instances started overlapping, each consuming more memory and database connections.</p>
<h3>The Fix</h3>
<p>Use a lock file or <code>flock</code> to prevent overlapping. Monitor job duration alongside completion. CronPulse's ping history shows when runs take longer than expected.</p>

<h2>3. The Timezone Trap</h2>
<h3>The Story</h3>
<p>A billing job ran at <code>0 9 * * *</code> &mdash; 9 AM server time. When the team migrated to a cloud provider in a different region, the server timezone changed. The billing job now ran at 9 AM UTC, which was 2 AM Pacific. Customers received invoices in the middle of the night.</p>
<h3>The Fix</h3>
<p>Always use UTC in crontabs and convert to local time in your application. Monitor that jobs run at the expected times.</p>

<h2>4. The Silent Permission Error</h2>
<h3>The Story</h3>
<p>A cleanup script ran as root for two years. A security audit recommended running it as a service account. After the change, the script silently failed &mdash; it couldn't read the directories it needed to clean. The cron daemon logged "Permission denied" to a file nobody was watching.</p>
<h3>The Fix</h3>
<p>Only ping the monitoring endpoint <em>after</em> successful completion: <code>./cleanup.sh && curl https://cron-pulse.com/ping/ID</code>. If the script fails, the ping never fires.</p>

<h2>5. The Dependency Chain Collapse</h2>
<h3>The Story</h3>
<p>Job A exports data at midnight. Job B processes it at 1 AM. Job C generates reports from it at 2 AM. One night, Job A failed silently. Job B processed stale data. Job C generated wrong reports. The CEO presented incorrect numbers at a board meeting.</p>
<h3>The Fix</h3>
<p>Monitor each job independently. When Job A fails, you catch it immediately instead of discovering the problem downstream. Chain your monitoring: if A doesn't ping, you know B and C are also affected.</p>

<h2>Prevention Checklist</h2>
<ul>
  <li>Every cron job gets a heartbeat monitor</li>
  <li>Only ping on <em>successful</em> completion</li>
  <li>Set grace periods appropriate to job duration</li>
  <li>Use lock files to prevent overlap</li>
  <li>Always use UTC in crontabs</li>
  <li>Test monitoring after server changes</li>
</ul>
`;
}

function renderPost3(): string {
  return `
<p><em>An honest comparison of the three most popular cron monitoring tools. We publish this on the CronPulse blog, so we'll be upfront about our biases.</em></p>

<h2>Quick Comparison</h2>
<table>
  <thead>
    <tr><th>Feature</th><th>Healthchecks.io</th><th>Cronitor</th><th>CronPulse</th></tr>
  </thead>
  <tbody>
    <tr><td><strong>Free tier</strong></td><td>20 checks</td><td>5 monitors</td><td>10 checks</td></tr>
    <tr><td><strong>Starting price</strong></td><td>$20/mo</td><td>~$40/mo</td><td>$5/mo</td></tr>
    <tr><td><strong>100 checks</strong></td><td>$20/mo</td><td>~$200/mo</td><td>$15/mo</td></tr>
    <tr><td><strong>Self-host option</strong></td><td>Yes (open source)</td><td>No</td><td>No</td></tr>
    <tr><td><strong>Infrastructure</strong></td><td>Traditional servers</td><td>Traditional servers</td><td>Cloudflare edge (300+ PoPs)</td></tr>
    <tr><td><strong>Notification types</strong></td><td>20+ integrations</td><td>10+ integrations</td><td>Email, Webhook, Slack</td></tr>
    <tr><td><strong>Cron expression parsing</strong></td><td>Yes</td><td>Yes</td><td>Interval-based</td></tr>
  </tbody>
</table>

<h2>Healthchecks.io</h2>
<p><strong>Best for:</strong> Teams that want maximum integrations or need self-hosting.</p>
<p>Healthchecks.io is the grandfather of heartbeat monitoring. Open source, battle-tested, and packed with integrations. The free tier is generous at 20 checks. The UI is functional but dated.</p>
<p><strong>Strengths:</strong> Open source, self-hostable, 20+ notification integrations, cron expression parsing, mature and stable.</p>
<p><strong>Weaknesses:</strong> UI feels dated, no edge-based architecture, pricing jumps from free to $20/mo.</p>

<h2>Cronitor</h2>
<p><strong>Best for:</strong> Enterprise teams that need deep cron analysis and SDK integrations.</p>
<p>Cronitor is the enterprise option. It offers SDKs for multiple languages, cron expression parsing, and detailed analytics. It's also the most expensive option by a significant margin.</p>
<p><strong>Strengths:</strong> Language SDKs, deep cron analysis, enterprise features, strong documentation.</p>
<p><strong>Weaknesses:</strong> Expensive (especially at scale), minimum $40/mo for paid, complex for simple use cases.</p>

<h2>CronPulse</h2>
<p><strong>Best for:</strong> Developers and small teams who want simple, affordable monitoring with global edge performance.</p>
<p>CronPulse is the newest entrant, built entirely on Cloudflare's edge network. Every ping is received at the nearest of 300+ global locations with sub-5ms response time. The tradeoff is fewer integrations and features compared to mature alternatives.</p>
<p><strong>Strengths:</strong> Cheapest paid tier ($5/mo), global edge network, simple setup, fast ping response.</p>
<p><strong>Weaknesses:</strong> Newer (less battle-tested), fewer integrations, no cron expression parsing, no self-host option.</p>

<h2>The Bottom Line</h2>
<ul>
  <li><strong>Need self-hosting?</strong> &rarr; Healthchecks.io is your only option</li>
  <li><strong>Need enterprise features and SDKs?</strong> &rarr; Cronitor is worth the premium</li>
  <li><strong>Want simple, affordable monitoring?</strong> &rarr; CronPulse starts at $5/mo</li>
  <li><strong>Just want free?</strong> &rarr; Healthchecks.io (20 checks) or CronPulse (10 checks)</li>
</ul>
<p>All three tools solve the core problem: knowing when your cron jobs fail. Pick the one that matches your needs and budget, and set it up today. The cost of <em>not</em> monitoring is always higher.</p>
`;
}

export default blog;
