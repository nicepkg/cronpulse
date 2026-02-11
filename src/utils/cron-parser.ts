/**
 * Minimal cron expression parser for CronPulse.
 * Supports standard 5-field cron expressions: minute hour day-of-month month day-of-week
 *
 * Converts a cron expression into an approximate period (in seconds) between runs.
 * Also provides human-readable description.
 *
 * Supports: *, ranges (1-5), steps (*\/5), lists (1,3,5), common aliases (@hourly, @daily, etc.)
 */

const ALIASES: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export interface CronParseResult {
  valid: boolean;
  /** Approximate period in seconds between consecutive runs */
  periodSeconds: number;
  /** Suggested grace period in seconds (20% of period, clamped 60-3600) */
  graceSeconds: number;
  /** Human-readable schedule description */
  description: string;
  /** Original expression (normalized) */
  expression: string;
  /** Error message if invalid */
  error?: string;
}

/** Parse a single cron field and return the set of valid values */
function parseField(field: string, min: number, max: number): number[] | null {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    // Handle step: */5 or 1-10/2
    const [rangePart, stepStr] = part.split('/');
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (isNaN(step) || step < 1) return null;

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [lo, hi] = rangePart.split('-').map(Number);
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) return null;
      start = lo;
      end = hi;
    } else {
      const val = parseInt(rangePart, 10);
      if (isNaN(val) || val < min || val > max) return null;
      start = val;
      end = stepStr ? max : val;
    }

    for (let i = start; i <= end; i += step) {
      values.add(i);
    }
  }

  return values.size > 0 ? [...values].sort((a, b) => a - b) : null;
}

/**
 * Calculate the approximate period between cron runs.
 * Strategy: compute the next N runs from a reference time, then take the median interval.
 */
