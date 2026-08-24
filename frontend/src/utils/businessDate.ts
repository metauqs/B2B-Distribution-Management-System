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
 * If input is already a YYYY-MM-DD string, returns it directly as it is already a business date.
 */
export function getTodayBusinessDateString(input?: Date | string | number | null): string {
  if (!input) input = new Date();

  if (typeof input === 'string') {
    const trimmed = input.trim();
    // 1. Pure date string: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // 2. Datetime string without timezone offset (e.g. "2026-08-24T00:30")
    const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (localMatch) {
      let year = parseInt(localMatch[1], 10);
      let month = parseInt(localMatch[2], 10);
      let day = parseInt(localMatch[3], 10);
      const hour = parseInt(localMatch[4], 10);

      // If before 5:00 AM PKT, it belongs to the previous business date
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
  }

  // 3. Date object, timestamp, or ISO string with explicit timezone
  const d = new Date(input);
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
 * Returns today's input-ready datetime string (YYYY-MM-DDTHH:mm) in Asia/Karachi time,
 * using the active Business Date.
 */
export function getTodayBusinessInputDateTime(): string {
  const d = new Date();
  const bDate = getTodayBusinessDateString(d);
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timePart = timeFormatter.format(d);
  return `${bDate}T${timePart}`;
}

/**
 * Format a Date or string for display in PKT (Asia/Karachi) adhering to 5:00 AM Business Day.
 */
export function fmtBusinessDate(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return '—';
  const bStr = getTodayBusinessDateString(dateInput);
  if (!bStr || bStr === '—') return '—';
  const [yStr, mStr, dStr] = bStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const utcDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return utcDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Format a Date or string for display with time in PKT adhering to 5:00 AM Business Day.
 */
export function fmtBusinessDateTime(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return '—';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '—';

  const bStr = getTodayBusinessDateString(dateInput);
  if (!bStr || bStr === '—') return '—';
  const [yStr, mStr, dStr] = bStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const utcDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const formattedDate = utcDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const formattedTime = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi',
  });

  return `${formattedDate} ${formattedTime}`;
}

