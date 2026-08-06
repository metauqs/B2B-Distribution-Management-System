/**
 * Frontend Business Date Utility for Halal Vegg Supplies ERP
 *
 * Business Day Definition:
 * - Start Time: 05:00:00.000 AM PKT (Asia/Karachi, UTC+5)
 * - End Time:   04:59:59.999 AM PKT (next calendar day)
 *
 * Transactions created between 12:00 AM and 04:59 AM PKT belong to the previous business date.
 */

/**
 * Returns today's active Business Date string in YYYY-MM-DD format (Asia/Karachi timezone)
 * taking into account the 5:00 AM cutoff rule.
 */
export function getTodayBusinessDateString(input?: Date | string | number): string {
  const d = input ? new Date(input) : new Date();
  if (isNaN(d.getTime())) return getTodayBusinessDateString(new Date());

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(d).map(p => [p.type, p.value])
  );

  let year = parseInt(parts.year, 10);
  let month = parseInt(parts.month, 10);
  let day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);

  // If time is between 12:00 AM and 04:59:59 AM, shift back 1 calendar day
  if (hour < 5) {
    const prevDate = new Date(Date.UTC(year, month - 1, day - 1));
    year = prevDate.getUTCFullYear();
    month = prevDate.getUTCMonth() + 1;
    day = prevDate.getUTCDate();
  }

  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns today's input-ready datetime string (YYYY-MM-DDTHH:mm) in Asia/Karachi time
 */
export function getTodayBusinessInputDateTime(): string {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(d).map(p => [p.type, p.value])
  );

  const yyyy = parts.year;
  const mm = parts.month.padStart(2, '0');
  const dd = parts.day.padStart(2, '0');
  const hh = parts.hour.padStart(2, '0');
  const min = parts.minute.padStart(2, '0');

  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/**
 * Format a Date or string for display in PKT (Asia/Karachi)
 */
export function fmtBusinessDate(dateInput: Date | string): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  });
}

/**
 * Format a Date or string for display with time in PKT (Asia/Karachi)
 */
export function fmtBusinessDateTime(dateInput: Date | string): string {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi',
  });
}
