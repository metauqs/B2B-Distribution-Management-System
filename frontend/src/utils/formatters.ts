// ─── Currency ─────────────────────────────────────────────────────────────────
// Exact same as fmtMoney() in original: "Rs 1,23,456" with negative support
export function fmtMoney(n: number): string {
  if (isNaN(n)) return 'Rs 0';
  const abs = Math.abs(Math.round(n));
  return (n < 0 ? '- ' : '') + 'Rs ' + abs.toLocaleString();
}

export const PKT_TIMEZONE = 'Asia/Karachi';

import { getTodayBusinessDateString } from './businessDate';

// ─── Date ─────────────────────────────────────────────────────────────────────
// Format date adhering to 5:00 AM PKT business day cutoff
export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const bStr = getTodayBusinessDateString(d);
  if (!bStr || bStr === '—') return '—';
  const [yStr, mStr, dStr] = bStr.split('-');
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);
  const utcDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
  return utcDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// Format date and time in PKT adhering to 5:00 AM PKT business day cutoff
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return '—';

  const bStr = getTodayBusinessDateString(d);
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

  const formattedTime = dateObj.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PKT_TIMEZONE,
  });

  return `${formattedDate} ${formattedTime}`;
}


// ─── Today as YYYY-MM-DD in Pakistan Time (Asia/Karachi, UTC+05:00) ──────────
// Daily reset boundary shifted from 12:00 A.M. to 5:00 A.M. (5:00 AM cutoff)
export function todayStr(dateObj: Date = new Date()): string {
  return getTodayBusinessDateString(dateObj);
}

// ─── Today for <input type="date"> in PKT ─────────────────────────────────────
export function todayInputDate(): string {
  return getTodayBusinessDateString();
}

// ─── Today & Current Time for <input type="datetime-local"> in PKT ───────────
export function todayInputDateTime(dateObj: Date = new Date()): string {
  const bDate = getTodayBusinessDateString(dateObj);
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PKT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const timePart = timeFormatter.format(dateObj);
  return `${bDate}T${timePart}`;
}

// ─── Date offset in PKT ──────────────────────────────────────────────────────
export function dateOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// ─── Qty with unit ────────────────────────────────────────────────────────────
export function fmtQty(qty: number, unit?: string): string {
  return `${qty}${unit ? ' ' + unit : ''}`;
}

// ─── Percentage ───────────────────────────────────────────────────────────────
export function fmtPct(n: number, decimals = 1): string {
  return n.toFixed(decimals) + '%';
}

// ─── Short number (for compact display) ──────────────────────────────────────
export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return 'Rs ' + (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000)     return 'Rs ' + (n / 1_000).toFixed(0) + 'K';
  return fmtMoney(n);
}

// ─── Urdu vegetable name map ─────────────────────────────────────────────────
const URDU_VEG_MAP: Record<string, string> = {
  'tomato':'ٹماٹر','tomatoes':'ٹماٹر',
  'potato':'آلو','potatoes':'آلو','aloo':'آلو',
  'onion':'پیاز','onions':'پیاز','pyaz':'پیاز',
  'garlic':'لہسن','lehsan':'لہسن',
  'ginger':'ادرک','adrak':'ادرک',
  'green chili':'ہری مرچ','green chilli':'ہری مرچ','green chillies':'ہری مرچ',
  'chili':'مرچ','chilli':'مرچ','mirch':'مرچ',
  'coriander':'دھنیا','dhania':'دھنیا',
  'cabbage':'بند گوبھی',
  'cauliflower':'پھول گوبھی','gobi':'پھول گوبھی','gobhi':'پھول گوبھی',
  'carrot':'گاجر','carrots':'گاجر','gajar':'گاجر',
  'peas':'مٹر','matar':'مٹر',
  'spinach':'پالک','palak':'پالک',
  'cucumber':'کھیرا','kheera':'کھیرا',
  'brinjal':'بینگن','eggplant':'بینگن','baingan':'بینگن',
  'lady finger':'بھنڈی','okra':'بھنڈی','bhindi':'بھنڈی',
  'pumpkin':'کدو','kaddu':'کدو',
  'bottle gourd':'لوکی','lauki':'لوکی',
  'bitter gourd':'کریلا','karela':'کریلا',
  'turnip':'شلجم','shalgam':'شلجم',
  'radish':'مولی','mooli':'مولی',
  'beans':'پھلیاں','french beans':'پھلیاں',
  'lemon':'لیموں','lemons':'لیموں','nimbu':'لیموں',
  'mint':'پودینہ','pudina':'پودینہ',
  'capsicum':'شملہ مرچ','bell pepper':'شملہ مرچ',
  'sweet potato':'شکرقندی',
  'corn':'مکئی','maize':'مکئی','bhutta':'بھٹہ',
  'apple':'سیب','apples':'سیب',
  'banana':'کیلا','bananas':'کیلا',
  'mango':'آم','mangoes':'آم',
  'orange':'مالٹا','oranges':'مالٹا',
  'grapes':'انگور',
  'watermelon':'تربوز',
  'melon':'خربوزہ',
  'guava':'امرود',
  'papaya':'پپیتا',
  'pear':'ناشپاتی',
  'plum':'آلوبخارا',
  'peach':'آڑو',
  'pomegranate':'انار',
  'garlic pod':'لہسن',
  'mushroom':'مشروم',
  'beetroot':'چقندر',
  'lettuce':'لیٹش',
  'broccoli':'بروکلی',
};

export function toUrduVeg(name: string): string {
  if (!name) return '';
  const key = String(name).trim().toLowerCase();
  return URDU_VEG_MAP[key] ?? name;
}

// ─── cn() helper (class merging) ──────────────────────────────────────────────
export function cn(...classes: (string | boolean | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
