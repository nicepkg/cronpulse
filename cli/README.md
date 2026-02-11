# cronpulse

CLI for [CronPulse](https://cron-pulse.com) - monitor your cron jobs, pipelines, and scheduled tasks.

## Install

```bash
npm install -g cronpulse
```

Or use directly with npx:

```bash
npx cronpulse ping <check-id>
```

## Quick Start

### 1. Send a heartbeat ping

Add to your crontab:

```bash
*/5 * * * * cronpulse ping abc123
```

### 2. Wrap a command

Automatically sends start/success/fail signals:

```bash
cronpulse wrap abc123 -- ./backup.sh
cronpulse wrap abc123 -- pg_dump mydb > /tmp/backup.sql
```

### 3. List your checks

```bash
cronpulse config --api-key cpk_your_key_here
cronpulse list
```

## Commands

| Command | Description |
|---------|-------------|
| `ping <id>` | Send a success ping |
| `ping <id> --start` | Send a start signal |
| `ping <id> --fail` | Send a fail signal |
| `wrap <id> -- <cmd>` | Wrap a command (auto start/success/fail) |
| `list` | List all checks (requires API key) |
| `status <id>` | Show check details (requires API key) |
| `config` | Configure API key and server |

## Configuration

```bash
# Set API key (get from dashboard settings)
cronpulse config --api-key cpk_abc123

# Use a custom server (self-hosted)
cronpulse config --server https://my-cronpulse.example.com
```

Config is stored in `~/.cronpulse/config.json`.

## Ping Signals

| Signal | Flag | Behavior |
|--------|------|----------|
| Success | _(default)_ | Job OK, resets timer |
| Start | `--start` | Job began, timer keeps running |
| Fail | `--fail` | Job failed, immediate alert |

## License

MIT
