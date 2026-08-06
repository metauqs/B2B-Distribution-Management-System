/**
 * Centralized Business Date Utility for Halal Vegg Supplies ERP
 *
 * Business Day Definition:
 * - Start Time: 05:00:00.000 AM PKT (Asia/Karachi, UTC+5)
 * - End Time:   04:59:59.999 AM PKT (next calendar day)
 *
 * Any transaction created between 12:00:00 AM and 04:59:59 AM PKT
 * belongs to the PREVIOUS business day.
 */

const PKT_OFFSET_HOURS = 5;

/**
 * Convert any instant (Date/string/number) into Pakistan Standard Time (PKT) Date object
 */
export function toPKTDate(input?: Date | string | number): Date {
  const d = input ? new Date(input) : new Date();
  if (isNaN(d.getTime())) return new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcMs + PKT_OFFSET_HOURS * 3600000);
}

/**
 * Returns the Business Date string (YYYY-MM-DD) in PKT for any given instant.
 * If input is already formatted as YYYY-MM-DD, it is returned directly as it is already a business date string.
 * If PKT time hour is < 5 AM, it falls into the previous calendar day's business date.
 */
export function getBusinessDateString(input?: Date | string | number): string {
  if (!input) input = new Date();
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }

  const d = new Date(input);
  if (isNaN(d.getTime())) return getBusinessDateString(new Date());

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

export interface BusinessDateRange {
  start: Date;
  end: Date;
  businessDateStr: string;
}

/**
 * Given a business date string (YYYY-MM-DD) or an instant, return the exact start (05:00:00 AM PKT)
 * and end (04:59:59.999 AM PKT next day) as UTC Date objects suitable for Prisma queries.
 */
export function getBusinessDateRange(dateInput?: Date | string): BusinessDateRange {
  let businessDateStr: string;

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      businessDateStr = trimmed;
    } else if (trimmed.includes('T') || trimmed.includes(' ')) {
      const datePart = trimmed.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        businessDateStr = datePart;
      } else {
        businessDateStr = getBusinessDateString(dateInput);
      }
    } else {
      businessDateStr = getBusinessDateString(dateInput);
    }
  } else {
    businessDateStr = getBusinessDateString(dateInput);
  }

  const [yStr, mStr, dStr] = businessDateStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1; // 0-indexed
  const day = parseInt(dStr, 10);

  // 05:00:00 AM PKT (Asia/Karachi, UTC+5) = 00:00:00.000 UTC on same calendar day
  const start = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

  // 04:59:59.999 AM PKT (Asia/Karachi, UTC+5) next calendar day = 23:59:59.999 UTC on same calendar day
  const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999));

  return { start, end, businessDateStr };
}

/**
 * Returns the exact Business Date range (start and end Date objects) for the active Business Day RIGHT NOW.
 */
export function getCurrentBusinessDateRange(): BusinessDateRange {
  return getBusinessDateRange(new Date());
}

/**
 * Safely parse a date string or timestamp into a Date object suitable for saving in database.
 * If input is a bare YYYY-MM-DD string, saves it at 12:00 PM PKT (07:00 AM UTC) to position it safely within the Business Day range.
 */
export function parseInputDateToUtc(dateInput?: Date | string | number): Date {
  if (!dateInput) return new Date();
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    const [yStr, mStr, dStr] = dateInput.trim().split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10) - 1;
    const day = parseInt(dStr, 10);
    return new Date(Date.UTC(year, month, day, 7, 0, 0, 0));
  }
  const d = new Date(dateInput);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Format a Date or string for display in PKT (Asia/Karachi)
 */
export function formatPKTDateTime(dateInput: Date | string): string {
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
