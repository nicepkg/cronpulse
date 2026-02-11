---
title: "How I Built a Cron Job Monitoring SaaS on Cloudflare Workers for $6/month"
published: false
description: "A deep dive into building a production SaaS with Cloudflare Workers, D1, KV, and Hono — including the architecture decisions, code patterns, cost breakdown, and tradeoffs I discovered along the way."
tags: cloudflare, serverless, saas, devops
cover_image: # TODO: Add a cover image URL (1000x420 recommended)
canonical_url:
---

Last month, one of my cron jobs silently stopped running. A database backup script. It had been dead for 11 days before I noticed.

Eleven days. No backup.

I looked at the monitoring tools available: Healthchecks.io, Cronitor, Better Uptime. They all work. But I had a different question: **could I build something like this on Cloudflare Workers for essentially zero infrastructure cost?**

Turns out, yes. The entire production infrastructure runs for about $6/month. Here's how.

## The Architecture

The stack is deliberately boring:

- **Cloudflare Workers** — HTTP handling, edge compute
- **Cloudflare D1** — SQLite at the edge, primary data store
- **Cloudflare KV** — Eventually-consistent cache for hot-path reads
- **Hono** — Lightweight web framework (~14KB)
- **Resend** — Transactional email for alerts

No React. No Next.js. No build pipeline for the frontend. The entire application is server-rendered HTML with Tailwind CSS loaded from CDN. I'll explain why later.

Here's the high-level flow:

```
Your cron job
  |
  curl https://cron-pulse.com/ping/YOUR_CHECK_ID
  |
  Cloudflare Workers (nearest edge, ~5ms response)
  |
  +--> KV (read check config, <1ms)
  |     |
  |     +--> D1 fallback (if KV miss)
  |
  +--> D1 (write ping record, batch)
  |
  +--> KV (update cache)

Cron Trigger (every 1 minute)
  |
  +--> D1 (query overdue checks)
  +--> Resend API (send alerts)
```

## The Ping Endpoint: Respond First, Process Later

The most critical piece is the ping endpoint. When your cron job calls `curl https://cron-pulse.com/ping/abc123`, it needs to get a response *fast*. If the monitoring service itself is slow, it becomes a liability in your cron job pipeline.

Here's the actual implementation:

```typescript
import { Hono } from 'hono';
import type { Env, CheckConfig } from '../types';

const ping = new Hono<{ Bindings: Env }>();

ping.all('/:checkId', async (c) => {
  const checkId = c.req.param('checkId');
  const timestamp = Math.floor(Date.now() / 1000);

  // Respond immediately, process in background
  c.executionCtx.waitUntil(
    recordPing(checkId, timestamp, c.env, c.req.header('CF-Connecting-IP') || '')
  );

  return c.text('OK', 200, { 'X-CronPulse': '1' });
});
```

The key pattern here is `waitUntil()`. The HTTP response goes back to the caller *immediately* — typically under 5ms. All the real work (reading config, writing to D1, updating KV) happens in the background after the response is sent.

This is one of the most powerful patterns in Workers development. The worker runtime keeps executing your `waitUntil()` promise even after the response has been sent to the client. Your cron job gets its 200 OK without waiting for database writes.

## KV-to-D1 Fallback: The Two-Tier Read Strategy

Every ping needs to look up the check configuration (period, grace, status, owner). I use a two-tier strategy:

```typescript
async function recordPing(checkId: string, timestamp: number, env: Env, sourceIp: string) {
  let check: CheckConfig | null = null;

  // Tier 1: Try KV first (fast, eventually consistent)
  try {
    const cached = await env.KV.get(`check:${checkId}`, 'json');
    if (cached) {
      check = cached as CheckConfig;
    }
  } catch {
    // KV failure, fall back to D1
  }

  // Tier 2: Fall back to D1 (authoritative, slightly slower)
  if (!check) {
    try {
      const row = await env.DB.prepare(
        'SELECT id, period, grace, status, user_id FROM checks WHERE id = ?'
      ).bind(checkId).first<CheckConfig>();
      if (!row) return; // Unknown check, silently ignore
      check = row;
    } catch {
      return; // Both failed, silently accept the ping
    }
  }

  if (check.status === 'paused') return;

  // Write to D1 using batch for atomicity
  const batch = [
    env.DB.prepare(
      'INSERT INTO pings (check_id, timestamp, source_ip, type) VALUES (?, ?, ?, ?)'
    ).bind(checkId, timestamp, sourceIp, 'success'),
    env.DB.prepare(
      `UPDATE checks SET
        last_ping_at = ?,
        next_expected_at = ? + period,
        status = 'up',
        ping_count = ping_count + 1,
        updated_at = ?
      WHERE id = ?`
    ).bind(timestamp, timestamp, timestamp, checkId),
  ];
  await env.DB.batch(batch);

  // Update KV cache for next read
  await env.KV.put(`check:${checkId}`, JSON.stringify({
    ...check,
    status: 'up',
    last_ping_at: timestamp,
  }), { expirationTtl: 300 });
}
```

A few things to notice:

