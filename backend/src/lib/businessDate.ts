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
 * Returns the Business Date string (YYYY-MM-DD) in PKT for any given instant.
 * If input is already formatted as YYYY-MM-DD, it is returned directly as it is already a business date string.
 * If PKT time hour is < 5 AM, it falls into the previous calendar day's business date.
 */
export function getBusinessDateString(input?: Date | string | number | null): string {
  if (!input) input = new Date();

  if (typeof input === 'string') {
    const trimmed = input.trim();
    // 1. Pure date string: YYYY-MM-DD (already a business date string)
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // 2. Datetime string without timezone offset (e.g. "2026-08-24T00:30", "2026-08-24 01:00:00")
    // This format represents local PKT time entered by the user in the frontend.
    const localMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (localMatch) {
      let year = parseInt(localMatch[1], 10);
      let month = parseInt(localMatch[2], 10);
      let day = parseInt(localMatch[3], 10);
      const hour = parseInt(localMatch[4], 10);

      // If before 5:00 AM PKT, it belongs to the previous calendar day's business date
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
export function getBusinessDateRange(dateInput?: Date | string | null): BusinessDateRange {
  const businessDateStr = getBusinessDateString(dateInput);

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
 * Calculates a business date offset in days from a reference date (defaults to current business date).
 * Perfectly handles month and year rollovers.
 * Example: getBusinessDateOffset(-1) returns yesterday's business date.
 */
export function getBusinessDateOffset(days: number, fromDate?: Date | string | null): string {
  const bDate = getBusinessDateString(fromDate);
  const [yStr, mStr, dStr] = bDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const target = new Date(Date.UTC(year, month, day + days));
  const yyyy = String(target.getUTCFullYear());
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Computes the exact UTC Date range for standard business date presets.
 */
export function getBusinessDatePresetRange(preset?: string, from?: string, to?: string): BusinessDateRange {
  const current = getCurrentBusinessDateRange();
  const currentBDate = current.businessDateStr;

  if (from && to) {
    const startRange = getBusinessDateRange(String(from).trim());
    const endRange = getBusinessDateRange(String(to).trim());
    return {
      start: startRange.start,
      end: endRange.end,
      businessDateStr: `${startRange.businessDateStr} to ${endRange.businessDateStr}`,
    };
  }

  const [yStr, mStr] = currentBDate.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;

  switch (preset) {
    case 'today':
      return current;

    case 'yesterday': {
      const yestStr = getBusinessDateOffset(-1);
      return getBusinessDateRange(yestStr);
    }

    case 'this_week': {
      const weekStartStr = getBusinessDateOffset(-7);
      const startRange = getBusinessDateRange(weekStartStr);
      return {
        start: startRange.start,
        end: current.end,
        businessDateStr: `${weekStartStr} to ${currentBDate}`,
      };
    }

    case 'last_week': {
      const lastWeekStartStr = getBusinessDateOffset(-14);
      const lastWeekEndStr = getBusinessDateOffset(-7);
      const startRange = getBusinessDateRange(lastWeekStartStr);
      const endRange = getBusinessDateRange(lastWeekEndStr);
      return {
        start: startRange.start,
        end: endRange.end,
        businessDateStr: `${lastWeekStartStr} to ${lastWeekEndStr}`,
      };
    }

    case 'this_month': {
      const monthStartStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const startRange = getBusinessDateRange(monthStartStr);
      return {
        start: startRange.start,
        end: current.end,
        businessDateStr: `${monthStartStr} to ${currentBDate}`,
      };
    }

    case 'last_month': {
      const prevMonthDate = new Date(Date.UTC(year, month - 1, 1));
      const prevYear = prevMonthDate.getUTCFullYear();
      const prevMonth = prevMonthDate.getUTCMonth();
      const prevMonthLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const startStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;
      const endStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(prevMonthLastDay).padStart(2, '0')}`;
      const startRange = getBusinessDateRange(startStr);
      const endRange = getBusinessDateRange(endStr);
      return {
        start: startRange.start,
        end: endRange.end,
        businessDateStr: `${startStr} to ${endStr}`,
      };
    }

    case 'last_30_days': {
      const startStr = getBusinessDateOffset(-30);
      const startRange = getBusinessDateRange(startStr);
      return {
        start: startRange.start,
        end: current.end,
        businessDateStr: `${startStr} to ${currentBDate}`,
      };
    }

    default:
      return current;
  }
}

/**
 * Safely parse a date string or timestamp into a Date object suitable for saving in database.
 * Anchors the date at 12:00 PM PKT (07:00:00.000 UTC) of its corresponding Business Date.
 */
export function parseInputDateToUtc(dateInput?: Date | string | number | null): Date {
  const bStr = getBusinessDateString(dateInput);
  const [yStr, mStr, dStr] = bStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  return new Date(Date.UTC(year, month, day, 7, 0, 0, 0));
}

/**
 * Format a Date or string for display in PKT (Asia/Karachi) adhering to 5:00 AM Business Day.
 */
export function formatPKTDateTime(dateInput: Date | string | null | undefined): string {
  if (!dateInput) return '—';
  const bStr = getBusinessDateString(dateInput);
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

  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return formattedDate;

  const formattedTime = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Karachi',
  });

  return `${formattedDate} ${formattedTime}`;
}

