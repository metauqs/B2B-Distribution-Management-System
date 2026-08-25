// ─── Currency ─────────────────────────────────────────────────────────────────
// Exact same as fmtMoney() in original: "Rs 1,23,456" with negative support
export function fmtMoney(n: number): string {
  if (isNaN(n) || !n) return 'Rs 0';
  const rounded = Math.round(n);
  if (rounded === 0 || Math.abs(n) < 0.99) return 'Rs 0';
  const abs = Math.abs(rounded);
  return (rounded < 0 ? '- ' : '') + 'Rs ' + abs.toLocaleString();
}

export const PKT_TIMEZONE = 'Asia/Karachi';

import { getTodayBusinessDateString, getBusinessDateOffset } from './businessDate';

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
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PKT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(dateObj).map(p => [p.type, p.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// ─── Date offset in PKT (Business Day Aware) ──────────────────────────────────
export function dateOffset(n: number): string {
  return getBusinessDateOffset(n);
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

/**
 * Client-side image compression and resizing utility for product images.
 * Resizes large photos to a crisp max dimension (default 600px) and compresses to WebP/JPEG,
 * reducing 5MB-15MB raw files to ~30KB-80KB for instant uploads without hitting payload limits.
 */
export async function compressProductImage(file: File, maxDim = 600, quality = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      if (typeof window === 'undefined') {
        return resolve(e.target?.result as string);
      }
      const img = new Image();
      img.onerror = () => resolve(e.target?.result as string);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            return resolve(e.target?.result as string);
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          let dataUrl = '';
          try {
            dataUrl = canvas.toDataURL('image/webp', quality);
          } catch {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          if (!dataUrl || dataUrl === 'data:,') {
            dataUrl = canvas.toDataURL('image/png');
          }

          resolve(dataUrl || (e.target?.result as string));
        } catch {
          resolve(e.target?.result as string);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