1. **KV reads are sub-millisecond.** D1 reads are typically 5-20ms. For a ping endpoint that gets hit potentially thousands of times per minute, this difference matters.

2. **Every `try/catch` is intentional.** If KV fails, we fall back to D1. If D1 fails, we silently accept the ping. The philosophy: *never let our infrastructure failure cause your cron job to break.* A lost ping record is bad. A broken cron job is worse.

3. **D1 batch writes are atomic.** The ping insert and status update happen together or not at all. No half-states.

4. **KV TTL of 300 seconds.** The cache expires every 5 minutes. This is a deliberate tradeoff — if a user changes their check configuration, it takes up to 5 minutes to propagate. For a monitoring tool, this is acceptable.

## Cron Triggers: The Overdue Detection Loop

Workers Cron Triggers are the heartbeat of the system. I use three schedules:

```typescript
// wrangler.toml
[triggers]
crons = ["*/1 * * * *", "*/5 * * * *", "0 * * * *"]
```

```typescript
export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    switch (event.cron) {
      case '*/1 * * * *':
        // Every minute: check for overdue checks and send alerts
        ctx.waitUntil(checkOverdue(env));
        break;

      case '*/5 * * * *':
        // Every 5 minutes: cleanup expired tokens, sync KV
        ctx.waitUntil(cleanupAndSync(env));
        break;

      case '0 * * * *':
        // Every hour: aggregate stats, cleanup old pings
        ctx.waitUntil(aggregateStats(env));
        break;
    }
  },
};
```

The overdue detection runs every minute. It queries D1 for checks that should have pinged but haven't:

```typescript
export async function checkOverdue(env: Env) {
  const timestamp = Math.floor(Date.now() / 1000);
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const overdueChecks = await env.DB.prepare(`
      SELECT c.id, c.name, c.user_id, c.period, c.grace, c.last_ping_at
      FROM checks c
      WHERE c.status IN ('up', 'new')
        AND c.next_expected_at IS NOT NULL
        AND (c.next_expected_at + c.grace) < ?
      LIMIT ? OFFSET ?
    `).bind(timestamp, batchSize, offset).all();

    if (!overdueChecks.results.length) break;

    await processOverdueChecks(overdueChecks.results, env, timestamp);
    offset += batchSize;

    // Safety valve: max 5000 per cycle
    if (offset >= 5000) break;
  }
}
```

The formula is simple: if `next_expected_at + grace_period < now`, the check is overdue. The safety valve at 5000 prevents a runaway loop from eating through the Worker CPU time limit (which is 30 seconds for Cron Triggers on the paid plan).

## The Cost Breakdown

Here's where it gets interesting. Cloudflare's free tier is remarkably generous for this use case:

| Resource | Free Tier | Our Usage | Cost |
|----------|-----------|-----------|------|
| Workers Requests | 100K/day | ~50K/day (at scale) | $0 |
| Workers CPU Time | 10ms/req | ~3ms avg | $0 |
| D1 Reads | 5M/day | ~200K/day | $0 |
| D1 Writes | 100K/day | ~50K/day | $0 |
| D1 Storage | 5GB | ~200MB | $0 |
| KV Reads | 100K/day | ~100K/day | $0 |
| KV Writes | 1K/day | ~500/day | $0 |
| Cron Triggers | 3 per worker | 3 used | $0 |

The $5/month Workers Paid plan unlocks:

- 10M requests/month (vs 100K/day on free)
- 30ms CPU time on Cron Triggers (vs 10ms)
- Durable Objects (not used yet, but good to have)
- D1 with higher read/write limits

Add Resend for email at $0.80/1000 emails. At current scale, we send maybe 100 alerts/month. Call it a dollar.

**Total: ~$6/month for the entire production infrastructure.**

For context, a comparable setup on AWS (Lambda + DynamoDB + SES + CloudWatch) would run $20-50/month at similar scale, with significantly more configuration overhead.

## Why SSR With Template Strings (Not React)

This is the decision that surprised people the most. The entire dashboard is server-rendered HTML using JavaScript template literals:

```typescript
function renderCheckList(checks: Check[], user: User, appUrl: string): string {
  return `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Your Checks</h1>
      <a href="/dashboard/checks/new"
         class="bg-blue-600 text-white px-4 py-2 rounded-md text-sm">
        + New Check
      </a>
    </div>
    <div class="bg-white rounded-lg border divide-y">
      ${checks.map(check => `
        <a href="/dashboard/checks/${check.id}" class="block px-4 py-3 hover:bg-gray-50">
          <span class="font-medium">${escapeHtml(check.name)}</span>
          <span class="text-sm text-gray-400">
            ${check.last_ping_at ? timeAgo(check.last_ping_at) : 'Never pinged'}
          </span>
        </a>
      `).join('')}
    </div>`;
}
```

No JSX. No virtual DOM. No hydration. No client-side JavaScript at all (except Tailwind CSS from CDN).

Why?

1. **Workers have a 1MB code size limit** (3MB compressed on paid plan). A React bundle eats that fast.
2. **No build step.** TypeScript compiles directly. No webpack, no Vite, no bundle splitting.
3. **Zero client-side JS** means the page loads in a single round-trip. There's no "loading..." state.
4. **For a monitoring dashboard, you don't need interactivity.** You check it, you see status, you leave. Forms use standard HTML `<form>` with POST actions.

