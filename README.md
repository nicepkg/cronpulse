# CronPulse

Open-source cron job monitoring built on Cloudflare Workers.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/nicepkg/cronpulse)

Add one `curl` to your cron job. Get alerted when it stops running.

```bash
# Add this to the end of any cron script:
curl -fsS https://cronpulse.2214962083.workers.dev/ping/YOUR_CHECK_ID
```

**Try the hosted version:** [cronpulse.2214962083.workers.dev](https://cronpulse.2214962083.workers.dev) — free for up to 10 checks.

## Architecture

```
Your Cron Job
  |
  curl /ping/CHECK_ID
  |
  Cloudflare Workers (nearest edge node, <5ms response)
  |
  +---> KV (read check config, sub-ms)
  |      |
  |      +---> D1 fallback (if KV miss)
  |
  +---> D1 (write ping record, batched)
  |
  +---> KV (update cache, async)

Cron Triggers (every 1 min)
  |
  +---> D1 (query overdue checks)
  +---> Send alerts (Email / Slack / Webhook)
```

Everything runs as a single Cloudflare Worker. No servers, no containers, no orchestration.

## Features

- **One-line integration** — `curl` at the end of your script. No SDK, no agent, no config file.
- **Instant response** — Ping endpoint returns 200 in <5ms. Database writes happen asynchronously via `waitUntil()`.
- **Graceful degradation** — If KV is down, falls back to D1. If D1 is down, ping still returns 200. Your cron job never breaks because the monitor broke.
- **Configurable grace periods** — Avoid false alarms for slow jobs.
- **Recovery notifications** — Know when a check comes back up, not just when it goes down.
- **Multiple alert channels** — Email, Slack, and webhooks.
- **REST API** — Manage checks programmatically with Bearer token auth.
- **Global edge network** — Runs on Cloudflare's 300+ locations worldwide.

## Self-Hosting

CronPulse is designed to run on Cloudflare Workers. You need a free Cloudflare account.

### 1. Clone and install

```bash
git clone https://github.com/nicepkg/cronpulse.git
cd cronpulse
npm install
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
wrangler d1 create cronpulse-prod

# Create KV namespace
wrangler kv namespace create KV
```

### 3. Configure

```bash
# Copy the example config
cp wrangler.toml.example wrangler.toml

# Edit wrangler.toml — fill in your D1 database_id and KV namespace id
# (from the output of the commands above)

# Set secrets
wrangler secret put SESSION_SECRET
# Optional: for email alerts
wrangler secret put RESEND_API_KEY
```

### 4. Initialize database and deploy

```bash
# Create tables
npm run db:init:remote

# Deploy
npm run deploy
```

Your CronPulse instance is now live at `https://cronpulse.<your-subdomain>.workers.dev`.

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Compute | Cloudflare Workers | HTTP handling, edge compute |
| Database | Cloudflare D1 (SQLite) | Primary data store |
| Cache | Cloudflare KV | Hot-path read cache |
| Scheduler | Cron Triggers | Overdue detection (every 1min), cleanup (every 5min), aggregation (hourly) |
| Framework | Hono | Routing, middleware |
| IDs | nanoid | Check IDs, session tokens |
| Email | Resend (optional) | Alert delivery |

**Total infrastructure cost:** ~$5-6/month on the Workers Paid plan. Free tier works for development.

## Project Structure

```
src/
  index.ts              — Worker entry + cron handler + SEO routes
  types.ts              — TypeScript interfaces
  routes/
    ping.ts             — POST /ping/:id (public, no auth)
    auth.ts             — Magic link login + demo mode
    dashboard.ts        — Dashboard UI (SSR)
    api.ts              — REST API v1 (Bearer token auth)
    status.ts           — Public status page
    docs.ts             — API documentation
    blog.ts             — SEO blog posts
    webhooks.ts         — Payment webhook handler
  cron/
    check-overdue.ts    — Every-minute overdue detection + alerting
    cleanup.ts          — Token/session cleanup
    aggregate.ts        — Stats aggregation + old data cleanup
  middleware/
    session.ts          — Cookie-based session middleware
  views/
    landing.ts          — Landing page
  db/
    schema.sql          — D1 schema (8 tables)
  utils/
    id.ts               — ID generation
    time.ts             — Timestamp helpers
```

## API

Full API documentation: [/docs](https://cronpulse.2214962083.workers.dev/docs)

```bash
# Create a check
curl -X POST https://your-instance/api/v1/checks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "DB Backup", "period": 86400, "grace": 3600}'

# Send a ping
curl -fsS https://your-instance/ping/CHECK_ID

# List checks
curl https://your-instance/api/v1/checks \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs welcome.

## License

[AGPL-3.0](LICENSE) — You can use, modify, and self-host CronPulse freely. If you run a modified version as a public service, you must open-source your changes.

For managed hosting without the operational overhead, use the hosted version at [cronpulse.2214962083.workers.dev](https://cronpulse.2214962083.workers.dev).
