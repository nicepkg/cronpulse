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
    <div class="flex items-center gap-4">
      <a href="/docs" class="text-sm text-gray-900 font-medium">Docs</a>
      <a href="/blog" class="text-sm text-gray-600 hover:text-gray-900">Blog</a>
      <a href="/#pricing" class="text-sm text-gray-600 hover:text-gray-900">Pricing</a>
      <a href="/auth/login" class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">Get Started</a>
    </div>
  </nav>

  <div class="max-w-5xl mx-auto px-4 py-12 flex gap-12">
    <!-- Sidebar -->
    <aside class="sidebar hidden md:block w-48 flex-shrink-0">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Getting Started</p>
      <a href="#authentication">Authentication</a>
      <a href="#base-url">Base URL</a>
      <a href="#errors">Errors</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Checks</p>
      <a href="#list-checks">List checks</a>
      <a href="#create-check">Create check</a>
      <a href="#get-check">Get check</a>
      <a href="#update-check">Update check</a>
      <a href="#delete-check">Delete check</a>
      <a href="#pause-check">Pause check</a>
      <a href="#resume-check">Resume check</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Pings &amp; Alerts</p>
      <a href="#ping-history">Ping history</a>
      <a href="#alert-history">Alert history</a>
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-2">Ping Endpoint</p>
      <a href="#send-ping">Send a ping</a>
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
          <tr><td><code>500</code></td><td>Internal server error</td></tr>
        </tbody>
      </table>

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
        </tbody>
      </table>
      <pre><code>curl -X POST -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Nightly backup", "period": 86400, "grace": 600}' \\
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

    </main>
  </div>

  <footer class="max-w-5xl mx-auto px-4 py-8 text-center text-sm text-gray-400 border-t">
    <p>&copy; 2026 CronPulse. Built on Cloudflare.</p>
  </footer>
</body>
</html>`;
}

export default docs;
