export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function timeAgo(timestamp: number): string {
  const diff = now() - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function periodOptions(): { value: number; label: string }[] {
  return [
    { value: 60, label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
    { value: 900, label: '15 minutes' },
    { value: 1800, label: '30 minutes' },
    { value: 3600, label: '1 hour' },
    { value: 7200, label: '2 hours' },
    { value: 14400, label: '4 hours' },
    { value: 28800, label: '8 hours' },
    { value: 43200, label: '12 hours' },
    { value: 86400, label: '1 day' },
    { value: 604800, label: '1 week' },
  ];
}

export function graceOptions(): { value: number; label: string }[] {
  return [
    { value: 60, label: '1 minute' },
    { value: 120, label: '2 minutes' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
    { value: 900, label: '15 minutes' },
    { value: 1800, label: '30 minutes' },
    { value: 3600, label: '1 hour' },
  ];
}

/**
 * Check if a unix timestamp falls within a recurring maintenance schedule.
 * Format: "day(s):HH:MM-HH:MM" where days can be:
 *   - "daily" for every day
 *   - "weekdays" for Mon-Fri
 *   - "weekends" for Sat-Sun
 *   - comma-separated day names: "mon,wed,fri"
 *   - single day: "sun"
 * Examples: "daily:02:00-04:00", "sun:02:00-04:00", "sat,sun:00:00-06:00"
 */
export function isInMaintSchedule(schedule: string, timestamp: number): boolean {
  if (!schedule) return false;
  const parts = schedule.split(':');
  if (parts.length < 3) return false;

  const daysPart = parts[0].toLowerCase();
  const startTime = parts[1];
  const endParts = parts.slice(2).join(':'); // handles "HH:MM-HH:MM"
  const [startMin, endTime] = (() => {
    // Parse "MM-HH:MM" from remaining
    const dashIdx = endParts.indexOf('-');
    if (dashIdx === -1) return ['00', ''];
    return [endParts.slice(0, dashIdx), endParts.slice(dashIdx + 1)];
  })();

  // Parse start and end in minutes from midnight
  const startHour = parseInt(startTime) || 0;
  const startMinute = parseInt(startMin) || 0;
  const startMins = startHour * 60 + startMinute;

  const endTimeParts = endTime.split(':');
  const endHour = parseInt(endTimeParts[0]) || 0;
  const endMinute = parseInt(endTimeParts[1]) || 0;
  const endMins = endHour * 60 + endMinute;

  if (endMins <= startMins) return false; // Invalid or overnight not supported

  // Get current UTC day and time
  const date = new Date(timestamp * 1000);
  const utcDay = date.getUTCDay(); // 0=Sun, 1=Mon, ...
  const utcMins = date.getUTCHours() * 60 + date.getUTCMinutes();

  // Check day match
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let dayMatch = false;

  if (daysPart === 'daily') {
    dayMatch = true;
  } else if (daysPart === 'weekdays') {
    dayMatch = utcDay >= 1 && utcDay <= 5;
  } else if (daysPart === 'weekends') {
    dayMatch = utcDay === 0 || utcDay === 6;
  } else {
    const selectedDays = daysPart.split(',').map(d => d.trim());
    dayMatch = selectedDays.includes(dayNames[utcDay]);
  }

  if (!dayMatch) return false;

  return utcMins >= startMins && utcMins < endMins;
}

/** Format a maintenance schedule for display */
export function formatMaintSchedule(schedule: string): string {
  if (!schedule) return '';
  const parts = schedule.split(':');
  if (parts.length < 3) return schedule;

  const daysPart = parts[0];
  const startTime = `${parts[1]}:${parts[2].split('-')[0]}`;
  const endTime = parts[2].split('-')[1] + (parts[3] ? ':' + parts[3] : ':00');

  const dayLabels: Record<string, string> = {
    daily: 'Every day',
    weekdays: 'Weekdays',
    weekends: 'Weekends',
  };

  const dayDisplay = dayLabels[daysPart.toLowerCase()] || daysPart.toUpperCase();
  return `${dayDisplay} ${startTime}-${endTime} UTC`;
}
