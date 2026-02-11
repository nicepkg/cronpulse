<p align="center">
  <h1 align="center">CronPulse</h1>
  <p align="center">Open-source cron job monitoring built on Cloudflare Workers. One curl, instant alerts.</p>
</p>

<p align="center">
  <a href="https://cron-pulse.com"><img src="https://img.shields.io/badge/hosted-cron--pulse.com-blue" alt="Hosted Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/nicepkg/cronpulse/releases"><img src="https://img.shields.io/github/v/release/nicepkg/cronpulse" alt="Release"></a>
  <a href="https://github.com/nicepkg/cronpulse/issues"><img src="https://img.shields.io/github/issues/nicepkg/cronpulse" alt="Issues"></a>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/nicepkg/cronpulse"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare Workers"></a>
</p>

---

Your cron jobs fail silently. Your backup script stopped 3 days ago, and you only find out when you need the backup.

CronPulse fixes this. Add one `curl` to your cron job. If it stops pinging, you get alerted.

```bash
# Add this to the end of any cron script:
0 2 * * * /usr/local/bin/backup.sh && curl -fsS https://cron-pulse.com/ping/YOUR_CHECK_ID
```

**[Try free at cron-pulse.com](https://cron-pulse.com)** — 10 checks, no credit card.

## Why CronPulse?

| | CronPulse | Healthchecks.io | Cronitor | Better Stack |
|---|---|---|---|---|
| **Price (50 checks)** | $5/mo | $17/mo | ~$100/mo | $29/mo |
| **Open Source** | AGPL-3.0 | BSD-3 | No | No |
| **Infrastructure** | Cloudflare Edge (300+ nodes) | Single server | Cloud | Cloud |
| **Ping response** | <5ms | ~50ms | ~100ms | ~100ms |
| **Self-hostable** | Yes (Cloudflare Workers) | Yes (Docker) | No | No |
| **Setup** | One curl | One curl | SDK/curl | Agent/curl |

CronPulse isn't "better" than these tools — it's a different tradeoff. **Cheapest price, fastest ping, edge-native architecture.** If you need 25+ integrations, Healthchecks.io is great. If you want simple + cheap + fast, try CronPulse.

## Quick Start

### Option 1: Hosted (30 seconds)

1. Sign up at [cron-pulse.com](https://cron-pulse.com)
2. Create a check, get your ping URL
3. Add it to your cron job:

```bash
# Success ping (job completed)
curl -fsS https://cron-pulse.com/ping/YOUR_CHECK_ID

# Start signal (job started)
curl -fsS https://cron-pulse.com/ping/YOUR_CHECK_ID/start

# Fail signal (job failed)
curl -fsS https://cron-pulse.com/ping/YOUR_CHECK_ID/fail
```

### Option 2: CLI

```bash
npx cron-pulse-cli init "DB Backup" --every 1h
# Creates check and outputs ready-to-use crontab line
```

### Option 3: GitHub Action

```yaml
- uses: nicepkg/cronpulse/github-action@main
  with:
    check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
    signal: success
```

### Option 4: Self-Host

```bash
git clone https://github.com/nicepkg/cronpulse.git
cd cronpulse && npm install
# See self-hosting section below
```

## Features

- **One-line integration** — `curl` at the end of your script. No SDK, no agent, no config file.
- **Ping in <5ms** — Database writes happen asynchronously via `waitUntil()`. Your cron job doesn't wait.
- **Graceful degradation** — If KV is down, falls back to D1. If D1 is down, ping still returns 200. Your cron job never breaks because the monitor broke.
- **Start/Success/Fail signals** — Track job duration, not just completion.
- **Cron expression parsing** — `0 2 * * *` auto-calculates the expected interval.
- **Multiple alert channels** — Email (Resend), Slack (Block Kit), Webhooks (HMAC signed).
- **Status badges** — `![](https://cron-pulse.com/badge/CHECK_ID)` for your README.
- **Public status pages** — Share uptime with your users.
- **Check groups & tags** — Organize hundreds of checks.
- **Incident timeline** — Full history of downs and recoveries.
- **REST API** — Manage everything programmatically.
- **Import/Export** — Backup your config as JSON.
- **Maintenance windows** — Suppress alerts during planned downtime.

## Architecture

```
Your Cron Job
  → curl /ping/CHECK_ID
  → Cloudflare Workers (nearest of 300+ edge nodes, <5ms)
      → KV (read config, sub-ms) → D1 fallback if KV miss
      → D1 (write ping, async via waitUntil)

Cron Triggers (every 1 min)
  → D1 (query overdue checks)
  → Send alerts (Email / Slack / Webhook)
```

One Worker. No servers, no containers, no orchestration. Total infra cost: ~$5-6/month.

## Self-Hosting

You need a free Cloudflare account.

```bash
# 1. Clone and install
git clone https://github.com/nicepkg/cronpulse.git
cd cronpulse && npm install

# 2. Create Cloudflare resources
wrangler d1 create cronpulse-prod
wrangler kv namespace create KV

# 3. Configure
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your D1 database_id and KV namespace id

# 4. Set secrets
wrangler secret put SESSION_SECRET
wrangler secret put RESEND_API_KEY  # optional, for email alerts

# 5. Initialize and deploy
npm run db:init:remote
npm run deploy
```

Your instance is live at `https://cronpulse.<your-subdomain>.workers.dev`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Compute | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite at the edge) |
| Cache | Cloudflare KV |
| Scheduler | Cron Triggers |
| Framework | Hono |
| Email | Resend |

## Use Cases

- **Database backups** — Know immediately when your backup script fails
- **SSL certificate renewal** — Catch renewal failures before expiry
- **Data pipelines** — Monitor ETL jobs, data syncs, report generation
- **CI/CD pipelines** — GitHub Action integration for workflow monitoring
- **Server maintenance** — Log rotation, cleanup scripts, health checks
- **Payment processing** — Subscription billing jobs, invoice generation

## API

Full docs: [cron-pulse.com/docs](https://cron-pulse.com/docs)

```bash
# Create a check
curl -X POST https://cron-pulse.com/api/v1/checks \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "DB Backup", "period": 86400, "grace": 3600}'

# Send a ping
curl -fsS https://cron-pulse.com/ping/CHECK_ID

# List checks
curl https://cron-pulse.com/api/v1/checks \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Contributing

We welcome contributions! Check out [CONTRIBUTING.md](CONTRIBUTING.md) and our [good first issues](https://github.com/nicepkg/cronpulse/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## License

- **Server:** [AGPL-3.0](LICENSE) — Use, modify, and self-host freely. Public modifications must be open-sourced.
- **CLI + GitHub Action:** MIT — Use anywhere, no restrictions.

For managed hosting: [cron-pulse.com](https://cron-pulse.com)