The tradeoff: I lose client-side state management. No optimistic updates. No real-time status updates without a page refresh. For this product, that's fine. If I need real-time later, I'll add WebSocket via Durable Objects — not rebuild in React.

## Magic Link Authentication

I chose passwordless auth via magic links. No passwords to hash, no passwords to leak, no "forgot password" flow.

The implementation is straightforward with D1:

```typescript
// Generate a 64-character token, store in D1 with 15-min expiry
const token = nanoid(64);
const expiresAt = Math.floor(Date.now() / 1000) + 900;

await env.DB.prepare(
  'INSERT INTO auth_tokens (token, email, expires_at) VALUES (?, ?, ?)'
).bind(token, email, expiresAt).run();

const magicLink = `${env.APP_URL}/auth/verify?token=${token}`;
// Send via Resend API...
```

On verification, I find-or-create the user, create a session, set an HttpOnly cookie:

```typescript
// Find or create user
let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
  .bind(email).first<User>();

if (!user) {
  const userId = nanoid(21);
  await env.DB.prepare(
    'INSERT INTO users (id, email, plan, check_limit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, email, 'free', 10, timestamp, timestamp).run();
}

// Create session (30-day expiry)
const sessionId = nanoid(32);
setCookie(c, 'session', sessionId, {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  maxAge: 30 * 86400,
});
```

Session cleanup runs every 5 minutes via Cron Trigger, deleting expired sessions and tokens from D1. No Redis. No external session store.

Rate limiting is built-in: max 5 login attempts per email per 15 minutes, enforced by a simple D1 query counting recent tokens for that email.

## The D1 Schema: Keep It Boring

Seven tables. All SQLite. No ORMs.

```sql
CREATE TABLE checks (
    id TEXT PRIMARY KEY,          -- nanoid(12)
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    period INTEGER NOT NULL DEFAULT 3600,   -- seconds
    grace INTEGER NOT NULL DEFAULT 300,     -- seconds
    status TEXT NOT NULL DEFAULT 'new',     -- new|up|down|paused
    last_ping_at INTEGER,
    next_expected_at INTEGER,
    alert_count INTEGER DEFAULT 0,
    ping_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_checks_overdue ON checks(status, next_expected_at);
```

The `idx_checks_overdue` composite index is critical. The every-minute cron query filters on `status IN ('up', 'new') AND next_expected_at + grace < now()`. Without this index, the query would do a full table scan on every check in the system.

All timestamps are Unix epoch integers. No `DATETIME` parsing, no timezone headaches. The frontend converts to human-readable strings at render time.

## Things That Bit Me

**D1 is eventually consistent across regions.** If a user creates a check in London and their cron job pings from New York 200ms later, the check might not exist yet in the D1 replica closest to New York. The KV cache helps here — but only after the first successful ping.

In practice, this hasn't been a real problem because there's always a delay between creating a check and the first cron execution. But it's something to be aware of.

**KV has a 1,000 writes/day limit on the free tier.** With 500 active checks each pinging once per hour, that's 12,000 KV writes per day just for cache updates. I had to move to the paid plan ($5/month) primarily for KV write limits, not compute.

**Workers Cron Triggers share the CPU time limit.** All three cron schedules run in the same worker. If the overdue check query is slow one minute, it can eat into the CPU budget. The 5,000-record safety valve and the batch-size pagination exist because of this. A lesson I learned after a query timeout at ~2,000 overdue checks.

**Tailwind CSS from CDN is a dev shortcut, not a production strategy.** The CDN version loads the entire Tailwind runtime (~300KB). A production build with purging would be ~10KB. It works for now because the pages are simple, but it's technical debt I'll address when I set up a proper build pipeline.

## What I'd Do Differently

1. **Use Durable Objects for real-time status.** Right now, the dashboard requires a page refresh. A Durable Object per user could push status updates via WebSocket.

2. **Add a proper asset pipeline.** Even a simple `esbuild` step to bundle and minify CSS would be worthwhile.

3. **Set up staging environment earlier.** I deployed to production from day one. Wrangler environments (`wrangler deploy --env staging`) exist for a reason.

4. **Structured logging from the start.** `console.error()` in Workers goes to `wrangler tail`, but with no structure. Integrating with Logflare or Baselime would have saved debugging time.

## Try It

CronPulse is in early preview. The core monitoring works. You can try it right now:

1. Sign up at [cron-pulse.com](https://cron-pulse.com)
2. Create a check
3. Add `curl -fsS https://cron-pulse.com/ping/YOUR_CHECK_ID` to your cron job
4. See what happens when you stop it

Free tier: 10 checks, no credit card.

The whole thing is built by a solo developer. If you work with cron jobs and have opinions on what a monitoring tool should do, I'd genuinely love to hear them. Drop a comment below or open a [GitHub issue](https://github.com).

---

*If you found this useful, I write about building things on Cloudflare Workers and the economics of running small SaaS products. Follow for more.*