function computePeriod(minutes: number[], hours: number[], daysOfMonth: number[], months: number[], daysOfWeek: number[]): number {
  const isAllMinutes = minutes.length === 60;
  const isAllHours = hours.length === 24;
  const isAllDOM = daysOfMonth.length === 31;
  const isAllMonths = months.length === 12;
  const isAllDOW = daysOfWeek.length === 7;

  // Fast path for common patterns
  // Every N minutes
  if (isAllHours && isAllDOM && isAllMonths && isAllDOW && minutes.length > 1) {
    // Check if minutes are evenly spaced
    const gaps: number[] = [];
    for (let i = 1; i < minutes.length; i++) {
      gaps.push(minutes[i] - minutes[i - 1]);
    }
    // Include wrap-around gap
    gaps.push(60 - minutes[minutes.length - 1] + minutes[0]);
    const allSame = gaps.every(g => g === gaps[0]);
    if (allSame) return gaps[0] * 60;
    // Uneven — use average
    return Math.round((60 * 60) / minutes.length);
  }

  // Single minute, every N hours
  if (minutes.length === 1 && isAllDOM && isAllMonths && isAllDOW && hours.length > 1) {
    const gaps: number[] = [];
    for (let i = 1; i < hours.length; i++) {
      gaps.push(hours[i] - hours[i - 1]);
    }
    gaps.push(24 - hours[hours.length - 1] + hours[0]);
    const allSame = gaps.every(g => g === gaps[0]);
    if (allSame) return gaps[0] * 3600;
    return Math.round((24 * 3600) / hours.length);
  }

  // Once per hour (single minute, all hours)
  if (minutes.length === 1 && isAllHours && isAllDOM && isAllMonths && isAllDOW) {
    return 3600;
  }

  // Once per day (single minute, single hour)
  if (minutes.length === 1 && hours.length === 1 && isAllDOM && isAllMonths && isAllDOW) {
    return 86400;
  }

  // Once per week
  if (minutes.length === 1 && hours.length === 1 && isAllDOM && isAllMonths && daysOfWeek.length === 1) {
    return 604800;
  }

  // N times per week
  if (minutes.length === 1 && hours.length === 1 && isAllDOM && isAllMonths && !isAllDOW) {
    return Math.round(604800 / daysOfWeek.length);
  }

  // Once per month
  if (minutes.length === 1 && hours.length === 1 && daysOfMonth.length === 1 && isAllMonths && isAllDOW) {
    return 2592000; // ~30 days
  }

  // Once per year
  if (minutes.length === 1 && hours.length === 1 && daysOfMonth.length === 1 && months.length === 1) {
    return 31536000; // ~365 days
  }

  // Fallback: simulate next runs from a reference point
  // Use 2026-01-05 (Monday) 00:00 UTC as reference
  const refDate = new Date(Date.UTC(2026, 0, 5, 0, 0, 0));
  const runs: number[] = [];
  const maxIter = 400000; // Safety limit
  let iter = 0;

  const dt = new Date(refDate);

  while (runs.length < 10 && iter < maxIter) {
    iter++;
    // Advance by 1 minute
    dt.setUTCMinutes(dt.getUTCMinutes() + 1);

    const m = dt.getUTCMinutes();
    const h = dt.getUTCHours();
    const dom = dt.getUTCDate();
    const mon = dt.getUTCMonth() + 1;
    const dow = dt.getUTCDay();

    if (!minutes.includes(m)) continue;
    if (!hours.includes(h)) continue;
    if (!months.includes(mon)) continue;

    // Day matching: standard cron behavior
    // If both DOM and DOW are restricted (not *), match either (OR)
    // If only one is restricted, use it
    const domRestricted = !isAllDOM;
    const dowRestricted = !isAllDOW;

    if (domRestricted && dowRestricted) {
      if (!daysOfMonth.includes(dom) && !daysOfWeek.includes(dow)) continue;
    } else if (domRestricted) {
      if (!daysOfMonth.includes(dom)) continue;
    } else if (dowRestricted) {
      if (!daysOfWeek.includes(dow)) continue;
    }

    runs.push(dt.getTime());
  }

  if (runs.length < 2) {
    return 86400; // Fallback to 1 day
  }

  // Calculate median interval
  const intervals: number[] = [];
  for (let i = 1; i < runs.length; i++) {
    intervals.push((runs[i] - runs[i - 1]) / 1000);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return Math.round(median);
}

/** Generate human-readable description */
function describe(minutes: number[], hours: number[], daysOfMonth: number[], months: number[], daysOfWeek: number[]): string {
  const isAllMinutes = minutes.length === 60;
  const isAllHours = hours.length === 24;
  const isAllDOM = daysOfMonth.length === 31;
  const isAllMonths = months.length === 12;
  const isAllDOW = daysOfWeek.length === 7;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Every minute
  if (isAllMinutes && isAllHours && isAllDOM && isAllMonths && isAllDOW) {
    return 'Every minute';
  }

  // Every N minutes
  if (isAllHours && isAllDOM && isAllMonths && isAllDOW && minutes.length > 1) {
    if (minutes[0] === 0) {
      const gap = minutes.length > 1 ? minutes[1] - minutes[0] : 0;
      const allEven = minutes.every((m, i) => m === i * gap);
      if (allEven && gap > 0) return `Every ${gap} minutes`;
    }
    return `${minutes.length} times per hour`;
  }

  // Specific minute, every hour
  if (minutes.length === 1 && isAllHours && isAllDOM && isAllMonths && isAllDOW) {
    return `Every hour at :${minutes[0].toString().padStart(2, '0')}`;
  }

  // Every N hours
  if (minutes.length === 1 && isAllDOM && isAllMonths && isAllDOW && hours.length > 1 && hours.length < 24) {
    const gap = hours.length > 1 ? hours[1] - hours[0] : 0;
    const allEven = hours.every((h, i) => h === hours[0] + i * gap);
    if (allEven && gap > 0) {
      return `Every ${gap} hours at :${minutes[0].toString().padStart(2, '0')}`;
    }
    return `${hours.length} times per day at :${minutes[0].toString().padStart(2, '0')}`;
  }

  // Daily
  if (minutes.length === 1 && hours.length === 1 && isAllDOM && isAllMonths && isAllDOW) {
    return `Daily at ${hours[0].toString().padStart(2, '0')}:${minutes[0].toString().padStart(2, '0')} UTC`;
  }

  // Weekly
  if (minutes.length === 1 && hours.length === 1 && isAllDOM && isAllMonths && !isAllDOW) {
    const days = daysOfWeek.map(d => dayNames[d]).join(', ');
    const time = `${hours[0].toString().padStart(2, '0')}:${minutes[0].toString().padStart(2, '0')}`;
    if (daysOfWeek.length === 1) return `Weekly on ${days} at ${time} UTC`;
    return `${days} at ${time} UTC`;
  }

  // Monthly
  if (minutes.length === 1 && hours.length === 1 && !isAllDOM && isAllMonths && isAllDOW) {
    const time = `${hours[0].toString().padStart(2, '0')}:${minutes[0].toString().padStart(2, '0')}`;
    if (daysOfMonth.length === 1) return `Monthly on day ${daysOfMonth[0]} at ${time} UTC`;
    return `Monthly on days ${daysOfMonth.join(',')} at ${time} UTC`;
  }

  // Yearly
  if (minutes.length === 1 && hours.length === 1 && daysOfMonth.length === 1 && months.length === 1) {
    const time = `${hours[0].toString().padStart(2, '0')}:${minutes[0].toString().padStart(2, '0')}`;
    return `Yearly on ${monthNames[months[0]]} ${daysOfMonth[0]} at ${time} UTC`;
  }

  return 'Custom schedule';
}

/**
 * Parse a cron expression and return period, grace, and description.
 */
export function parseCronExpression(expr: string): CronParseResult {
  const trimmed = expr.trim().toLowerCase();

  // Check aliases
  const resolved = ALIASES[trimmed] || trimmed;
  const fields = resolved.split(/\s+/);

  if (fields.length !== 5) {
    return {
      valid: false,
      periodSeconds: 0,
      graceSeconds: 0,
      description: '',
      expression: expr.trim(),
      error: 'Expected 5 fields: minute hour day-of-month month day-of-week',
    };
  }

  const [minField, hourField, domField, monthField, dowField] = fields;

  const minutes = parseField(minField, 0, 59);
  const hours = parseField(hourField, 0, 23);
  const daysOfMonth = parseField(domField, 1, 31);
  const months = parseField(monthField, 1, 12);
  const daysOfWeek = parseField(dowField, 0, 6); // 0=Sunday

  if (!minutes) return { valid: false, periodSeconds: 0, graceSeconds: 0, description: '', expression: expr.trim(), error: 'Invalid minute field' };
  if (!hours) return { valid: false, periodSeconds: 0, graceSeconds: 0, description: '', expression: expr.trim(), error: 'Invalid hour field' };
  if (!daysOfMonth) return { valid: false, periodSeconds: 0, graceSeconds: 0, description: '', expression: expr.trim(), error: 'Invalid day-of-month field' };
  if (!months) return { valid: false, periodSeconds: 0, graceSeconds: 0, description: '', expression: expr.trim(), error: 'Invalid month field' };
  if (!daysOfWeek) return { valid: false, periodSeconds: 0, graceSeconds: 0, description: '', expression: expr.trim(), error: 'Invalid day-of-week field' };

  const periodSeconds = computePeriod(minutes, hours, daysOfMonth, months, daysOfWeek);

  // Grace = 20% of period, clamped between 60s and 3600s
  const graceSeconds = Math.min(3600, Math.max(60, Math.round(periodSeconds * 0.2)));

  const description = describe(minutes, hours, daysOfMonth, months, daysOfWeek);

  return {
    valid: true,
    periodSeconds,
    graceSeconds,
    description,
    expression: resolved,
  };
}
