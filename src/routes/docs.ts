import { Hono } from 'hono';
import type { Env } from '../types';

const docs = new Hono<{ Bindings: Env }>();

docs.get('/', (c) => {
  return c.html(renderDocsPage(c.env.APP_URL));
});

function renderDocsPage(appUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>API Documentation - CronPulse</title>
  <meta name="description" content="CronPulse REST API documentation. Manage cron job checks, view ping history, and configure alerts programmatically.">
  <link rel="canonical" href="${appUrl}/docs">
  <meta property="og:title" content="CronPulse API Documentation">
  <meta property="og:description" content="REST API for managing cron job monitoring checks programmatically.">
  <meta property="og:url" content="${appUrl}/docs">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .prose h2 { font-size: 1.5rem; font-weight: 700; margin-top: 2.5rem; margin-bottom: 0.75rem; padding-top: 1.5rem; border-top: 1px solid #e5e7eb; }
    .prose h3 { font-size: 1.125rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .prose p { margin-bottom: 1rem; line-height: 1.75; color: #374151; }
    .prose ul { margin-bottom: 1rem; padding-left: 1.5rem; list-style-type: disc; }
    .prose li { margin-bottom: 0.25rem; line-height: 1.75; color: #374151; }
    .prose code { background: #f3f4f6; padding: 0.125rem 0.375rem; border-radius: 0.25rem; font-size: 0.875rem; }
    .prose pre { background: #111827; color: #e5e7eb; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-bottom: 1rem; }
    .prose pre code { background: transparent; padding: 0; color: inherit; }
    .prose table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; font-size: 0.875rem; }
    .prose th, .prose td { border: 1px solid #e5e7eb; padding: 0.5rem 0.75rem; text-align: left; }
    .prose th { background: #f9fafb; font-weight: 600; }
    .prose strong { font-weight: 700; }
    .prose a { color: #2563eb; text-decoration: underline; }
    .method { display: inline-block; font-size: 0.75rem; font-weight: 700; padding: 0.125rem 0.5rem; border-radius: 0.25rem; margin-right: 0.5rem; font-family: monospace; }
    .method-get { background: #dbeafe; color: #1d4ed8; }
    .method-post { background: #dcfce7; color: #16a34a; }
    .method-patch { background: #fef3c7; color: #d97706; }
    .method-delete { background: #fee2e2; color: #dc2626; }
    .endpoint { font-family: monospace; font-size: 0.875rem; color: #111827; }
    .sidebar a { display: block; padding: 0.25rem 0; font-size: 0.875rem; color: #6b7280; }
    .sidebar a:hover { color: #111827; }
  </style>
</head>
<body class="bg-white">
  <nav class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between border-b">
    <a href="/" class="text-xl font-bold">CronPulse</a>
    <div class="flex items-center gap-2 sm:gap-4">
      <a href="/docs" class="text-sm text-gray-900 font-medium hidden sm:inline">Docs</a>
      <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900 hidden sm:inline">Blog</a>
      <a href="/#pricing" class="text-sm text-gray-600 hover:text-gray-900 hidden sm:inline">Pricing</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-3 py-1.5 sm:px-4 sm:py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
    </div>
  </nav>

  <div class="max-w-5xl mx-auto px-4 py-12 flex gap-12">
    <!-- Sidebar -->
    <aside class="sidebar hidden md:block w-48 flex-shrink-0">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Getting Started</p>
      <a href="#authentication">Authentication</a>
      <a href="#base-url">Base URL</a>
      <a href="#errors">Errors</a>
      <a href="#rate-limiting">Rate limiting</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Checks</p>
      <a href="#list-checks">List checks</a>
      <a href="#create-check">Create check</a>
      <a href="#get-check">Get check</a>
      <a href="#update-check">Update check</a>
      <a href="#delete-check">Delete check</a>
      <a href="#pause-check">Pause check</a>
      <a href="#resume-check">Resume check</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Import &amp; Export</p>
      <a href="#export-checks">Export checks</a>
      <a href="#import-checks">Import checks</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Pings &amp; Alerts</p>
      <a href="#ping-history">Ping history</a>
      <a href="#alert-history">Alert history</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Ping Endpoint</p>
      <a href="#send-ping">Send a ping</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Badges</p>
      <a href="#status-badge">Status badge</a>
      <a href="#uptime-badge">Uptime badge</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Webhooks</p>
      <a href="#webhook-signatures">Signature verification</a>
      <a href="#webhook-events">Event types</a>
      <a href="#webhook-retries">Automatic retries</a>
    </aside>

    <!-- Content -->
    <main class="prose flex-1 min-w-0">
      <h1 class="text-3xl font-bold mb-2" style="border-top:none;margin-top:0;padding-top:0;">API Documentation</h1>
      <p>Manage your CronPulse checks programmatically using the REST API. Available on <strong>Pro</strong> and <strong>Business</strong> plans.</p>

      <h2 id="base-url">Base URL</h2>
      <pre><code>${appUrl}/api/v1</code></pre>
      <p>All API endpoints are relative to this base URL.</p>

      <h2 id="authentication">Authentication</h2>
      <p>Authenticate by including your API key in the <code>Authorization</code> header:</p>
      <pre><code>Authorization: Bearer YOUR_API_KEY</code></pre>
      <p>Generate your API key in <strong>Dashboard &rarr; Settings</strong>. Your key is shown only once &mdash; store it securely.</p>
      <p>API access requires a <strong>Pro</strong> or <strong>Business</strong> plan. Free and Starter plans can manage checks via the dashboard.</p>

      <h2 id="errors">Error Responses</h2>
      <p>All errors return JSON with an <code>error</code> field:</p>
      <pre><code>{
  "error": "Description of what went wrong"
}</code></pre>
      <table>
        <thead>
          <tr><th>Status</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr><td><code>400</code></td><td>Invalid request parameters</td></tr>
          <tr><td><code>401</code></td><td>Missing or invalid API key</td></tr>
          <tr><td><code>403</code></td><td>Plan doesn't include API access, or check limit reached</td></tr>
          <tr><td><code>404</code></td><td>Resource not found</td></tr>
          <tr><td><code>429</code></td><td>Rate limit exceeded (see <a href="#rate-limiting">Rate Limiting</a>)</td></tr>
          <tr><td><code>500</code></td><td>Internal server error</td></tr>
        </tbody>
      </table>

      <h2 id="rate-limiting">Rate Limiting</h2>
      <p>The API enforces a rate limit of <strong>60 requests per minute</strong> per authenticated user. Rate limit information is included in every response via headers:</p>
      <table>
        <thead><tr><th>Header</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>X-RateLimit-Limit</code></td><td>Maximum requests per window (60)</td></tr>
          <tr><td><code>X-RateLimit-Remaining</code></td><td>Requests remaining in current window</td></tr>
          <tr><td><code>Retry-After</code></td><td>Seconds until the rate limit resets (only on 429)</td></tr>
        </tbody>
      </table>
      <p>When the limit is exceeded, the API returns <code>429 Too Many Requests</code>:</p>
      <pre><code>{
  "error": "Rate limit exceeded",
  "retry_after": 60
}</code></pre>
      <p><strong>Note:</strong> The ping endpoint (<code>/ping/:id</code>) is <em>not</em> rate limited &mdash; your cron jobs can ping as frequently as needed.</p>

      <h2 id="list-checks">List All Checks</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/api/v1/checks</span></p>
      <p>Returns all checks for the authenticated user, ordered by creation date (newest first).</p>
      <pre><code>curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "checks": [
    {
      "id": "abc123",
      "name": "Nightly backup",
      "period": 86400,
      "grace": 300,
      "status": "up",
      "last_ping_at": 1707700000,
      "next_expected_at": 1707786400,
      "alert_count": 0,
      "ping_count": 42,
      "created_at": 1707000000,
      "updated_at": 1707700000
    }
  ]
}</code></pre>

      <h2 id="create-check">Create a Check</h2>
      <p><span class="method method-post">POST</span> <span class="endpoint">/api/v1/checks</span></p>
      <h3>Request Body</h3>
      <table>
        <thead><tr><th>Field</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>name</code></td><td>string</td><td>"Unnamed Check"</td><td>Name for the check</td></tr>
          <tr><td><code>period</code></td><td>integer</td><td>3600</td><td>Expected interval in seconds (60 &ndash; 604800)</td></tr>
          <tr><td><code>grace</code></td><td>integer</td><td>300</td><td>Grace period in seconds (60 &ndash; 3600)</td></tr>
          <tr><td><code>tags</code></td><td>string or string[]</td><td>""</td><td>Comma-separated tags or array, e.g. <code>"production,database"</code></td></tr>
          <tr><td><code>maint_start</code></td><td>integer|null</td><td>null</td><td>One-time maintenance window start (Unix timestamp)</td></tr>
          <tr><td><code>maint_end</code></td><td>integer|null</td><td>null</td><td>One-time maintenance window end (Unix timestamp)</td></tr>
          <tr><td><code>maint_schedule</code></td><td>string</td><td>""</td><td>Recurring maintenance schedule, e.g. <code>"daily:02:00-04:00"</code>, <code>"sun:02:00-06:00"</code></td></tr>
        </tbody>
      </table>
      <h3>Maintenance Schedule Format</h3>
      <p>Recurring maintenance windows suppress alerts during scheduled maintenance. Format: <code>day(s):HH:MM-HH:MM</code> (UTC).</p>
      <table>
        <thead><tr><th>Schedule</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>daily:02:00-04:00</code></td><td>Every day 2:00&ndash;4:00 UTC</td></tr>
          <tr><td><code>weekdays:03:00-05:00</code></td><td>Mon&ndash;Fri 3:00&ndash;5:00 UTC</td></tr>
          <tr><td><code>weekends:00:00-06:00</code></td><td>Sat&ndash;Sun 0:00&ndash;6:00 UTC</td></tr>
          <tr><td><code>sun:02:00-06:00</code></td><td>Every Sunday 2:00&ndash;6:00 UTC</td></tr>
          <tr><td><code>mon,wed,fri:04:00-05:00</code></td><td>Mon, Wed, Fri 4:00&ndash;5:00 UTC</td></tr>
        </tbody>
      </table>
      <pre><code>curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Nightly backup", "period": 86400, "grace": 600, "tags": "production,database", "maint_schedule": "daily:02:00-04:00"}' \\
  ${appUrl}/api/v1/checks</code></pre>
      <h3>Response <code>201</code></h3>
      <pre><code>{
  "check": {
    "id": "abc123",
    "name": "Nightly backup",
    "period": 86400,
    "grace": 600,
    "status": "new",
    ...
  },
  "ping_url": "${appUrl}/ping/abc123"
}</code></pre>

      <h2 id="get-check">Get a Check</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/api/v1/checks/:id</span></p>
      <pre><code>curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks/abc123</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "check": { ... },
  "ping_url": "${appUrl}/ping/abc123"
}</code></pre>

      <h2 id="update-check">Update a Check</h2>
      <p><span class="method method-patch">PATCH</span> <span class="endpoint">/api/v1/checks/:id</span></p>
      <p>Update name, period, or grace. Only include the fields you want to change.</p>
      <pre><code>curl -X PATCH -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Daily DB backup", "grace": 900}' \\
  ${appUrl}/api/v1/checks/abc123</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "check": { ... }
}</code></pre>

      <h2 id="delete-check">Delete a Check</h2>
      <p><span class="method method-delete">DELETE</span> <span class="endpoint">/api/v1/checks/:id</span></p>
      <pre><code>curl -X DELETE -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks/abc123</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "deleted": true
}</code></pre>

      <h2 id="pause-check">Pause a Check</h2>
      <p><span class="method method-post">POST</span> <span class="endpoint">/api/v1/checks/:id/pause</span></p>
      <p>Pauses monitoring. No alerts will fire while paused.</p>
      <pre><code>curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks/abc123/pause</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "paused": true
}</code></pre>

      <h2 id="resume-check">Resume a Check</h2>
      <p><span class="method method-post">POST</span> <span class="endpoint">/api/v1/checks/:id/resume</span></p>
      <p>Resumes monitoring after a pause. Status resets to <code>new</code> until the next ping.</p>
      <pre><code>curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks/abc123/resume</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "resumed": true
}</code></pre>

      <h2 id="export-checks">Export Checks</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/api/v1/checks/export</span></p>
      <p>Export all checks as a JSON file. Useful for backup or migration.</p>
      <pre><code>curl -H "Authorization: Bearer YOUR_API_KEY" \\
  ${appUrl}/api/v1/checks/export</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "version": 1,
  "exported_at": "2026-02-12T10:30:00.000Z",
  "checks": [
    {
      "name": "Nightly backup",
      "period": 86400,
      "grace": 300,
      "tags": "production,database"
    }
  ]
}</code></pre>

      <h2 id="import-checks">Import Checks</h2>
      <p><span class="method method-post">POST</span> <span class="endpoint">/api/v1/checks/import</span></p>
      <p>Import checks from a JSON payload. Uses the same format as the export endpoint. Checks that exceed your plan limit will be skipped.</p>
      <h3>Request Body</h3>
      <pre><code>{
  "checks": [
    {
      "name": "Nightly backup",
      "period": 86400,
      "grace": 300,
      "tags": "production,database"
    },
    {
      "name": "Hourly sync",
      "period": 3600,
      "grace": 120
    }
  ]
}</code></pre>
      <pre><code>curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d @cronpulse-checks.json \\
  ${appUrl}/api/v1/checks/import</code></pre>
      <h3>Response <code>201</code></h3>
      <pre><code>{
  "imported": 2,
  "skipped": 0,
  "checks": [
    {
      "id": "abc123",
      "name": "Nightly backup",
      "ping_url": "${appUrl}/ping/abc123"
    },
    {
      "id": "def456",
      "name": "Hourly sync",
      "ping_url": "${appUrl}/ping/def456"
    }
  ]
}</code></pre>

      <h2 id="ping-history">Ping History</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/api/v1/checks/:id/pings</span></p>
      <table>
        <thead><tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>limit</code></td><td>integer</td><td>50</td><td>Max results (1 &ndash; 200)</td></tr>
          <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset</td></tr>
        </tbody>
      </table>
      <pre><code>curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${appUrl}/api/v1/checks/abc123/pings?limit=10"</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "pings": [
    {
      "id": 1,
      "check_id": "abc123",
      "timestamp": 1707700000,
      "source_ip": "203.0.113.1",
      "duration": null,
      "type": "success"
    }
  ]
}</code></pre>

      <h2 id="alert-history">Alert History</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/api/v1/checks/:id/alerts</span></p>
      <table>
        <thead><tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>limit</code></td><td>integer</td><td>50</td><td>Max results (1 &ndash; 200)</td></tr>
          <tr><td><code>offset</code></td><td>integer</td><td>0</td><td>Pagination offset</td></tr>
        </tbody>
      </table>
      <pre><code>curl -H "Authorization: Bearer YOUR_API_KEY" \\
  "${appUrl}/api/v1/checks/abc123/alerts?limit=10"</code></pre>
      <h3>Response</h3>
      <pre><code>{
  "alerts": [
    {
      "id": 1,
      "check_id": "abc123",
      "channel_id": "ch_001",
      "type": "down",
      "status": "sent",
      "error": null,
      "created_at": 1707700000,
      "sent_at": 1707700005
    }
  ]
}</code></pre>

      <h2 id="send-ping" style="border-top: 3px solid #2563eb; padding-top: 1.5rem;">Ping Endpoint</h2>
      <p>This is the public endpoint your cron jobs hit. <strong>No authentication required.</strong></p>
      <p><span class="method method-get">GET</span> <span class="endpoint">/ping/:id</span></p>
      <p>Send a ping to signal that your cron job ran successfully. Accepts GET, POST, or HEAD.</p>
      <pre><code># Add to the end of your cron job:
curl -fsS ${appUrl}/ping/YOUR_CHECK_ID</code></pre>
      <h3>Response</h3>
      <pre><code>OK</code></pre>
      <p>Returns <code>200 OK</code> on success, <code>404</code> if the check ID doesn't exist.</p>

      <h2 id="status-badge" style="border-top: 3px solid #2563eb; padding-top: 1.5rem;">Status Badge</h2>
      <p>Embed a live status badge in your README, docs, or status page. <strong>No authentication required.</strong></p>
      <p><span class="method method-get">GET</span> <span class="endpoint">/badge/:checkId</span></p>
      <p>Returns an SVG image showing the current status of a check: <code>up</code>, <code>down</code>, <code>late</code>, <code>paused</code>, or <code>new</code>.</p>
      <h3>Example</h3>
      <pre><code>&lt;!-- Markdown --&gt;
![CronPulse](${appUrl}/badge/YOUR_CHECK_ID)

&lt;!-- HTML --&gt;
&lt;img src="${appUrl}/badge/YOUR_CHECK_ID" alt="CronPulse status" /&gt;</code></pre>
      <h3>Response</h3>
      <p>Returns <code>image/svg+xml</code> with 30-second cache. Returns <code>404</code> with a "not found" badge if the check ID doesn't exist.</p>
      <table>
        <thead><tr><th>Status</th><th>Color</th></tr></thead>
        <tbody>
          <tr><td><code>up</code></td><td>Green (#22c55e)</td></tr>
          <tr><td><code>down</code></td><td>Red (#ef4444)</td></tr>
          <tr><td><code>late</code></td><td>Amber (#f59e0b)</td></tr>
          <tr><td><code>paused</code></td><td>Gray (#6b7280)</td></tr>
          <tr><td><code>new</code></td><td>Blue (#3b82f6)</td></tr>
        </tbody>
      </table>

      <h2 id="uptime-badge">Uptime Badge</h2>
      <p><span class="method method-get">GET</span> <span class="endpoint">/badge/:checkId/uptime</span></p>
      <p>Returns an SVG badge showing the uptime percentage for a check over a given period.</p>
      <h3>Query Parameters</h3>
      <table>
        <thead><tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>period</code></td><td>string</td><td><code>24h</code></td><td>Time window: <code>24h</code>, <code>7d</code>, or <code>30d</code></td></tr>
        </tbody>
      </table>
      <h3>Example</h3>
      <pre><code>&lt;!-- 24-hour uptime --&gt;
![Uptime](${appUrl}/badge/YOUR_CHECK_ID/uptime)

&lt;!-- 7-day uptime --&gt;
![Uptime 7d](${appUrl}/badge/YOUR_CHECK_ID/uptime?period=7d)

&lt;!-- 30-day uptime --&gt;
![Uptime 30d](${appUrl}/badge/YOUR_CHECK_ID/uptime?period=30d)</code></pre>
      <h3>Response</h3>
      <p>Returns <code>image/svg+xml</code> with 60-second cache. Color coded: green (&ge; 99.5%), amber (&ge; 95%), red (&lt; 95%).</p>

      <h2 id="webhook-signatures" style="border-top: 3px solid #2563eb; padding-top: 1.5rem;">Webhook Signature Verification</h2>
      <p>CronPulse signs all outgoing webhook notifications with HMAC-SHA256. This lets you verify that the payload was sent by CronPulse and hasn't been tampered with.</p>
      <h3>Setup</h3>
      <ol>
        <li>Go to <strong>Dashboard &rarr; Settings</strong> and click <strong>Generate Signing Secret</strong></li>
        <li>Copy the <code>whsec_...</code> secret and store it securely in your application</li>
        <li>Verify the <code>X-CronPulse-Signature</code> header on every incoming webhook</li>
      </ol>
      <h3>Verification</h3>
      <p>The <code>X-CronPulse-Signature</code> header contains a hex-encoded HMAC-SHA256 hash of the raw request body, signed with your webhook signing secret.</p>
      <pre><code># Node.js verification example
const crypto = require('crypto');

function verifySignature(body, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

// In your webhook handler:
app.post('/webhook', (req, res) =&gt; {
  const signature = req.headers['x-cronpulse-signature'];
  const isValid = verifySignature(
    req.rawBody, signature, process.env.CRONPULSE_WEBHOOK_SECRET
  );
  if (!isValid) return res.status(401).send('Invalid signature');
  // Process the webhook...
});</code></pre>
      <pre><code># Python verification example
import hmac, hashlib

def verify_signature(body: bytes, signature: str, secret: str) -&gt; bool:
    expected = hmac.new(
        secret.encode(), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)</code></pre>

      <h2 id="webhook-events">Webhook Event Types</h2>
      <p>When a check changes status, CronPulse sends a POST request to your configured webhook URL with the following JSON payloads:</p>

      <h3><code>check.down</code> &mdash; Check is overdue</h3>
      <pre><code>{
  "event": "check.down",
  "check": {
    "id": "abc123",
    "name": "Nightly backup",
    "status": "down",
    "last_ping_at": 1707700000,
    "period": 86400
  },
  "timestamp": 1707786400
}</code></pre>

      <h3><code>check.up</code> &mdash; Check recovered</h3>
      <pre><code>{
  "event": "check.up",
  "check": {
    "id": "abc123",
    "name": "Nightly backup"
  },
  "timestamp": 1707786500
}</code></pre>

      <h3><code>test</code> &mdash; Test notification</h3>
      <pre><code>{
  "event": "test",
  "message": "This is a test notification from CronPulse.",
  "timestamp": 1707786600
}</code></pre>

      <p>All webhook requests include <code>Content-Type: application/json</code> and have a 5-second timeout. If you have a signing secret configured, the <code>X-CronPulse-Signature</code> header will also be included.</p>

      <h2 id="webhook-retries">Webhook Automatic Retries</h2>
      <p>If a webhook or Slack notification fails (network error, non-2xx response), CronPulse automatically retries up to <strong>3 times</strong> with exponential backoff:</p>
      <table>
        <thead><tr><th>Retry</th><th>Delay</th><th>Timeout</th></tr></thead>
        <tbody>
          <tr><td>1st retry</td><td>~30 seconds</td><td>10s</td></tr>
          <tr><td>2nd retry</td><td>~2 minutes</td><td>10s</td></tr>
          <tr><td>3rd retry</td><td>~8 minutes</td><td>10s</td></tr>
        </tbody>
      </table>
      <p>Retry payloads include an additional <code>retry</code> field indicating the attempt number:</p>
      <pre><code>{
  "event": "check.down",
  "check": { ... },
  "timestamp": 1707786400,
  "retry": 1
}</code></pre>
      <p><strong>Note:</strong> Email notifications are not retried by CronPulse as the email provider (Resend) handles its own retry logic. After 3 failed attempts, the alert is marked as permanently failed and visible in your incident timeline.</p>

    </main>
  </div>

  <footer class="max-w-5xl mx-auto px-4 py-8 text-center text-sm text-gray-400 border-t">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`;
}

export default docs;
