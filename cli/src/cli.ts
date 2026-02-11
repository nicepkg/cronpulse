import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.cronpulse');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const DEFAULT_SERVER = 'https://cron-pulse.com';

interface Config {
  server: string;
  apiKey?: string;
}

function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return { server: DEFAULT_SERVER };
}

function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function httpGet(url: string, apiKey: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

async function httpPing(url: string): Promise<{ ok: boolean; status: number; ms: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10_000),
    });
    // CronPulse ping endpoint accepts any method, returns 200
    // But HEAD may not return body, use GET as fallback
    if (!res.ok) {
      const res2 = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      return { ok: res2.ok, status: res2.status, ms: Date.now() - start };
    }
    return { ok: res.ok, status: res.status, ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - start };
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

async function cmdPing(args: string[]) {
  const config = loadConfig();
  let signal = '';
  let checkId = '';

  for (const arg of args) {
    if (arg === '--start' || arg === '-s') signal = 'start';
    else if (arg === '--fail' || arg === '-f') signal = 'fail';
    else if (!arg.startsWith('-')) checkId = arg;
  }

  if (!checkId) {
    console.error('Usage: cronpulse ping <check-id> [--start | --fail]');
    process.exit(1);
  }

  const suffix = signal ? `/${signal}` : '';
  const url = `${config.server}/ping/${checkId}${suffix}`;

  const result = await httpPing(url);
  if (result.ok) {
    const label = signal === 'start' ? 'Start' : signal === 'fail' ? 'Fail' : 'Success';
    console.log(`OK  ${label} ping sent (${result.ms}ms)`);
  } else {
    console.error(`FAIL  HTTP ${result.status} (${result.ms}ms)`);
    process.exit(1);
  }
}

