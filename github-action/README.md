# CronPulse Ping - GitHub Action

Monitor your GitHub Actions workflows with [CronPulse](https://cron-pulse.com). Send success, start, or fail pings to track cron jobs running in GitHub Actions.

No dependencies. No Node.js. Just shell + curl.

## Quick Start

Add this step to the end of your scheduled workflow:

```yaml
- uses: nicepkg/cronpulse/github-action@main
  with:
    check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
```

That's it. CronPulse receives a success ping every time your workflow completes.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `check-id` | Yes | — | Your CronPulse check ID |
| `signal` | No | `success` | Signal type: `success`, `start`, or `fail` |
| `server` | No | `https://cron-pulse.com` | CronPulse server URL |
| `wrap` | No | — | A shell command to wrap (auto sends start/success/fail) |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Ping result: `ok` or `failed` |
| `response-time` | Response time in milliseconds |

## Examples

### Basic: Ping after a scheduled job

The simplest use case. Your cron workflow runs, and the last step pings CronPulse.

```yaml
name: Nightly backup
on:
  schedule:
    - cron: "0 3 * * *"

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Run backup
        run: ./scripts/backup.sh

      - name: Ping CronPulse
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
```

### Wrap a command

The `wrap` input sends a start ping, runs your command, then sends success or fail depending on the exit code. One step does everything.

```yaml
- name: Deploy with monitoring
  uses: nicepkg/cronpulse/github-action@main
  with:
    check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
    wrap: "npm run deploy"
```

If `npm run deploy` exits with 0, CronPulse gets a success ping. If it fails, CronPulse gets a fail ping and the step fails with the original exit code.

### Multiple checkpoints: start + end

For workflows where you want to measure duration, send start at the beginning and success at the end.

```yaml
jobs:
  etl-pipeline:
    runs-on: ubuntu-latest
    steps:
      - name: Signal start
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
          signal: start

      - name: Extract
        run: ./scripts/extract.sh

      - name: Transform
        run: ./scripts/transform.sh

      - name: Load
        run: ./scripts/load.sh

      - name: Signal success
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
          signal: success
```

### Signal failure explicitly

Use `if: failure()` to send a fail ping when earlier steps fail.

```yaml
jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Do work
        run: ./scripts/process.sh

      - name: Ping success
        if: success()
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}

      - name: Ping failure
        if: failure()
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
          signal: fail
```

### Matrix builds

Monitor each matrix variant with a separate check.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - run: npm test

      - uses: nicepkg/cronpulse/github-action@main
        if: always()
        with:
          check-id: ${{ secrets[format('CRONPULSE_NODE_{0}', matrix.node)] }}
          signal: ${{ job.status == 'success' && 'success' || 'fail' }}
```

### Self-hosted CronPulse server

If you're running CronPulse on your own infrastructure, point the action at your server.

```yaml
- uses: nicepkg/cronpulse/github-action@main
  with:
    check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
    server: "https://cronpulse.internal.company.com"
```

### Read the response time

Use the `response-time` output in subsequent steps.

```yaml
- name: Ping CronPulse
  id: ping
  uses: nicepkg/cronpulse/github-action@main
  with:
    check-id: ${{ secrets.CRONPULSE_CHECK_ID }}

- name: Log result
  run: |
    echo "Status: ${{ steps.ping.outputs.status }}"
    echo "Response time: ${{ steps.ping.outputs.response-time }}ms"
```

## Full Example Workflow

A complete scheduled workflow that monitors a database cleanup job:

```yaml
name: DB Cleanup
on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run cleanup with monitoring
        uses: nicepkg/cronpulse/github-action@main
        with:
          check-id: ${{ secrets.CRONPULSE_CHECK_ID }}
          wrap: "python scripts/db_cleanup.py"
```

## How It Works

This is a [composite action](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action). No Docker, no Node.js runtime -- just bash and curl.

**Simple mode** (no `wrap`): sends a single HTTP POST to the CronPulse ping endpoint with the specified signal.

**Wrap mode** (with `wrap`): sends a start ping, runs your command, then sends success or fail based on the exit code. If the command fails, the step exits with the command's original exit code so your workflow fails as expected.

All HTTP calls use `curl` with a 10-second timeout and follow redirects.

## API Reference

The action calls these CronPulse endpoints:

| Signal | Endpoint |
|--------|----------|
| `success` | `POST /ping/{checkId}` |
| `start` | `POST /ping/{checkId}/start` |
| `fail` | `POST /ping/{checkId}/fail` |

All endpoints return `"OK"` with status 200 on success.

## License

MIT