async function cmdWrap(args: string[]) {
  const config = loadConfig();
  let checkId = '';
  let cmdArgs: string[] = [];

  // Parse: cronpulse wrap <check-id> [--] <command...>
  const dashIdx = args.indexOf('--');
  if (dashIdx >= 0) {
    // Everything before -- is our args, everything after is the command
    const before = args.slice(0, dashIdx);
    cmdArgs = args.slice(dashIdx + 1);
    for (const a of before) {
      if (!a.startsWith('-')) checkId = a;
    }
  } else {
    // First non-flag arg is check ID, rest is the command
    let foundId = false;
    for (const a of args) {
      if (!foundId && !a.startsWith('-')) {
        checkId = a;
        foundId = true;
      } else if (foundId) {
        cmdArgs.push(a);
      }
    }
  }

  if (!checkId || cmdArgs.length === 0) {
    console.error('Usage: cronpulse wrap <check-id> -- <command> [args...]');
    process.exit(1);
  }

  const baseUrl = `${config.server}/ping/${checkId}`;

  // Send start signal
  await fetch(`${baseUrl}/start`, { signal: AbortSignal.timeout(5_000) }).catch(() => {});

  // Run the command — join into a single shell string to support pipes/redirects
  const startTime = Date.now();
  const shellCmd = cmdArgs.join(' ');
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(shellCmd, [], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  const elapsed = Date.now() - startTime;

  if (exitCode === 0) {
    // Success: send success ping
    await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    console.log(`\ncronpulse: OK (${elapsed}ms, exit 0)`);
  } else {
    // Failed: send fail signal
    await fetch(`${baseUrl}/fail`, { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    console.error(`\ncronpulse: FAIL (${elapsed}ms, exit ${exitCode})`);
    process.exit(exitCode);
  }
}

async function cmdList(args: string[]) {
  const config = loadConfig();
  if (!config.apiKey) {
    console.error('No API key configured. Run: cronpulse config --api-key YOUR_KEY');
    process.exit(1);
  }

  let tagFilter = '';
  let groupFilter = '';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--tag' || args[i] === '-t') && args[i + 1]) tagFilter = args[++i];
    if ((args[i] === '--group' || args[i] === '-g') && args[i + 1]) groupFilter = args[++i];
  }

  let url = `${config.server}/api/v1/checks`;
  const params = new URLSearchParams();
  if (tagFilter) params.set('tag', tagFilter);
  if (groupFilter) params.set('group', groupFilter);
  const qs = params.toString();
  if (qs) url += '?' + qs;

  try {
    const data = await httpGet(url, config.apiKey);
    const checks = data.checks || [];

    if (checks.length === 0) {
      console.log('No checks found.');
      return;
    }

    // Table format
    const header = padRow('STATUS', 'NAME', 'ID', 'PERIOD', 'LAST PING');
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const c of checks) {
      const status = formatStatus(c.status);
      const lastPing = c.last_ping_at ? timeAgo(c.last_ping_at) : 'never';
      const period = formatDuration(c.period);
      console.log(padRow(status, c.name.slice(0, 30), c.id, period, lastPing));
    }

    console.log(`\n${checks.length} check(s)`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

async function cmdStatus(args: string[]) {
  const config = loadConfig();
  if (!config.apiKey) {
    console.error('No API key configured. Run: cronpulse config --api-key YOUR_KEY');
    process.exit(1);
  }

  const checkId = args.find(a => !a.startsWith('-'));
  if (!checkId) {
    console.error('Usage: cronpulse status <check-id>');
    process.exit(1);
  }

  try {
    const data = await httpGet(`${config.server}/api/v1/checks/${checkId}`, config.apiKey);
    const c = data.check;
    console.log(`Name:        ${c.name}`);
    console.log(`ID:          ${c.id}`);
    console.log(`Status:      ${formatStatus(c.status)}`);
    console.log(`Period:      ${formatDuration(c.period)}`);
    console.log(`Grace:       ${formatDuration(c.grace)}`);
    console.log(`Last Ping:   ${c.last_ping_at ? new Date(c.last_ping_at * 1000).toISOString() : 'never'}`);
    console.log(`Pings:       ${c.ping_count}`);
    console.log(`Alerts:      ${c.alert_count}`);
    if (c.tags) console.log(`Tags:        ${c.tags}`);
    if (c.group_name) console.log(`Group:       ${c.group_name}`);
    if (c.cron_expression) console.log(`Cron:        ${c.cron_expression}`);
    console.log(`\nPing URLs:`);
    console.log(`  Success:   ${config.server}/ping/${c.id}`);
    console.log(`  Start:     ${config.server}/ping/${c.id}/start`);
    console.log(`  Fail:      ${config.server}/ping/${c.id}/fail`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

function cmdConfig(args: string[]) {
  const config = loadConfig();
  let changed = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--api-key' || args[i] === '-k') && args[i + 1]) {
      config.apiKey = args[++i];
      changed = true;
    }
    if ((args[i] === '--server' || args[i] === '-s') && args[i + 1]) {
      config.server = args[++i].replace(/\/+$/, '');
      changed = true;
    }
  }

  if (changed) {
    saveConfig(config);
    console.log('Config saved to ~/.cronpulse/config.json');
  }

  // Always show current config
  console.log(`Server:  ${config.server}`);
  console.log(`API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + '...' : '(not set)'}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatStatus(s: string): string {
  const map: Record<string, string> = {
    up: 'UP',
    down: 'DOWN',
    late: 'LATE',
    paused: 'PAUSED',
    new: 'NEW',
  };
  return map[s] || s.toUpperCase();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function padRow(...cols: string[]): string {
  const widths = [8, 32, 14, 8, 12];
  return cols.map((c, i) => c.padEnd(widths[i] || 12)).join('  ');
}

// ─── Version & Help ──────────────────────────────────────────────────────────

const VERSION = '1.0.0';

function showHelp() {
  console.log(`
cronpulse v${VERSION} - Monitor your cron jobs

USAGE:
  cronpulse <command> [options]

COMMANDS:
  ping <id> [--start|--fail]    Send a ping signal
  wrap <id> -- <cmd> [args...]  Wrap a command (auto start/success/fail)
  list [--tag X] [--group X]    List all checks (requires API key)
  status <id>                   Show check details (requires API key)
  config [--api-key K] [-s URL] Configure API key and server

EXAMPLES:
  # Basic heartbeat ping from crontab
  */5 * * * * cronpulse ping abc123

  # Wrap a backup script (sends start, then success or fail)
  cronpulse wrap abc123 -- ./backup.sh

  # Use with curl-style simplicity
  0 2 * * * cronpulse wrap abc123 -- pg_dump mydb > /tmp/backup.sql

  # Configure API key for list/status commands
  cronpulse config --api-key cpk_abc123xyz

  # List all checks
  cronpulse list

PING TYPES:
  (default)   Success - job completed OK, resets the timer
  --start     Start - job began running, doesn't reset timer
  --fail      Fail - job failed, immediately triggers alert

CONFIG:
  Settings stored in ~/.cronpulse/config.json
  Server defaults to https://cron-pulse.com

MORE INFO:
  https://cron-pulse.com
  https://github.com/nicepkg/cronpulse
`.trim());
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    showHelp();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`cronpulse v${VERSION}`);
    return;
  }

  const subArgs = args.slice(1);

  switch (command) {
    case 'ping':
      await cmdPing(subArgs);
      break;
    case 'wrap':
      await cmdWrap(subArgs);
      break;
    case 'list':
    case 'ls':
      await cmdList(subArgs);
      break;
    case 'status':
      await cmdStatus(subArgs);
      break;
    case 'config':
      cmdConfig(subArgs);
      break;
    default:
      // If it looks like a check ID, treat as a ping
      if (/^[a-zA-Z0-9_-]+$/.test(command) && !command.startsWith('-')) {
        await cmdPing([command, ...subArgs]);
      } else {
        console.error(`Unknown command: ${command}`);
        console.error('Run "cronpulse --help" for usage');
        process.exit(1);
      }
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
