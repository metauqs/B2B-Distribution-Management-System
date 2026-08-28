/**
 * ─────────────────────────────────────────────────────────────────────────────
 * HALAL VEGG SUPPLIES — UNIFIED DOCUMENT TEMPLATE SYSTEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All customer-facing documents (Invoice, Due Statement, Daily Price List)
 * share a single design system defined here. Only the body content changes.
 *
 * Usage:
 *   const html = generateInvoiceHTML(sale, brandConfig);
 *   const html = generateStatementHTML(profile, brandConfig);
 *   const html = generatePriceListHTML(items, dateStr, brandConfig);
 *
 * BrandConfig should be loaded from /api/broadcasts/settings and merged with
 * sensible defaults so all documents stay in sync with Settings changes.
 */

import { DEFAULT_LOGO_BASE64 } from './logoBase64';
import { PRICELIST_LOGO_BASE64 } from './pricelistLogoBase64';
import { fmtMoney } from './formatters';
import { getProductVisual } from '../components/ui/ProductVisual';

// ─── HTML Entity Sanitizer (XSS Prevention) ──────────────────────────────────
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Brand Configuration ───────────────────────────────────────────────────────

export interface BrandConfig {
  companyName: string;    // "HALAL VEGG SUPPLIES"
  tagline: string;        // "FRESH FROM MANDI . DAILY DELIVERY"
  logoUrl: string;        // "/logo-transparent.avif"  (relative or absolute)
  primaryColor: string;   // "#1A3C28"  (dark forest green)
  accentColor: string;    // "#2D6A4F"  (medium green)
  lightBg: string;        // "#F4F8F0"  (very light green tint)
  lineColor: string;      // "#DCE8D5"  (subtle green border)
  contactNumber: string;  // "03061110041"
  footerLine: string;     // "For Payments & WhatsApp Orders"
}

export const DEFAULT_BRAND: BrandConfig = {
  companyName:   'HALAL VEGG SUPPLIES',
  tagline:       'FRESH FROM MANDI . DAILY DELIVERY',
  logoUrl:       DEFAULT_LOGO_BASE64,
  primaryColor:  '#1A3C28',
  accentColor:   '#2D6A4F',
  lightBg:       '#F4F8F0',
  lineColor:     '#D4E6CC',
  contactNumber: '03061110041',
  footerLine:    'For Payments & WhatsApp Orders',
};

/**
 * Converts a relative logo URL to an absolute base64 data URI so the logo
 * always renders in both print windows and server-side Puppeteer.
 */
async function resolveLogoDataUri(logoUrl: string, origin: string): Promise<string> {
  try {
    const absolute = logoUrl.startsWith('http') ? logoUrl : `${origin}${logoUrl}`;
    const res = await fetch(absolute);
    if (!res.ok) return logoUrl;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return logoUrl;
  }
}

let CACHED_BRAND_CONFIG: BrandConfig | null = null;
let CACHED_BRAND_CONFIG_TS = 0;
const BRAND_CACHE_TTL = 300000; // 5 minutes

/**
 * Fetch brand config from /api/broadcasts/settings and merge with defaults.
 * Falls back gracefully if the API is unavailable.
 */
export async function loadBrandConfig(): Promise<BrandConfig> {
  if (CACHED_BRAND_CONFIG && (Date.now() - CACHED_BRAND_CONFIG_TS) < BRAND_CACHE_TTL) {
    return CACHED_BRAND_CONFIG;
  }
  try {
    const res = await fetch('/api/broadcasts/settings');
    if (!res.ok) return DEFAULT_BRAND;
    const data = await res.json();
    if (!data?.success) return DEFAULT_BRAND;
    const s = data.data ?? {};
    const brand: BrandConfig = {
      ...DEFAULT_BRAND,
      contactNumber: s.phoneNumber || DEFAULT_BRAND.contactNumber,
    };
    CACHED_BRAND_CONFIG = brand;
    CACHED_BRAND_CONFIG_TS = Date.now();
    return brand;
  } catch {
    return DEFAULT_BRAND;
  }
}

let CACHED_BRAND_WITH_LOGO: BrandConfig | null = null;
let CACHED_BRAND_WITH_LOGO_TS = 0;

/**
 * Load brand config AND embed the logo as a base64 data URI so it renders
 * correctly in both popup print windows and server-side Puppeteer.
 */
export async function loadBrandConfigWithLogo(origin = typeof window !== 'undefined' ? window.location.origin : ''): Promise<BrandConfig> {
  if (CACHED_BRAND_WITH_LOGO && (Date.now() - CACHED_BRAND_WITH_LOGO_TS) < BRAND_CACHE_TTL) {
    return CACHED_BRAND_WITH_LOGO;
  }
  const brand = await loadBrandConfig();
  const logoDataUri = await resolveLogoDataUri(brand.logoUrl, origin);
  const result = { ...brand, logoUrl: logoDataUri };
  CACHED_BRAND_WITH_LOGO = result;
  CACHED_BRAND_WITH_LOGO_TS = Date.now();
  return result;
}

// ─── Shared CSS Design System ─────────────────────────────────────────────────

/**
 * Returns the shared <style> block used by every document type.
 * Typography, page size, brand colors, table design, footer, and Urdu font
 * are all defined here once.
 */
function buildDocStyles(b: BrandConfig): string {
  return `
    @font-face {
      font-family: 'Lora';
      src: url('/fonts/Lora-Variable.woff2') format('woff2');
      font-weight: 400 700;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Jameel';
      src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Jameel Noori Nastaleeq';
      src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Jameel Khushkhat L';
      src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }

    @font-face {
      font-family: 'Jameel Khushkhat';
      src: url('/fonts/jameel-khushkhat.woff2') format('woff2');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      font-family: 'Lora', 'Jameel', 'Jameel Noori Nastaleeq', 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', Georgia, serif;
      font-size: 13px;
      color: #1A1A1A;
      background: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Page Layout ───────────────────────────────────── */
    .doc-page {
      max-width: 780px;
      margin: 0 auto;
      padding: 36px 40px 40px;
      background: #FFFFFF;
    }

    /* ── Header ────────────────────────────────────────── */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 18px;
      border-bottom: 3px solid ${b.primaryColor};
      margin-bottom: 22px;
      gap: 16px;
    }
    .doc-header-brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .doc-header-logo {
      height: 60px;
      width: auto;
      object-fit: contain;
    }
    .doc-header-name {
      font-size: 18px;
      font-weight: 800;
      color: ${b.primaryColor};
      letter-spacing: 0.04em;
      line-height: 1.2;
    }
    .doc-header-tagline {
      font-size: 9px;
      color: #2D6A4F;
      margin-top: 4px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      text-align: center;
      white-space: nowrap;
    }
    .doc-header-meta {
      text-align: right;
    }
    .doc-title {
      font-size: 22px;
      font-weight: 800;
      color: ${b.primaryColor};
      letter-spacing: 0.06em;
      text-transform: uppercase;
      line-height: 1;
    }
    .doc-title-sub {
      font-size: 11px;
      color: #6B7C6A;
      margin-top: 4px;
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 600;
    }
    .doc-ref-no {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: ${b.primaryColor};
      margin-top: 6px;
    }

    /* ── Info Box (Client / Statement Info) ────────────── */
    .doc-info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 20px;
    }
    .doc-info-box {
      background: ${b.lightBg};
      border: 1px solid ${b.lineColor};
      border-radius: 8px;
      padding: 12px 14px;
    }
    .doc-info-box.full {
      grid-column: span 2;
    }
    .doc-info-label {
      font-size: 9px;
      font-weight: 700;
      color: #7A8C79;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 3px;
    }
    .doc-info-value {
      font-size: 13px;
      font-weight: 600;
      color: #1A1A1A;
      line-height: 1.5;
    }
    .doc-info-value.large {
      font-size: 15px;
      font-weight: 700;
      color: ${b.primaryColor};
    }
    .doc-info-value.mono {
      font-family: 'IBM Plex Mono', monospace;
    }

    /* ── Bilingual KPI Summary Boxes ───────────────────── */
    /* ── Urdu-First Typography Rules ────────────────────── */
    .urdu-title-main {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 24px;
      font-weight: 800;
      color: ${b.primaryColor};
      direction: rtl;
      unicode-bidi: isolate;
      line-height: 1.3;
    }
    .doc-info-label-urdu {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 17px;
      font-weight: 700;
      color: #1A1A1A;
      direction: rtl;
      unicode-bidi: isolate;
      line-height: 1.3;
      margin-bottom: 2px;
    }
    .doc-info-sub-eng {
      font-family: 'Lora', Georgia, serif;
      font-size: 10.5px;
      font-weight: 600;
      color: #6B7C6A;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      direction: ltr;
      display: inline-block;
    }
    .doc-kpi-urdu {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 18px;
      color: #000000;
      direction: rtl;
      unicode-bidi: isolate;
      display: block;
      margin-bottom: 2px;
      line-height: 1.4;
      font-weight: 800;
    }
    .doc-kpi-label-eng {
      font-size: 10.5px;
      font-weight: 600;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      display: block;
    }
    .urdu-main {
      display: block;
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 18px;
      color: #000000;
      direction: rtl;
      unicode-bidi: isolate;
      line-height: 1.4;
      font-weight: 800;
    }
    .eng-sub {
      display: block;
      font-family: 'Lora', Georgia, serif;
      font-size: 10.5px;
      color: #64748B;
      font-weight: 500;
      margin-top: 1px;
    }
    .urdu-inline {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 16px;
      color: #FFFFFF;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.4;
      font-weight: 700;
    }
    .urdu-inline-dark {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 17px;
      color: #000000;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.4;
      font-weight: 700;
    }
    .urdu-inline-val {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', sans-serif;
      font-size: 16px;
      color: #000000;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.4;
      font-weight: 700;
    }
    .doc-kpi-value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 18px;
      font-weight: 800;
      color: ${b.primaryColor};
      margin-top: 4px;
    }
    .doc-kpi-value.danger { color: #B5533C; }
    .doc-kpi-value.ok     { color: #2D6A4F; }

    /* ── Table ─────────────────────────────────────────── */
    .doc-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 18px;
      font-size: 12.5px;
    }
    .doc-table thead tr {
      background: ${b.primaryColor};
      color: #FFFFFF;
    }
    .doc-table thead th {
      padding: 9px 11px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      letter-spacing: normal;
      vertical-align: middle;
    }
    .doc-table thead th.right { text-align: right; }
    .doc-table thead th.center { text-align: center; }
    .doc-table thead th .urdu-th,
    .doc-table thead th .urdu-label {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', serif !important;
      font-size: 16px;
      font-weight: 700;
      direction: rtl;
      unicode-bidi: isolate;
      letter-spacing: normal !important;
      text-transform: none !important;
      line-height: 1.2;
      display: inline-block;
      vertical-align: middle;
      margin-right: 4px;
    }
    .doc-table thead th .eng-th,
    .doc-table thead th .eng-label {
      font-family: 'Lora', Georgia, serif;
      font-size: 9.5px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.85);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      display: inline-block;
      vertical-align: middle;
      direction: ltr;
    }

    .doc-table tbody tr:nth-child(even) { background: ${b.lightBg}; }
    .doc-table tbody tr:nth-child(odd)  { background: #FFFFFF; }
    .doc-table tbody td {
      padding: 8px 11px;
      border-bottom: 1px solid ${b.lineColor};
      vertical-align: middle;
      line-height: 1.4;
    }
    .doc-table tbody td.right  { text-align: right; }
    .doc-table tbody td.center { text-align: center; }
    .doc-table tbody td.mono   { font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
    .doc-table tbody td.muted  { color: #7A8C79; }
    .doc-table tbody td.urdu   {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif !important;
      direction: rtl;
      unicode-bidi: isolate;
      text-align: right;
      font-size: 17px;
      color: #000000;
      line-height: 1.4;
      padding-top: 4px;
      padding-bottom: 4px;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .doc-table tbody td.debit  { color: #B5533C; font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
    .doc-table tbody td.credit { color: #2D6A4F; font-family: 'IBM Plex Mono', monospace; font-weight: 600; }
    .doc-table tbody td.balance-pos { color: #B5533C; font-family: 'IBM Plex Mono', monospace; font-weight: 700; }
    .doc-table tbody td.balance-neg { color: #2D6A4F; font-family: 'IBM Plex Mono', monospace; font-weight: 700; }

    /* ── RTL Table & Grid Support ──────────────────────── */
    .rtl-grid { direction: rtl; }
    .rtl-table { direction: rtl; }
    .rtl-table thead th.left { text-align: left; }
    .rtl-table tbody td.left { text-align: left; }

    /* ── Summary Box ───────────────────────────────────── */
    .doc-summary-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 20px;
    }
    .doc-summary-wrap.rtl-summary {
      justify-content: flex-start;
      direction: rtl;
    }
    .doc-summary-box {
      width: 350px;
      border: 1.5px solid ${b.lineColor};
      border-radius: 8px;
      overflow: hidden;
    }
    .doc-summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 9px 14px;
      border-bottom: 1px solid ${b.lineColor};
      font-size: 13px;
    }
    .doc-summary-row:last-child { border-bottom: none; }
    .doc-summary-row .label { color: #2C3E2D; font-weight: 600; }
    .doc-summary-row .label .urdu-sub {
      display: block;
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 17px;
      color: #000000;
      direction: rtl;
      unicode-bidi: isolate;
      margin-top: 3px;
      line-height: 1.4;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .doc-summary-row .val {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 800;
      font-size: 17px;
      color: ${b.primaryColor};
    }
    .doc-summary-row.prev .val  { color: #B5533C; font-size: 17px; }
    .doc-summary-row.credit-row .val { color: #2D6A4F; font-size: 17px; }
    .doc-summary-row.total-row {
      background: ${b.lightBg};
      font-weight: 700;
    }
    .doc-summary-row.total-row .val { font-size: 18px; }
    .doc-summary-row.grand-row {
      background: ${b.primaryColor};
      color: #FFFFFF;
      font-weight: 700;
      font-size: 14px;
    }
    .doc-summary-row.grand-row .label,
    .doc-summary-row.grand-row .label .urdu-sub { color: #FFFFFF !important; font-size: 18px; font-weight: 800; }
    .doc-summary-row.grand-row .val { color: #FFFFFF; font-size: 20px; font-weight: 900; }
    .doc-summary-row.paid-row { background: #F0FAF2; }
    .doc-summary-row.paid-row .val { color: #2D6A4F; font-size: 17px; }

    /* ── Payment Status Badge ──────────────────────────── */
    .doc-status-wrap { text-align: center; margin-bottom: 18px; }
    .doc-status-badge {
      display: inline-block;
      padding: 6px 18px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .doc-status-badge.PAID    { background: #E6F7EC; color: #1A6B30; border: 1px solid #A8D9B5; }
    .doc-status-badge.PARTIAL { background: #FFF7E6; color: #8B5A00; border: 1px solid #F0D080; }
    .doc-status-badge.UNPAID  { background: #FDECEC; color: #8B2020; border: 1px solid #F0AAAA; }

    /* ── Notes ─────────────────────────────────────────── */
    .doc-notes {
      background: #FFFBF0;
      border-left: 3px solid #D4A017;
      padding: 10px 14px;
      border-radius: 0 6px 6px 0;
      font-size: 12px;
      margin-bottom: 16px;
      color: #5A4A00;
    }

    /* ── Footer ────────────────────────────────────────── */
    .doc-footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 2px solid ${b.lineColor};
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
    }
    .doc-footer-contact {
      font-size: 11px;
      font-weight: 600;
      color: ${b.primaryColor};
      line-height: 1.7;
    }
    .doc-footer-contact .line1 {
      font-size: 10px;
      color: #7A8C79;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .doc-footer-contact .phone {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: ${b.primaryColor};
    }
    .doc-footer-right {
      text-align: right;
      font-size: 10px;
      color: #9CA89B;
    }

    .doc-whatsapp-container {
      text-align: center;
      width: 100%;
      margin-top: 18px;
      margin-bottom: 6px;
    }
    .doc-whatsapp-btn {
      display: inline-block;
      background-color: #12D082;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      padding: 10px 30px;
      border-radius: 10px;
      text-decoration: none;
      text-align: center;
      font-family: 'Lora', Georgia, serif;
      border: none;
    }

    /* ── Print Media ───────────────────────────────────── */
    @media print {
      @page { size: A4; margin: 16mm 14mm; }
      .doc-page { padding: 0; max-width: 100%; }
      .doc-table tbody tr { page-break-inside: avoid; }
    }

    /* ── Mobile ────────────────────────────────────────── */
    @media screen and (max-width: 600px) {
      .doc-page { padding: 16px; }
      .doc-info-grid { grid-template-columns: 1fr; }
      .doc-info-box.full { grid-column: span 1; }
      .doc-header { flex-direction: column; gap: 10px; }
      .doc-header-meta { text-align: left; }
      .doc-summary-wrap { justify-content: stretch; }
      .doc-summary-box { width: 100%; }
      .doc-footer { flex-direction: column; align-items: flex-start; }
    }
  `;
}

// ─── Shared Header & Footer HTML ──────────────────────────────────────────────

function buildHeader(
  b: BrandConfig,
  title: string,
  subLabel: string,
  refLine: string,
  origin: string,
  urduTitle = ''
): string {
  const logoSrc = (b.logoUrl && (b.logoUrl.startsWith('data:') || b.logoUrl.startsWith('http')))
    ? b.logoUrl
    : (b.logoUrl && b.logoUrl !== '/logo-transparent.avif' ? `${origin}${b.logoUrl}` : DEFAULT_LOGO_BASE64);

  return `
    <div class="doc-header">
      <div class="doc-header-brand">
        <div style="display:flex; flex-direction:column; align-items:center;">
          <img class="doc-header-logo" src="${logoSrc}" alt="${b.companyName}">
          <div class="doc-header-tagline">${b.tagline}</div>
        </div>
      </div>
      <div class="doc-header-meta">
        ${urduTitle ? `<div class="urdu-title-main">${urduTitle}</div>` : ''}
        <div class="doc-title">${title}</div>
        <div class="doc-title-sub">${subLabel}</div>
        ${refLine ? `<div class="doc-ref-no">${refLine}</div>` : ''}
      </div>
    </div>
  `;
}

function buildFooter(b: BrandConfig, printedLabel: string): string {
  const cleanPhone = b.contactNumber.replace(/[^0-9]/g, '');
  const waNumber = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
  return `
    <div class="doc-whatsapp-container">
      <a href="https://wa.me/${waNumber}" class="doc-whatsapp-btn" target="_blank" style="color: #ffffff; text-decoration: none;">
        Whatsapp | ${b.contactNumber}
      </a>
    </div>
    <div class="doc-footer">
      <div class="doc-footer-contact">
        <div class="line1">${b.footerLine}</div>
        <div>WhatsApp / Contact: <span class="phone">${b.contactNumber}</span></div>
      </div>
      <div class="doc-footer-right">
        ${b.companyName}<br>${printedLabel}
      </div>
    </div>
  `;
}

function buildDocShell(b: BrandConfig, title: string, bodyHtml: string, origin = ''): string {
  const baseHref = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${baseHref ? `<base href="${baseHref}/">` : ''}
  <title>${title} — ${b.companyName}</title>
  <style>${buildDocStyles(b)}</style>
</head>
<body>
  <div class="doc-page">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

// ─── Product Visual Asset Helper for Document Templates ──────────────────────

export function getProductHtmlVisual(
  name: string,
  emoji?: string | null,
  imageUrl?: string | null,
  origin = ''
): string {
  const visualFallback = getProductVisual(name || '');
  const effectiveEmoji = (emoji && emoji.trim()) || visualFallback.fallback || '🥬';
  const baseOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');

  // 1. Highest Priority: Uploaded Image from Product Master (imageUrl)
  if (imageUrl && imageUrl.trim()) {
    let rawUrl = imageUrl.trim();
    if (rawUrl.startsWith('/uploads/products/')) {
      rawUrl = `/api/products/image/${rawUrl.replace('/uploads/products/', '')}`;
    }
    let finalUrl = rawUrl;
    if (!finalUrl.startsWith('data:') && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `${baseOrigin}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`;
    }
    if (!finalUrl.startsWith('data:') && (finalUrl.includes('/api/products/image/') || finalUrl.includes('/uploads/products/'))) {
      const sep = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${sep}name=${encodeURIComponent(name || '')}&emoji=${encodeURIComponent(effectiveEmoji)}`;
    }
    return `<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;vertical-align:middle;overflow:visible;direction:ltr;unicode-bidi:isolate;"><img src="${finalUrl}" alt="${name}" style="width:26px;height:26px;min-width:26px;min-height:26px;object-fit:contain;border-radius:4px;display:inline-block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';"><span style="display:none;align-items:center;justify-content:center;width:28px;height:28px;font-size:22px;line-height:1;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif;overflow:visible;direction:ltr;unicode-bidi:isolate;">${effectiveEmoji}</span></div>`;
  }

  // 2. Second Priority: Explicit Product Master Emoji
  if (emoji && emoji.trim()) {
    return `<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;line-height:1;font-size:22px;vertical-align:middle;overflow:visible;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif;box-sizing:border-box;direction:ltr;unicode-bidi:isolate;">${emoji.trim()}</div>`;
  }

  // 3. Pre-mapped static image assets
  if (visualFallback.type === 'image') {
    const staticUrl = `${baseOrigin}${visualFallback.value.startsWith('/') ? '' : '/'}${visualFallback.value}`;
    return `<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;vertical-align:middle;overflow:visible;direction:ltr;unicode-bidi:isolate;"><img src="${staticUrl}" alt="${name}" style="width:26px;height:26px;min-width:26px;min-height:26px;object-fit:contain;border-radius:4px;display:inline-block;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-flex';"><span style="display:none;align-items:center;justify-content:center;width:28px;height:28px;font-size:22px;line-height:1;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif;overflow:visible;direction:ltr;unicode-bidi:isolate;">${visualFallback.fallback}</span></div>`;
  }

  // 4. Standardized Fallback Emoji
  return `<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;min-width:28px;min-height:28px;line-height:1;font-size:22px;vertical-align:middle;overflow:visible;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif;box-sizing:border-box;direction:ltr;unicode-bidi:isolate;">${effectiveEmoji}</div>`;
}

// ─── Invoice Types ────────────────────────────────────────────────────────────

export interface InvoiceItem {
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  urduName?: string | null;
  returnedQty?: number;
  returnReason?: string | null;
  imageUrl?: string | null;
  emoji?: string | null;
  productId?: string | null;
}

export interface InvoiceData {
  invoiceNo: string;
  date: string;
  paymentMode: string;
  status: string;
  clientName: string;
  clientId?: string | null;
  clientPhone?: string | null;
  clientWhatsapp?: string | null;
  clientType?: string;
  clientAddress?: string | null;
  deliveryLocation?: string | null;
  employeeName?: string | null;
  employeePhone?: string | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  items: InvoiceItem[];
  previousBalance: number;
  previousBalanceDate?: string | null;
  total: number;
  paid: number;
  balance: number;
  notes?: string | null;
}

// ─── Invoice HTML Generator ───────────────────────────────────────────────────

export function generateInvoiceHTML(inv: InvoiceData, brand: BrandConfig, origin = ''): string {
  const today = new Date(inv.date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi',
  });
  const time = new Date(inv.date).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi',
  }).toLowerCase();
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const prevBal = inv.previousBalance > 0 ? inv.previousBalance : 0;
  const grandTotal = prevBal + inv.total;
  const remaining = grandTotal - inv.paid;
  const statusClass = inv.status === 'PAID' ? 'PAID' : inv.status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID';

  const clientPhone = inv.clientPhone ?? '';

  const logoSrc = (brand.logoUrl && (brand.logoUrl.startsWith('data:') || brand.logoUrl.startsWith('http')))
    ? brand.logoUrl
    : (brand.logoUrl && brand.logoUrl !== '/logo-transparent.avif' ? `${origin}${brand.logoUrl}` : DEFAULT_LOGO_BASE64);

  // ── Header (Exact Reference Match) ──
  const header = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid ${brand.primaryColor}; margin-bottom: 18px; direction: ltr;">
      <!-- Left: Logo & Tagline -->
      <div style="text-align: left; display: flex; flex-direction: column; align-items: flex-start;">
        <img class="doc-header-logo" src="${logoSrc}" alt="${brand.companyName}" style="height: 52px; width: auto; object-fit: contain;">
        <div style="font-size: 8.5px; color: #2D6A4F; margin-top: 5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${brand.tagline}</div>
      </div>

      <!-- Right: Urdu & English Title, Date & Time, Invoice ID -->
      <div style="text-align: right; direction: rtl;">
        <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 28px; font-weight: 800; color: ${brand.primaryColor}; line-height: 1.1;">انوائس</div>
        <div style="font-size: 20px; font-weight: 800; color: ${brand.primaryColor}; letter-spacing: 0.06em; text-transform: uppercase; font-family: 'Lora', Georgia, serif; margin-top: 2px;">INVOICE</div>
        <div style="font-size: 11.5px; color: #444444; margin-top: 3px; font-family: 'Lora', Georgia, serif; font-weight: 600;">${today} · ${time}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 800; color: ${brand.primaryColor}; margin-top: 4px; letter-spacing: 0.04em;">#${inv.invoiceNo}</div>
      </div>
    </div>
  `;

  // ── 2-Column Info Cards (Delivery on Left, Billed To on Right) ──
  const infoGrid = `
    <div class="doc-info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; direction: ltr;">
      <!-- Left Card: Delivery -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: left; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(DELIVERY)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">ترسیل</span>
        </div>
        <div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; margin-bottom: 3px;">
          👷 ${inv.employeeName || 'Rizwan'} (${brand.contactNumber || '03061110041'})
        </div>
        <div style="font-size: 12px; font-weight: 600; color: #333333; margin-bottom: 8px;">
          📅 ${inv.deliveryDate ? new Date(inv.deliveryDate).toLocaleDateString('en-GB') : today}${inv.deliveryTime ? ` · ${inv.deliveryTime}` : ' · 09:00 AM'}
        </div>
        <div style="font-size: 11px; color: #555555; font-weight: 600; margin-bottom: 2px;">
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 15px; color: #1A1A1A; font-weight: 700; direction: rtl; unicode-bidi: isolate;">ادائیگی طریقہ</span>
          <span style="font-family: 'Lora', Georgia, serif; font-size: 10px; margin-left: 2px;">(PAYMENT MODE)</span>
        </div>
        <div style="font-size: 13.5px; font-weight: 800; color: #1A1A1A; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.04em;">
          ${inv.paymentMode}
        </div>
      </div>

      <!-- Right Card: Billed To -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: right; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(BILLED TO)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">کلائنٹ</span>
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #1A1A1A; margin-bottom: 3px; font-family: 'Lora', Georgia, serif;">
          ${inv.clientName} <span style="font-size: 12px; font-weight: 600; color: #6B7C6A; font-family: 'IBM Plex Mono', monospace;">(${inv.clientId || '—'})</span>
        </div>
        <div style="font-size: 11px; color: #7A8C79; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.04em;">
          ${inv.clientType || 'RESTAURANT'}
        </div>
        ${clientPhone ? `<div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; direction: ltr; text-align: right; margin-top: 2px;">📞 ${clientPhone}</div>` : ''}
      </div>
    </div>
  `;

  // ── Main Product Table (Exact Reference Match) ──
  // Columns: # (Right) | (ITEM) پروڈکٹ / آئٹم | آئیکن | مقدار (QTY) | یونٹ (UNIT) | ریٹ (RATE RS) | رقم (AMOUNT RS) (Left)
  const itemsTable = `
    <table class="doc-table rtl-table" style="direction: rtl; width: 100%; border-collapse: collapse; margin-bottom: 18px;">
      <thead>
        <tr style="background: ${brand.primaryColor}; color: #FFFFFF;">
          <th class="center" style="width: 32px; font-size: 11px; padding: 9px 6px; border-top-right-radius: 6px;">#</th>
          <th style="text-align: right; padding: 9px 10px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 15px; margin-left: 2px;">پروڈکٹ / آئٹم</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(ITEM)</bdi>
          </th>
          <th class="center" style="width: 45px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px;">آئیکن</span>
          </th>
          <th class="center" style="width: 65px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">مقدار</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(QTY)</bdi>
          </th>
          <th class="center" style="width: 65px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">یونٹ</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(UNIT)</bdi>
          </th>
          <th class="center" style="width: 80px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">ریٹ</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(RATE RS)</bdi>
          </th>
          <th class="center" style="width: 100px; padding: 9px 8px; font-size: 11px; border-top-left-radius: 6px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">رقم</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(AMOUNT RS)</bdi>
          </th>
        </tr>
      </thead>
      <tbody>
        ${inv.items.map((item, i) => `
          <tr style="background: ${i % 2 === 1 ? '#F9FAF9' : '#FFFFFF'}; border-bottom: 1px solid #ECECEC;">
            <td class="center muted" style="padding: 9px 6px; font-size: 11.5px; font-weight: 600; color: #64748B;">${i + 1}</td>
            <td style="padding: 9px 10px; text-align: right;">
              <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 17px; font-weight: 700; color: #000000; direction: rtl; text-align: right; line-height: 1.25;">
                ${item.urduName || item.itemName}<bdi dir="ltr" style="font-family: 'Lora', Georgia, serif; font-size: 11px; font-weight: 600; color: #555555; unicode-bidi: isolate; display: inline-block; margin-right: 4px;">(${item.itemName})</bdi>
              </div>
            </td>
            <td class="center" style="padding: 6px 4px; vertical-align: middle; line-height: normal; overflow: visible; direction: ltr; unicode-bidi: isolate;">
              ${getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl, origin)}
            </td>
            <td class="center mono" style="padding: 9px 6px; font-size: 12.5px; font-weight: 700; color: #1A1A1A;">
              ${item.qty}
              ${item.returnedQty && item.returnedQty > 0 ? `<div style="font-size:8.5px;color:#C2410C;font-weight:700;margin-top:2px;">↩ ${item.returnedQty} Ret</div>` : ''}
            </td>
            <td class="center" style="padding: 9px 6px; font-size: 11.5px; font-weight: 600; color: #4A5568;">
              ${item.unit.toUpperCase()}
            </td>
            <td class="center mono" style="padding: 9px 6px; font-size: 12.5px; font-weight: 700; color: #1A1A1A;">
              ${item.rate.toLocaleString()}
            </td>
            <td class="center mono" style="padding: 9px 8px; font-size: 13px; font-weight: 800; color: #1A1A1A;">
              ${item.amount.toLocaleString()}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // ── Financial Summary Box & Actions (Bottom 2-Column Section) ──
  const prevBalRow = `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
      <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #B5533C;">Rs ${prevBal.toLocaleString()}</span>
      <div style="text-align: right;">
        <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #B5533C; line-height: 1.2;">سابقہ بقایا جات</div>
        <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Previous Outstanding</div>
      </div>
    </div>
  `;

  const totalReturnCredit = inv.items.reduce((s, i) => s + (Number(i.returnedQty || 0) * Number(i.rate || 0)), 0);
  const returnBreakdownRows = totalReturnCredit > 0 ? `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; color: #C2410C; direction: ltr;">
      <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 14px; color: #C2410C;">- Rs ${totalReturnCredit.toLocaleString()}</span>
      <div style="text-align: right;">
        <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 15px; font-weight: 800; color: #C2410C; line-height: 1.2;">واپسی کٹوتی (کریڈٹ)</div>
        <div style="font-size: 9.5px; color: #C2410C; font-weight: 600; font-family: 'Lora', Georgia, serif;">Sales Return Credit</div>
      </div>
    </div>
  ` : '';

  const summary = `
    <div style="border: 1px solid #E5E7EB; border-radius: 6px; overflow: hidden; background: #FFFFFF; width: 340px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
      ${prevBalRow}
      ${returnBreakdownRows}
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #1A1A1A;">Rs ${inv.total.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #1A1A1A; line-height: 1.2;">موجودہ بل</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Current Bill</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #0284C7;">Rs ${grandTotal.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #0284C7; line-height: 1.2;">کل قابل ادائیگی</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Payable Amount</div>
        </div>
      </div>
      ${inv.paid > 0 ? `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #166534;">Rs ${inv.paid.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #166534; line-height: 1.2;">وصول شدہ رقم</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Amount Paid Today</div>
        </div>
      </div>` : ''}
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: ${brand.primaryColor}; color: #FFFFFF; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 900; font-size: 18px; color: #FFFFFF;">Rs ${Math.max(0, remaining).toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 18px; font-weight: 800; color: #FFFFFF; line-height: 1.2;">بقیہ</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.85); font-weight: 600; font-family: 'Lora', Georgia, serif;">Remaining Balance</div>
        </div>
      </div>
    </div>
  `;

  // ── Bottom Section: Summary on Left, Status + WhatsApp on Right ──
  const bottomSection = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; margin-bottom: 24px; direction: ltr; gap: 20px;">
      <!-- Left: Financial Summary Box -->
      <div>
        ${summary}
      </div>

      <!-- Right: Payment Status Badge & WhatsApp Button -->
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 12px; width: 280px;">
        <div class="doc-status-badge ${statusClass}" style="width: 100%; text-align: center; padding: 9px 16px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;">
          PAYMENT STATUS: ${inv.status}
        </div>
        <a href="https://wa.me/923061110041" target="_blank" style="background: #00B050; color: #FFFFFF; font-size: 15px; font-weight: 800; padding: 12px 20px; border-radius: 8px; width: 100%; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Lora', Georgia, serif; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          Whatsapp | 03061110041
        </a>
      </div>
    </div>
  `;

  const notesBlock = inv.notes ? `<div class="doc-notes" style="direction:rtl;text-align:right;margin-bottom:16px;"><strong>نوٹ:</strong> ${inv.notes}</div>` : '';

  const footer = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 14px; border-top: 1px solid #E2E8F0; margin-top: 18px; direction: ltr;">
      <div style="text-align: left;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">FOR PAYMENTS &amp; WHATSAPP ORDERS</div>
        <div style="font-size: 12px; font-weight: 700; color: #1A1A1A; margin-top: 2px;">WhatsApp / Contact: <strong>${brand.contactNumber || '03061110041'}</strong></div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">${brand.companyName || 'HALAL VEGG SUPPLIES'}</div>
        <div style="font-size: 11px; color: #6B7C6A; font-weight: 600; margin-top: 2px;">Printed: ${printedOn}</div>
      </div>
    </div>
  `;

  const body = `
    ${header}
    ${infoGrid}
    ${itemsTable}
    ${notesBlock}
    ${bottomSection}
    ${footer}
  `;

  return buildDocShell(brand, `Invoice #${inv.invoiceNo}`, body, origin);
}

// ─── Statement Types ──────────────────────────────────────────────────────────

export interface LedgerEntry {
  type: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  ref?: string;
  status?: string;
}

export interface StatementData {
  clientName: string;
  clientId?: string | null;
  ownerName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  deliveryLocation?: string | null;
  totalSales: number;
  totalCollected: number;
  currentBalance: number;
  ledger: LedgerEntry[];
  statementDate?: string;
}

// ─── Due Statement HTML Generator ────────────────────────────────────────────

export function generateStatementHTML(stmt: StatementData, brand: BrandConfig, origin = ''): string {
  const today = stmt.statementDate ||
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
  const time = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi',
  }).toLowerCase();
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const isCredit = stmt.currentBalance <= 0;
  const statusClass = isCredit ? 'PAID' : 'UNPAID';

  const logoSrc = (brand.logoUrl && (brand.logoUrl.startsWith('data:') || brand.logoUrl.startsWith('http')))
    ? brand.logoUrl
    : (brand.logoUrl && brand.logoUrl !== '/logo-transparent.avif' ? `${origin}${brand.logoUrl}` : DEFAULT_LOGO_BASE64);

  const clientPhone = stmt.phone ?? '';
  const whatsappLine = stmt.whatsapp && stmt.whatsapp !== stmt.phone ? ` · WA: ${stmt.whatsapp}` : '';
  const addrLine = [stmt.address, stmt.deliveryLocation ? `Delivery: ${stmt.deliveryLocation}` : ''].filter(Boolean).join(' · ');

  // ── Header (Exact Invoice Match) ──
  const header = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid ${brand.primaryColor}; margin-bottom: 18px; direction: ltr;">
      <!-- Left: Logo & Tagline -->
      <div style="text-align: left; display: flex; flex-direction: column; align-items: flex-start;">
        <img class="doc-header-logo" src="${logoSrc}" alt="${brand.companyName}" style="height: 52px; width: auto; object-fit: contain;">
        <div style="font-size: 8.5px; color: #2D6A4F; margin-top: 5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${brand.tagline}</div>
      </div>

      <!-- Right: Urdu & English Title, Date & Time, Client ID -->
      <div style="text-align: right; direction: rtl;">
        <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 28px; font-weight: 800; color: ${brand.primaryColor}; line-height: 1.1;">اکاؤنٹ اسٹیٹمنٹ</div>
        <div style="font-size: 20px; font-weight: 800; color: ${brand.primaryColor}; letter-spacing: 0.06em; text-transform: uppercase; font-family: 'Lora', Georgia, serif; margin-top: 2px;">ACCOUNT STATEMENT</div>
        <div style="font-size: 11.5px; color: #444444; margin-top: 3px; font-family: 'Lora', Georgia, serif; font-weight: 600;">${today} · ${time}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 800; color: ${brand.primaryColor}; margin-top: 4px; letter-spacing: 0.04em;">#${stmt.clientId || 'WH-0000'}</div>
      </div>
    </div>
  `;

  // ── 2-Column Info Cards ──
  const infoGrid = `
    <div class="doc-info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; direction: ltr;">
      <!-- Left Card: Account Overview -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: left; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(ACCOUNT OVERVIEW)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">اکاؤنٹ خلاصہ</span>
        </div>
        <div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; margin-bottom: 3px;">
          📋 ${stmt.ledger.length} Transaction Record${stmt.ledger.length !== 1 ? 's' : ''}
        </div>
        <div style="font-size: 12px; font-weight: 600; color: #333333; margin-bottom: 8px;">
          📅 Period: All Historical Dues &amp; Payments
        </div>
        <div style="font-size: 11px; color: #555555; font-weight: 600; margin-bottom: 2px;">
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 15px; color: #1A1A1A; font-weight: 700; direction: rtl; unicode-bidi: isolate;">ادائیگی کیفیت</span>
          <span style="font-family: 'Lora', Georgia, serif; font-size: 10px; margin-left: 2px;">(STATUS)</span>
        </div>
        <div style="font-size: 13.5px; font-weight: 800; color: ${isCredit ? '#166534' : '#B5533C'}; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.04em;">
          ${isCredit ? 'ALL DUES CLEARED (Rs 0)' : `OUTSTANDING DUE: Rs ${Math.abs(stmt.currentBalance).toLocaleString()}`}
        </div>
      </div>

      <!-- Right Card: Billed To / Client -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: right; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(CLIENT)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">کلائنٹ</span>
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #1A1A1A; margin-bottom: 3px; font-family: 'Lora', Georgia, serif;">
          ${stmt.clientName} <span style="font-size: 12px; font-weight: 600; color: #6B7C6A; font-family: 'IBM Plex Mono', monospace;">(${stmt.clientId || '—'})</span>
        </div>
        ${stmt.ownerName ? `<div style="font-size: 11px; color: #7A8C79; font-weight: 600; margin-bottom: 2px;">Owner: ${stmt.ownerName}</div>` : ''}
        ${clientPhone ? `<div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; direction: ltr; text-align: right; margin-top: 2px;">📞 ${clientPhone}${whatsappLine}</div>` : ''}
        ${addrLine ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">📍 ${addrLine}</div>` : ''}
      </div>
    </div>
  `;

  // ── Ledger Table (Exact Invoice Style) ──
  const ledgerRows = [...stmt.ledger].reverse().map((e, i) => {
    const dateStr = new Date(e.date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
    });
    const isDebit = e.debit > 0;
    return `
      <tr style="background: ${i % 2 === 1 ? '#F9FAF9' : '#FFFFFF'}; border-bottom: 1px solid #ECECEC;">
        <td class="center muted" style="padding: 9px 6px; font-size: 11.5px; font-weight: 600; color: #64748B;">${i + 1}</td>
        <td class="center" style="padding: 9px 8px; font-size: 12px; font-weight: 600; color: #333333;">${dateStr}</td>
        <td style="padding: 9px 10px; text-align: right;">
          <div style="font-size: 13px; font-weight: 700; color: #1A1A1A; font-family: 'Lora', Georgia, serif;">${e.description}</div>
        </td>
        <td class="center mono" style="padding: 9px 8px; font-size: 12.5px; font-weight: 700; color: ${isDebit ? '#1A1A1A' : '#94A3B8'};">
          ${isDebit ? 'Rs ' + e.debit.toLocaleString() : '—'}
        </td>
        <td class="center mono" style="padding: 9px 8px; font-size: 12.5px; font-weight: 700; color: ${e.credit > 0 ? '#166534' : '#94A3B8'};">
          ${e.credit > 0 ? 'Rs ' + e.credit.toLocaleString() : '—'}
        </td>
        <td class="center mono" style="padding: 9px 8px; font-size: 13px; font-weight: 800; color: ${e.runningBalance > 0 ? '#B5533C' : '#166534'};">
          Rs ${e.runningBalance.toLocaleString()}
        </td>
      </tr>
    `;
  }).join('');

  const ledgerTable = `
    <table class="doc-table rtl-table" style="direction: rtl; width: 100%; border-collapse: collapse; margin-bottom: 18px;">
      <thead>
        <tr style="background: ${brand.primaryColor}; color: #FFFFFF;">
          <th class="center" style="width: 32px; font-size: 11px; padding: 9px 6px; border-top-right-radius: 6px;">#</th>
          <th class="center" style="width: 100px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">تاریخ</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(DATE)</bdi>
          </th>
          <th style="text-align: right; padding: 9px 10px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 15px; margin-left: 2px;">تفصیل</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(DESCRIPTION)</bdi>
          </th>
          <th class="center" style="width: 105px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">بل / واجب</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(DEBIT RS)</bdi>
          </th>
          <th class="center" style="width: 105px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">وصولی / ادا</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(CREDIT RS)</bdi>
          </th>
          <th class="center" style="width: 115px; padding: 9px 8px; font-size: 11px; border-top-left-radius: 6px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">بقایا جات</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(BALANCE RS)</bdi>
          </th>
        </tr>
      </thead>
      <tbody>
        ${ledgerRows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px;">No transactions found</td></tr>'}
      </tbody>
    </table>
  `;

  // ── Financial Summary Box & Status / WhatsApp Section ──
  const summary = `
    <div style="border: 1px solid #E5E7EB; border-radius: 6px; overflow: hidden; background: #FFFFFF; width: 340px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #1A1A1A;">Rs ${stmt.totalSales.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #1A1A1A; line-height: 1.2;">کل فروخت / بل</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Billed</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #166534;">Rs ${stmt.totalCollected.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #166534; line-height: 1.2;">کل وصول شدہ رقم</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Paid</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: ${brand.primaryColor}; color: #FFFFFF; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 900; font-size: 18px; color: #FFFFFF;">Rs ${Math.abs(stmt.currentBalance).toLocaleString()}${isCredit ? ' (Cr)' : ''}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 18px; font-weight: 800; color: #FFFFFF; line-height: 1.2;">کل واجب الادا رقم</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.85); font-weight: 600; font-family: 'Lora', Georgia, serif;">Net Balance Due</div>
        </div>
      </div>
    </div>
  `;

  const bottomSection = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; margin-bottom: 24px; direction: ltr; gap: 20px;">
      <!-- Left: Financial Summary Box -->
      <div>
        ${summary}
      </div>

      <!-- Right: Payment Status Badge & WhatsApp Button -->
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 12px; width: 280px;">
        <div class="doc-status-badge ${statusClass}" style="width: 100%; text-align: center; padding: 9px 16px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;">
          ACCOUNT STATUS: ${isCredit ? 'ALL DUES CLEARED' : 'OUTSTANDING DUES'}
        </div>
        <a href="https://wa.me/923061110041" target="_blank" style="background: #00B050; color: #FFFFFF; font-size: 15px; font-weight: 800; padding: 12px 20px; border-radius: 8px; width: 100%; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Lora', Georgia, serif; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          Whatsapp | ${brand.contactNumber || '03061110041'}
        </a>
      </div>
    </div>
  `;

  const footer = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 14px; border-top: 1px solid #E2E8F0; margin-top: 18px; direction: ltr;">
      <div style="text-align: left;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">FOR PAYMENTS &amp; WHATSAPP INQUIRIES</div>
        <div style="font-size: 12px; font-weight: 700; color: #1A1A1A; margin-top: 2px;">WhatsApp / Contact: <strong>${brand.contactNumber || '03061110041'}</strong></div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">${brand.companyName || 'HALAL VEGG SUPPLIES'}</div>
        <div style="font-size: 11px; color: #6B7C6A; font-weight: 600; margin-top: 2px;">Printed: ${printedOn}</div>
      </div>
    </div>
  `;

  const body = `
    ${header}
    ${infoGrid}
    ${ledgerTable}
    ${bottomSection}
    ${footer}
  `;

  return buildDocShell(brand, `Account Statement — ${stmt.clientName}`, body, origin);
}



// ─── Price List Types ─────────────────────────────────────────────────────────

export interface PriceListItem {
  itemName: string;
  unit: string;
  sellRate: number;
  urduName?: string | null;
  category?: string;
  imageUrl?: string | null;
  emoji?: string | null;
  productId?: string | null;
}

export interface PriceListData {
  dateStr: string;
  items: PriceListItem[];
  notes?: string | null;
}

// ─── Price List HTML Generator ────────────────────────────────────────────────

export function generatePriceListHTML(data: PriceListData, brand: BrandConfig, origin = ''): string {
  // Split items into two halves for 2-column layout
  const half = Math.ceil(data.items.length / 2);
  const col1 = data.items.slice(0, half);
  const col2 = data.items.slice(half);

  const buildPriceRows = (items: typeof data.items, startIdx: number) =>
    items.map((item, i) => {
      const htmlVisual = getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl, origin);
      const bg = i % 2 === 0 ? '#072E1D' : '#0A3723';
      return `
        <tr style="background:${bg};border-bottom:1px solid #14492E;">
          <td style="padding:7px 10px;vertical-align:middle;text-align:left;white-space:nowrap;font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:800;color:#FACC15;">Rs ${item.sellRate.toLocaleString()}</td>
          <td style="padding:7px 10px;vertical-align:middle;text-align:center;text-transform:uppercase;font-size:12px;color:#FFFFFF;font-weight:700;">${item.unit}</td>
          <td style="padding:7px 10px;vertical-align:middle;">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;">
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-family:'Jameel','Jameel Noori Nastaleeq','Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic',sans-serif;font-size:26px;font-weight:800;color:#FFFFFF;direction:rtl;line-height:1.2;unicode-bidi:isolate;">${item.urduName || item.itemName}</span>
                <span style="font-size:11px;color:#A3C9B3;font-weight:500;font-family:'Lora',Georgia,serif;margin-top:1px;">${item.itemName}</span>
              </div>
              ${htmlVisual}
            </div>
          </td>
          <td style="padding:7px 10px;vertical-align:middle;text-align:right;font-size:12px;color:#789E89;font-weight:600;">${startIdx + i + 1}</td>
        </tr>
      `;
    }).join('');

  const priceColHeader = `
    <thead>
      <tr style="background:#0D4429;border-bottom:2px solid #E5A93C;">
        <th style="font-size:11px;padding:9px 10px;width:90px;text-align:left;font-weight:800;color:#FACC15;letter-spacing:0.08em;">RATE (RS)</th>
        <th style="font-size:11px;padding:9px 10px;width:60px;text-align:center;font-weight:800;color:#FACC15;letter-spacing:0.08em;">UNIT</th>
        <th style="font-size:11px;padding:9px 10px;text-align:right;font-weight:800;color:#FACC15;letter-spacing:0.08em;font-family:'Jameel','Jameel Noori Nastaleeq','Jameel Khushkhat L','Noto Nastaliq Urdu','Lora',sans-serif;">پروڈکٹ / PRODUCT</th>
        <th style="font-size:11px;padding:9px 10px;width:30px;text-align:right;font-weight:800;color:#FACC15;">#</th>
      </tr>
    </thead>
  `;

  const table = `
    <div style="display:flex;gap:12px;align-items:flex-start;margin-top:14px;">
      <div style="flex:1;min-width:0;">
        <table style="width:100%;border-collapse:collapse;border:1px solid #14492E;">
          ${priceColHeader}
          <tbody>
            ${col1.length > 0 ? buildPriceRows(col1, 0) : '<tr><td colspan="4" style="text-align:center;color:#85A894;padding:20px;">No rates available</td></tr>'}
          </tbody>
        </table>
      </div>
      ${col2.length > 0 ? `
      <div style="flex:1;min-width:0;">
        <table style="width:100%;border-collapse:collapse;border:1px solid #14492E;">
          ${priceColHeader}
          <tbody>
            ${buildPriceRows(col2, half)}
          </tbody>
        </table>
      </div>` : '<div style="flex:1;"></div>'}
    </div>
  `;

  const logoSrc = (brand.logoUrl && (brand.logoUrl.startsWith('data:') || brand.logoUrl.startsWith('http')))
    ? brand.logoUrl
    : (brand.logoUrl && brand.logoUrl !== '/logo-transparent.avif' ? `${origin}${brand.logoUrl}` : PRICELIST_LOGO_BASE64);

  const bodyContent = `
    <div style="max-width:780px;margin:0 auto;background:linear-gradient(180deg, #062315 0%, #082E1C 100%);border:4px double #E5A93C;border-radius:12px;padding:24px 28px 28px;color:#FFFFFF;box-sizing:border-box;">
      
      <!-- Header Bar -->
      <div style="border-bottom:2px solid #E5A93C;padding-bottom:16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:16px;">
        <div style="background:#FFFFFF;padding:6px 14px;border-radius:10px;border:1.5px solid #E5A93C;box-shadow:0 4px 14px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
          <img src="${logoSrc}" alt="${brand.companyName || 'HALAL VEGG SUPPLIES'}" style="height:54px;width:auto;object-fit:contain;" />
        </div>

        <div style="text-align:right;">
          <div style="font-family:'Jameel','Jameel Noori Nastaleeq','Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic',sans-serif;font-size:28px;font-weight:800;color:#FACC15;direction:rtl;line-height:1.2;unicode-bidi:isolate;">آج کی ریٹ لسٹ</div>
          <div style="font-size:12px;font-weight:800;color:#FDFBF7;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">TODAY'S PRICE LIST</div>
          <div style="display:inline-block;margin-top:6px;background:#0D4429;border:1px solid #E5A93C;color:#FFFFFF;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;padding:4px 12px;border-radius:6px;letter-spacing:0.05em;">
            📅 ${data.dateStr}
          </div>
        </div>
      </div>

      <!-- Two-Column Product Table -->
      ${table}

      <!-- Footer Bar -->
      <div style="margin-top:20px;padding:12px 18px;background:#0D4429;border:1px solid #E5A93C;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
        <div style="font-size:12px;font-weight:700;color:#FACC15;display:flex;align-items:center;gap:8px;">
          <span>💬 For Payments &amp; WhatsApp Orders:</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#FFFFFF;font-weight:800;">${brand.contactNumber || '03061110041'}</span>
        </div>
        <div style="font-size:10px;font-weight:800;color:#FDFBF7;letter-spacing:0.08em;text-transform:uppercase;">
          ${brand.companyName || 'HALAL VEGG SUPPLIES'} · GUARANTEED FRESHNESS
        </div>
      </div>

    </div>
  `;

  const styles = buildDocStyles(brand);
  const baseHref = origin || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${baseHref}/">
  <title>Daily Price List — ${data.dateStr}</title>
  <style>
    ${styles}
    body { background: #062315 !important; color: #FFFFFF !important; padding: 20px 0; }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

// ─── Purchase Voucher Types ───────────────────────────────────────────────────

export interface PurchaseItem {
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  urduName?: string | null;
  imageUrl?: string | null;
  emoji?: string | null;
  productId?: string | null;
}

export interface PurchaseData {
  voucherNo: string;
  date: string;
  supplierName: string;
  supplierId?: string | null;
  supplierPhone?: string | null;
  items: PurchaseItem[];
  subtotal: number;
  transportCost: number;
  total: number;
  paid: number;
  balance: number;
  notes?: string | null;
}

// ─── Purchase Voucher HTML Generator ───────────────────────────────────────────

export function generatePurchaseHTML(pur: PurchaseData, brand: BrandConfig, origin = ''): string {
  const today = new Date(pur.date).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi',
  });
  const time = new Date(pur.date).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi',
  });
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });

  const header = buildHeader(
    brand,
    'PURCHASE VOUCHER',
    `${today} · ${time}`,
    `#${pur.voucherNo}`,
    origin
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label">Supplier <span class="urdu-inline-dark">(سپلائر)</span></div>
        <div class="doc-info-value large">${pur.supplierName}</div>
        ${pur.supplierPhone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${pur.supplierPhone}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label">Voucher Details <span class="urdu-inline-dark">(تفصیلات)</span></div>
        <div class="doc-info-value">Voucher Date: ${today}</div>
        <div class="doc-info-value">Time: ${time}</div>
      </div>
    </div>
  `;

  const itemRows = pur.items.map((item, i) => `
    <tr>
      <td class="center muted">${i + 1}</td>
      <td>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <strong>${item.itemName}</strong>
            ${item.urduName ? `<span class="urdu-inline-val">(${item.urduName})</span>` : ''}
          </div>
          ${getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl, origin)}
        </div>
      </td>
      <td class="center mono">${item.qty}</td>
      <td class="muted">${item.unit}</td>
      <td class="right mono">${item.rate.toLocaleString()}</td>
      <td class="right mono">${item.amount.toLocaleString()}</td>
    </tr>
  `).join('');

  const table = `
    <table class="doc-table">
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Product <span class="urdu-inline">(پروڈکٹ)</span></th>
          <th class="center">Qty</th>
          <th>Unit</th>
          <th class="right">Buy Rate (Rs)</th>
          <th class="right">Amount (Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
  `;

  const summary = `
    <div class="doc-summary-wrap">
      <div class="doc-summary-box">
        <div class="doc-summary-row">
          <span class="label">
            Subtotal
            <span class="urdu-sub">سب ٹوٹل</span>
          </span>
          <span class="val">Rs ${pur.subtotal.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row">
          <span class="label">
            Transport Cost
            <span class="urdu-sub">کرایہ</span>
          </span>
          <span class="val">Rs ${pur.transportCost.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row total-row">
          <span class="label">
            Grand Total
            <span class="urdu-sub">کل رقم</span>
          </span>
          <span class="val">Rs ${pur.total.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            Paid Amount
            <span class="urdu-sub">ادا شدہ</span>
          </span>
          <span class="val">- Rs ${pur.paid.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row grand-row ${pur.balance <= 0 ? 'paid-row' : ''}">
          <span class="label">
            Balance Due
            <span class="urdu-sub">بقیہ رقم</span>
          </span>
          <span class="val">Rs ${pur.balance.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;

  const notesBlock = pur.notes ? `<div class="doc-notes"><strong>Note:</strong> ${pur.notes}</div>` : '';

  const statusBadge = `
    <div class="doc-status-wrap">
      <span class="doc-status-badge ${pur.balance <= 0 ? 'PAID' : pur.paid > 0 ? 'PARTIAL' : 'UNPAID'}">
        Payment Status: ${pur.balance <= 0 ? 'PAID' : pur.paid > 0 ? 'PARTIAL' : 'UNPAID'}
      </span>
    </div>
  `;

  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${infoGrid}
    ${table}
    ${summary}
    ${notesBlock}
    ${statusBadge}
    ${footer}
  `;

  return buildDocShell(brand, `Purchase Voucher #${pur.voucherNo}`, body, origin);
}

// ─── Outstanding Dues Statement Types ──────────────────────────────────────────

export interface OutstandingDueItem {
  invoiceNo: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

export interface OutstandingDueData {
  clientName: string;
  clientId?: string | null;
  clientType?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  deliveryLocation?: string | null;
  openingBalance?: number;
  invoices: OutstandingDueItem[];
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
}

// ─── Outstanding Dues Statement HTML Generator ──────────────────────────────────

export function generateOutstandingDueStatementHTML(data: OutstandingDueData, brand: BrandConfig, origin = ''): string {
  const today = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi',
  });
  const time = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Karachi',
  }).toLowerCase();
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const isClear = data.totalOutstanding <= 0;
  const statusClass = isClear ? 'PAID' : 'UNPAID';

  const logoSrc = (brand.logoUrl && (brand.logoUrl.startsWith('data:') || brand.logoUrl.startsWith('http')))
    ? brand.logoUrl
    : (brand.logoUrl && brand.logoUrl !== '/logo-transparent.avif' ? `${origin}${brand.logoUrl}` : DEFAULT_LOGO_BASE64);

  const clientPhone = data.phone ?? '';
  const whatsappLine = data.whatsapp && data.whatsapp !== data.phone ? ` · WA: ${data.whatsapp}` : '';
  const addrLine = [data.address, data.deliveryLocation ? `Delivery: ${data.deliveryLocation}` : ''].filter(Boolean).join(' · ');

  // ── Header (Exact Invoice Match) ──
  const header = `
    <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid ${brand.primaryColor}; margin-bottom: 18px; direction: ltr;">
      <!-- Left: Logo & Tagline -->
      <div style="text-align: left; display: flex; flex-direction: column; align-items: flex-start;">
        <img class="doc-header-logo" src="${logoSrc}" alt="${brand.companyName}" style="height: 52px; width: auto; object-fit: contain;">
        <div style="font-size: 8.5px; color: #2D6A4F; margin-top: 5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${brand.tagline}</div>
      </div>

      <!-- Right: Urdu & English Title, Date & Time, Client ID -->
      <div style="text-align: right; direction: rtl;">
        <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 28px; font-weight: 800; color: ${brand.primaryColor}; line-height: 1.1;">واجب الادا تفصیل</div>
        <div style="font-size: 20px; font-weight: 800; color: ${brand.primaryColor}; letter-spacing: 0.06em; text-transform: uppercase; font-family: 'Lora', Georgia, serif; margin-top: 2px;">DUE STATEMENT</div>
        <div style="font-size: 11.5px; color: #444444; margin-top: 3px; font-family: 'Lora', Georgia, serif; font-weight: 600;">${today} · ${time}</div>
        <div style="font-family: 'IBM Plex Mono', monospace; font-size: 14px; font-weight: 800; color: ${brand.primaryColor}; margin-top: 4px; letter-spacing: 0.04em;">#${data.clientId || 'WH-0000'}</div>
      </div>
    </div>
  `;

  // ── 2-Column Info Cards ──
  const infoGrid = `
    <div class="doc-info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; direction: ltr;">
      <!-- Left Card: Account Overview -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: left; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(ACCOUNT OVERVIEW)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">اکاؤنٹ خلاصہ</span>
        </div>
        <div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; margin-bottom: 3px;">
          📋 ${data.invoices.length} Unpaid / Partial Invoice${data.invoices.length !== 1 ? 's' : ''}
        </div>
        <div style="font-size: 12px; font-weight: 600; color: #333333; margin-bottom: 8px;">
          📅 As of ${today}
        </div>
        <div style="font-size: 11px; color: #555555; font-weight: 600; margin-bottom: 2px;">
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 15px; color: #1A1A1A; font-weight: 700; direction: rtl; unicode-bidi: isolate;">ادائیگی کیفیت</span>
          <span style="font-family: 'Lora', Georgia, serif; font-size: 10px; margin-left: 2px;">(STATUS)</span>
        </div>
        <div style="font-size: 13.5px; font-weight: 800; color: ${isClear ? '#166534' : '#B5533C'}; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.04em;">
          ${isClear ? 'ALL DUES CLEARED (Rs 0)' : `OUTSTANDING DUE: Rs ${Math.max(0, data.totalOutstanding).toLocaleString()}`}
        </div>
      </div>

      <!-- Right Card: Billed To / Client -->
      <div style="background: #F8FAF8; border: 1px solid #DCE3DB; border-radius: 8px; padding: 14px 18px; text-align: right; display: flex; flex-direction: column; justify-content: space-between;">
        <div style="text-align: right; margin-bottom: 6px;">
          <span style="font-family: 'Lora', Georgia, serif; color: #555555; font-size: 11px; font-weight: 600;">(CLIENT)</span>
          <span style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 700; color: #1A1A1A; margin-left: 4px; direction: rtl; unicode-bidi: isolate;">کلائنٹ</span>
        </div>
        <div style="font-size: 16px; font-weight: 800; color: #1A1A1A; margin-bottom: 3px; font-family: 'Lora', Georgia, serif;">
          ${data.clientName} <span style="font-size: 12px; font-weight: 600; color: #6B7C6A; font-family: 'IBM Plex Mono', monospace;">(${data.clientId || '—'})</span>
        </div>
        <div style="font-size: 11px; color: #7A8C79; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.04em;">
          ${data.clientType || 'RESTAURANT'}
        </div>
        ${clientPhone ? `<div style="font-size: 12.5px; font-weight: 700; color: #1A1A1A; direction: ltr; text-align: right; margin-top: 2px;">📞 ${clientPhone}${whatsappLine}</div>` : ''}
        ${addrLine ? `<div style="font-size: 11px; color: #64748B; margin-top: 2px;">📍 ${addrLine}</div>` : ''}
      </div>
    </div>
  `;

  // ── Outstanding Invoices Table (Exact Invoice Style) ──
  const itemRows = data.invoices.map((inv, i) => {
    const invDateStr = new Date(inv.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const isUnpaid = inv.status === 'PENDING' || inv.balance === inv.total;
    return `
      <tr style="background: ${i % 2 === 1 ? '#F9FAF9' : '#FFFFFF'}; border-bottom: 1px solid #ECECEC;">
        <td class="center muted" style="padding: 9px 6px; font-size: 11.5px; font-weight: 600; color: #64748B;">${i + 1}</td>
        <td style="padding: 9px 10px; text-align: right;">
          <span style="font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; font-weight: 800; color: ${brand.primaryColor};">${inv.invoiceNo}</span>
        </td>
        <td class="center" style="padding: 9px 8px; font-size: 12px; font-weight: 600; color: #333333;">${invDateStr}</td>
        <td class="center mono" style="padding: 9px 8px; font-size: 12.5px; font-weight: 700; color: #1A1A1A;">
          ${inv.total.toLocaleString()}
        </td>
        <td class="center mono" style="padding: 9px 8px; font-size: 12.5px; font-weight: 700; color: ${inv.paid > 0 ? '#166534' : '#94A3B8'};">
          ${inv.paid > 0 ? inv.paid.toLocaleString() : '—'}
        </td>
        <td class="center mono" style="padding: 9px 8px; font-size: 13px; font-weight: 800; color: #B5533C;">
          ${inv.balance.toLocaleString()}
        </td>
        <td class="center" style="padding: 9px 8px;">
          <span style="display: inline-block; font-size: 9.5px; font-weight: 800; padding: 2px 7px; border-radius: 12px; letter-spacing: 0.04em; background: ${inv.status === 'PAID' ? '#DCFCE7; color: #166534' : inv.status === 'PARTIAL' ? '#FEF3C7; color: #92400E' : '#FEE2E2; color: #991B1B'};">
            ${inv.status}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  const table = `
    <table class="doc-table rtl-table" style="direction: rtl; width: 100%; border-collapse: collapse; margin-bottom: 18px;">
      <thead>
        <tr style="background: ${brand.primaryColor}; color: #FFFFFF;">
          <th class="center" style="width: 32px; font-size: 11px; padding: 9px 6px; border-top-right-radius: 6px;">#</th>
          <th style="text-align: right; padding: 9px 10px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 15px; margin-left: 2px;">انوائس نمبر</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(INVOICE NO)</bdi>
          </th>
          <th class="center" style="width: 100px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">تاریخ</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(DATE)</bdi>
          </th>
          <th class="center" style="width: 95px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">کل رقم</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(TOTAL RS)</bdi>
          </th>
          <th class="center" style="width: 95px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">وصول شدہ</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(PAID RS)</bdi>
          </th>
          <th class="center" style="width: 105px; padding: 9px 6px; font-size: 11px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">بقیہ واجب</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(DUE RS)</bdi>
          </th>
          <th class="center" style="width: 80px; padding: 9px 8px; font-size: 11px; border-top-left-radius: 6px;">
            <span class="urdu-th" style="font-size: 14px; margin-left: 2px;">اسٹیٹس</span>
            <bdi dir="ltr" class="eng-th" style="font-size: 9px; unicode-bidi: isolate;">(STATUS)</bdi>
          </th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="7" style="text-align:center;color:#aaa;padding:20px;">No outstanding invoices found</td></tr>'}
      </tbody>
    </table>
  `;

  // ── Financial Summary Box & Status / WhatsApp Section ──
  const openBalRow = data.openingBalance && data.openingBalance > 0 ? `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
      <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #B5533C;">Rs ${data.openingBalance.toLocaleString()}</span>
      <div style="text-align: right;">
        <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #B5533C; line-height: 1.2;">سابقہ بقایا جات</div>
        <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Opening Balance</div>
      </div>
    </div>
  ` : '';

  const summary = `
    <div style="border: 1px solid #E5E7EB; border-radius: 6px; overflow: hidden; background: #FFFFFF; width: 340px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);">
      ${openBalRow}
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #1A1A1A;">Rs ${data.totalBilled.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #1A1A1A; line-height: 1.2;">کل بل رقم</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Invoiced</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid #E5E7EB; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 800; font-size: 15px; color: #166534;">Rs ${data.totalPaid.toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 16px; font-weight: 800; color: #166534; line-height: 1.2;">کل وصول شدہ رقم</div>
          <div style="font-size: 9.5px; color: #777777; font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Paid</div>
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: ${brand.primaryColor}; color: #FFFFFF; direction: ltr;">
        <span style="font-family: 'Lora', Georgia, serif; font-weight: 900; font-size: 18px; color: #FFFFFF;">Rs ${Math.max(0, data.totalOutstanding).toLocaleString()}</span>
        <div style="text-align: right;">
          <div style="font-family: 'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif; font-size: 18px; font-weight: 800; color: #FFFFFF; line-height: 1.2;">کل واجب الادا رقم</div>
          <div style="font-size: 10px; color: rgba(255,255,255,0.85); font-weight: 600; font-family: 'Lora', Georgia, serif;">Total Outstanding Balance</div>
        </div>
      </div>
    </div>
  `;

  const bottomSection = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 22px; margin-bottom: 24px; direction: ltr; gap: 20px;">
      <!-- Left: Financial Summary Box -->
      <div>
        ${summary}
      </div>

      <!-- Right: Payment Status Badge & WhatsApp Button -->
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 12px; width: 280px;">
        <div class="doc-status-badge ${statusClass}" style="width: 100%; text-align: center; padding: 9px 16px; border-radius: 20px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;">
          ACCOUNT STATUS: ${isClear ? 'ALL DUES CLEARED' : 'PAYMENT DUE'}
        </div>
        <a href="https://wa.me/923061110041" target="_blank" style="background: #00B050; color: #FFFFFF; font-size: 15px; font-weight: 800; padding: 12px 20px; border-radius: 8px; width: 100%; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 8px; font-family: 'Lora', Georgia, serif; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          Whatsapp | ${brand.contactNumber || '03061110041'}
        </a>
      </div>
    </div>
  `;

  const footer = `
    <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 14px; border-top: 1px solid #E2E8F0; margin-top: 18px; direction: ltr;">
      <div style="text-align: left;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">FOR PAYMENTS &amp; WHATSAPP INQUIRIES</div>
        <div style="font-size: 12px; font-weight: 700; color: #1A1A1A; margin-top: 2px;">WhatsApp / Contact: <strong>${brand.contactNumber || '03061110041'}</strong></div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 9.5px; color: #7A8C79; text-transform: uppercase; font-weight: 700; letter-spacing: 0.06em;">${brand.companyName || 'HALAL VEGG SUPPLIES'}</div>
        <div style="font-size: 11px; color: #6B7C6A; font-weight: 600; margin-top: 2px;">Printed: ${printedOn}</div>
      </div>
    </div>
  `;

  const body = `
    ${header}
    ${infoGrid}
    ${table}
    ${bottomSection}
    ${footer}
  `;

  return buildDocShell(brand, `Outstanding Due Statement — ${data.clientName}`, body, origin);
}

// ─── Collection Receipt Slip HTML Generator ─────────────────────────────────────

export interface CollectionSlipData {
  receiptNo: string;
  date: string;
  clientName: string;
  clientId?: string;
  phone?: string;
  paymentMethod: string;
  reference?: string;
  receivedBy?: string;
  previousBalance: number;
  currentBillAmount?: number;
  totalPayable: number;
  amountReceived: number;
  remainingBalance: number;
  excessPayment?: number;
  allocations?: Array<{
    invoiceNo: string;
    allocatedAmount: number;
    remainingBalance: number;
  }>;
  notes?: string;
}

export function generateCollectionSlipHTML(data: CollectionSlipData, brand: BrandConfig, origin = ''): string {
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });

  const header = buildHeader(
    brand,
    'OFFICIAL PAYMENT RECEIPT',
    data.date,
    `Receipt #${data.receiptNo}`,
    origin,
    'وصولی رسید'
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">نام کلائنٹ <span class="doc-info-sub-eng">(Customer Name)</span></div>
        <div class="doc-info-value large">${data.clientName}</div>
        ${data.phone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${data.phone}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">ادائیگی تفصیل <span class="doc-info-sub-eng">(Payment Details)</span></div>
        <div class="doc-info-value"><strong>طریقہ (Method):</strong> ${data.paymentMethod}</div>
        ${data.reference ? `<div class="doc-info-value"><strong>Ref:</strong> ${data.reference}</div>` : ''}
        ${data.receivedBy ? `<div class="doc-info-value"><strong>وصول کنندہ (Received By):</strong> ${data.receivedBy}</div>` : ''}
        <div class="doc-info-value"><strong>تاریخ (Date):</strong> ${data.date}</div>
      </div>
    </div>
  `;

  const excessAmt = data.excessPayment ?? 0;
  const kpiGrid = `
    <div class="doc-kpi-grid">
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu">سابقہ بقایا جات</span>
        <span class="doc-kpi-label-eng">Previous Outstanding</span>
        <div class="doc-kpi-value danger">Rs ${fmtMoney(data.previousBalance)}</div>
      </div>
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu" style="color:#166534;">آج کی وصولی</span>
        <span class="doc-kpi-label-eng">Paid Today</span>
        <div class="doc-kpi-value ok">Rs ${fmtMoney(data.amountReceived)}</div>
      </div>
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu" style="color:${excessAmt > 0 ? '#166534' : '#991B1B'};">${excessAmt > 0 ? 'ایڈوانس رقم' : 'بقیہ واجب الادا'}</span>
        <span class="doc-kpi-label-eng">${excessAmt > 0 ? 'Advance Credit' : 'Remaining Outstanding'}</span>
        <div class="doc-kpi-value ${excessAmt > 0 ? 'ok' : (data.remainingBalance > 0 ? 'danger' : 'ok')}">
          ${excessAmt > 0 ? `+Rs ${fmtMoney(excessAmt)}` : `Rs ${fmtMoney(data.remainingBalance)}`}
        </div>
      </div>
    </div>
  `;

  let allocationTable = '';
  if (data.allocations && data.allocations.length > 0) {
    allocationTable = `
      <div style="margin-top:20px;">
        <div style="font-size:13px; font-weight:700; color: ${brand.primaryColor}; margin-bottom:8px;">
          📍 FIFO Invoice Payment Allocation
        </div>
        <table class="doc-table">
          <thead>
            <tr>
              <th><span class="urdu-th">انواﺋس نمبر</span> <span class="eng-th">(Invoice #)</span></th>
              <th class="num"><span class="urdu-th">وصول شدہ رقم</span> <span class="eng-th">(Allocated Rs)</span></th>
              <th class="num"><span class="urdu-th">بقیہ انواﺋس واجب</span> <span class="eng-th">(Remaining Due)</span></th>
              <th style="text-align:center;"><span class="urdu-th">حالت</span> <span class="eng-th">(Status)</span></th>
            </tr>
          </thead>
          <tbody>
            ${data.allocations.map(a => `
              <tr>
                <td><strong>Invoice #${a.invoiceNo}</strong></td>
                <td class="num text-green"><strong>${fmtMoney(a.allocatedAmount)}</strong></td>
                <td class="num ${a.remainingBalance > 0 ? 'text-amber' : 'text-green'}">${fmtMoney(a.remainingBalance)}</td>
                <td style="text-align:center;">
                  <span class="doc-badge ${a.remainingBalance <= 0 ? 'paid' : 'partial'}">
                    ${a.remainingBalance <= 0 ? 'PAID' : 'PARTIAL'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  const summary = `
    <div class="doc-summary-wrap" style="margin-top:20px;">
      <div class="doc-summary-box">
        <div class="doc-summary-row prev">
          <span class="label">
            <span class="urdu-main" style="color:#991B1B;">سابقہ بقایا جات</span>
            <span class="eng-sub">Previous Balance</span>
          </span>
          <span class="val">Rs ${fmtMoney(data.previousBalance)}</span>
        </div>
        ${data.currentBillAmount && data.currentBillAmount > 0 ? `
          <div class="doc-summary-row">
            <span class="label">
              <span class="urdu-main">موجودہ بل</span>
              <span class="eng-sub">Current Bill Amount</span>
            </span>
            <span class="val">Rs ${fmtMoney(data.currentBillAmount)}</span>
          </div>
        ` : ''}
        <div class="doc-summary-row total-row">
          <span class="label">
            <span class="urdu-main" style="color:#0284C7;">کل قابل ادائیگی</span>
            <span class="eng-sub">Total Payable</span>
          </span>
          <span class="val">Rs ${fmtMoney(data.totalPayable)}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            <span class="urdu-main" style="color:#166534;">وصول شدہ رقم</span>
            <span class="eng-sub">Amount Received Today</span>
          </span>
          <span class="val" style="color:#166534;">Rs ${fmtMoney(data.amountReceived)}</span>
        </div>
        <div class="doc-summary-row grand-row">
          <span class="label">
            <span class="urdu-main" style="color:#FFFFFF !important; font-size:19px; font-weight:800;">${excessAmt > 0 ? 'ایڈوانس کریڈٹ' : 'بقیہ واجب الادا'}</span>
            <span class="eng-sub" style="color:rgba(255,255,255,0.85); font-size:11px;">${excessAmt > 0 ? 'Advance Credit' : 'Remaining Outstanding'}</span>
          </span>
          <span class="val" style="color:#FFFFFF; font-size:20px; font-weight:900;">${excessAmt > 0 ? `+Rs ${fmtMoney(excessAmt)}` : `Rs ${fmtMoney(data.remainingBalance)}`}</span>
        </div>
      </div>
    </div>
  `;

  const notesBlock = data.notes ? `
    <div style="margin-top:16px; padding:10px 14px; background:${brand.lightBg}; border:1px solid ${brand.lineColor}; border-radius:8px; font-size:12px; color:${brand.primaryColor};">
      <strong>Notes:</strong> ${data.notes}
    </div>
  ` : '';

  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${infoGrid}
    ${kpiGrid}
    ${summary}
    ${notesBlock}
    ${footer}
  `;

  return buildDocShell(brand, `Payment Receipt — ${data.clientName}`, body, origin);
}

export interface DailyPaymentHistoryDocData {
  businessDate: string;
  generatedAt?: string;
  summary: {
    totalTransactions: number;
    totalCollected: number;
    cashCollected: number;
    bankCollected: number;
    onlineCollected?: number;
    chequeCollected?: number;
    otherCollected?: number;
  };
  transactions: Array<{
    seqNo: number;
    referenceNo: string;
    time: string;
    clientCode: string;
    clientName: string;
    invoiceNo: string;
    method: string;
    receivedBy: string;
    amount: number;
    remainingBalance?: number | null;
  }>;
}

export function generateDailyPaymentHistoryHTML(data: DailyPaymentHistoryDocData, brand: BrandConfig, origin = ''): string {
  const printedOn = data.generatedAt || new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  const logoSrc   = brand.logoUrl || DEFAULT_BRAND.logoUrl;

  const header = buildHeader(brand, 'DAILY PAYMENT HISTORY', `Business Date: ${data.businessDate}`, `Generated: ${printedOn}`, origin, 'روزانہ ادائیگیوں کی ہسٹری');

  const kpiGrid = `
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin: 16px 0;">
      <div style="background:${brand.lightBg}; border:1px solid ${brand.lineColor}; padding:10px 12px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:${brand.accentColor}; font-weight:700; text-transform:uppercase;">Business Date</div>
        <div style="font-size:13px; font-weight:800; color:${brand.primaryColor}; margin-top:2px;">${data.businessDate}</div>
      </div>
      <div style="background:${brand.lightBg}; border:1px solid ${brand.lineColor}; padding:10px 12px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:${brand.accentColor}; font-weight:700; text-transform:uppercase;">Total Transactions</div>
        <div style="font-size:13px; font-weight:800; color:${brand.primaryColor}; margin-top:2px;">${data.summary.totalTransactions}</div>
      </div>
      <div style="background:#E6F4EA; border:1px solid #CEEAD6; padding:10px 12px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:#137333; font-weight:700; text-transform:uppercase;">Cash Collected</div>
        <div style="font-size:13px; font-weight:800; color:#137333; margin-top:2px;">${fmtMoney(data.summary.cashCollected)}</div>
      </div>
      <div style="background:#E8F0FE; border:1px solid #D2E3FC; padding:10px 12px; border-radius:8px; text-align:center;">
        <div style="font-size:10px; color:#1A73E8; font-weight:700; text-transform:uppercase;">Bank / Online</div>
        <div style="font-size:13px; font-weight:800; color:#1A73E8; margin-top:2px;">${fmtMoney((data.summary.bankCollected || 0) + (data.summary.onlineCollected || 0))}</div>
      </div>
    </div>
  `;

  const rows = data.transactions.map(t => `
    <tr style="border-bottom:1px solid #E2E8F0;">
      <td style="padding:8px 8px; font-size:11px; text-align:center; color:#64748B;">${t.seqNo}</td>
      <td style="padding:8px 8px; font-size:11px; font-weight:600; color:#0F172A; white-space:nowrap;">${t.time}</td>
      <td style="padding:8px 8px; font-size:11px;">
        <strong style="color:#0F172A;">${t.clientName}</strong>
        <div style="font-size:10px; color:#64748B;">${t.clientCode}</div>
      </td>
      <td style="padding:8px 8px; font-size:11px; color:#334155; font-weight:600;">${t.invoiceNo || '—'}</td>
      <td style="padding:8px 8px; font-size:11px; text-align:center;">
        <span style="background:${t.method === 'CASH' ? '#E6F4EA' : '#E8F0FE'}; color:${t.method === 'CASH' ? '#137333' : '#1A73E8'}; padding:2px 6px; border-radius:4px; font-weight:700; font-size:10px; text-transform:uppercase;">${t.method}</span>
      </td>
      <td style="padding:8px 8px; font-size:11px; color:#1E293B; font-weight:600;">👤 ${t.receivedBy}</td>
      <td style="padding:8px 8px; font-size:12px; font-weight:800; font-family:monospace; text-align:right; color:#137333;">${fmtMoney(t.amount)}</td>
    </tr>
  `).join('');

  const table = `
    <table style="width:100%; border-collapse:collapse; margin-top:10px; font-family:'Lora', Georgia, serif;">
      <thead>
        <tr style="background:${brand.primaryColor}; color:#FFFFFF; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">
          <th style="padding:8px; text-align:center; border-top-left-radius:6px;">#</th>
          <th style="padding:8px; text-align:left;">Time</th>
          <th style="padding:8px; text-align:left;">Client</th>
          <th style="padding:8px; text-align:left;">Invoice Ref</th>
          <th style="padding:8px; text-align:center;">Method</th>
          <th style="padding:8px; text-align:left;">Received By</th>
          <th style="padding:8px; text-align:right; border-top-right-radius:6px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows.length > 0 ? rows : '<tr><td colspan="7" style="padding:20px; text-align:center; color:#64748B; font-style:italic;">No collection transactions recorded for this business day.</td></tr>'}
      </tbody>
      <tfoot>
        <tr style="background:${brand.lightBg}; border-top:2px solid ${brand.primaryColor};">
          <td colspan="6" style="padding:10px 8px; font-size:13px; font-weight:800; color:${brand.primaryColor}; text-align:right;">
            TOTAL COLLECTION AMOUNT:
          </td>
          <td style="padding:10px 8px; font-size:15px; font-weight:800; font-family:monospace; text-align:right; color:${brand.primaryColor};">
            ${fmtMoney(data.summary.totalCollected)}
          </td>
        </tr>
      </tfoot>
    </table>
  `;

  const footer = buildFooter(brand, `Generated on ${printedOn} • Business Day 5:00 AM PKT`);

  const body = `
    ${header}
    ${kpiGrid}
    ${table}
    ${footer}
  `;

  return buildDocShell(brand, `Daily Payment History — ${data.businessDate}`, body, origin);
}

// ─── Print Helpers ────────────────────────────────────────────────────────────

/**
 * Opens a blank popup window synchronously.
 * Call this BEFORE any async operations to avoid the browser popup blocker.
 * Then pass the returned window reference to writeAndPrint().
 */
export function openPrintWindow(): Window | null {
  const w = window.open('', '_blank', 'width=820,height=1050');
  if (w) {
    // Show a loading indicator immediately so the user sees something
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        body { font-family: 'Lora', Georgia, serif; display: flex; align-items: center;
               justify-content: center; height: 100vh; margin: 0;
               background: #F4F8F0; color: #1A3C28; }
        .loading { text-align: center; }
        .spinner { width: 40px; height: 40px; border: 3px solid #D4E6CC;
                   border-top-color: #1A3C28; border-radius: 50%;
                   animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        p { font-size: 13px; color: #4A6A45; font-weight: 500; }
      </style>
    </head><body><div class="loading">
      <div class="spinner"></div><p>Preparing document...</p>
    </div></body></html>`);
    w.document.close();
  }
  return w;
}

/**
 * Writes the final HTML into an already-opened popup window and triggers print.
 * Use with openPrintWindow() to avoid popup blocker issues with async functions.
 */
export function writeAndPrint(w: Window, html: string, windowTitle?: string): void {
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.document.title = windowTitle || 'Document';
  w.focus();
  setTimeout(() => { w.print(); }, 700);
}

/**
 * Combined helper for synchronous (non-async) callers.
 * Opens window and writes content in one call.
 */
export function openAndPrint(html: string, windowTitle?: string): Window | null {
  const w = openPrintWindow();
  if (!w) return null;
  // Small delay to let browser render the loading screen before replacing
  setTimeout(() => writeAndPrint(w, html, windowTitle), 50);
  return w;
}

/**
 * Opens a blank popup window for DOWNLOAD (Save as PDF) flow.
 */
export function openDownloadWindow(): Window | null {
  const w = window.open('', '_blank', 'width=820,height=1050');
  if (w) {
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <style>
        body { font-family: 'Lora', Georgia, serif; display: flex; align-items: center;
               justify-content: center; height: 100vh; margin: 0;
               background: #F4F8F0; color: #1A3C28; }
        .loading { text-align: center; }
        .spinner { width: 40px; height: 40px; border: 3px solid #D4E6CC;
                   border-top-color: #1A3C28; border-radius: 50%;
                   animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        p { font-size: 13px; color: #4A6A45; font-weight: 500; }
        small { font-size: 11px; color: #7A8C79; }
      </style>
    </head><body><div class="loading">
      <div class="spinner"></div>
      <p>Preparing PDF download...</p>
      <small>Choose "Save as PDF" in the print dialog</small>
    </div></body></html>`);
    w.document.close();
  }
  return w;
}

/**
 * Writes the unified HTML into a pre-opened window and auto-triggers the print dialog.
 * User selects "Save as PDF" as the destination to download the document.
 * Shows a sticky banner reminding the user to pick Save as PDF.
 */
export function writeAndDownload(w: Window, html: string, filename?: string): void {
  const withHint = html.replace(
    '</body>',
    `<div style="
      position:fixed;bottom:0;left:0;right:0;z-index:99999;
      background:#1A3C28;color:#fff;padding:10px 20px;
      font-family:'Lora', Georgia, serif;font-size:12px;font-weight:600;
      display:flex;align-items:center;justify-content:space-between;gap:16px;
      box-shadow:0 -2px 12px rgba(0,0,0,.15);
    " class="no-print">
      <span>&#128190; In the print dialog &rarr; set <strong>Destination = Save as PDF</strong></span>
      <span style="opacity:.7;font-size:11px;">${filename ? filename + ' &middot; ' : ''}HALAL VEGG SUPPLIES</span>
    </div>
    <style>@media print{.no-print{display:none!important}}</style>
    <script>
      window.onload=function(){
        document.title=${JSON.stringify(filename || 'Document')};
        setTimeout(function(){window.print();},800);
      };
    </script>
    </body>`
  );
  w.document.open();
  w.document.write(withHint);
  w.document.close();
  w.document.title = filename || 'Document';
  w.focus();
}

/**
 * Detects the client platform: 'ios', 'android', or 'desktop'.
 */
export function detectPlatform(): 'ios' | 'android' | 'desktop' {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/android/i.test(ua)) {
    return 'android';
  }
  return 'desktop';
}

/**
 * Triggers a crisp image download natively on Android, iOS, and Desktop.
 * - iOS (iPhone/iPad): Opens native iOS Share Sheet via Web Share API presenting "Save Image" (Photos app), AirDrop, WhatsApp.
 * - Android: Downloads binary JPEG Blob so MediaStore/Gallery scanner indexes it immediately.
 * - Desktop: Performs a clean native file download.
 */
export async function downloadImage(
  dataUrl: string,
  filename: string,
  onNotify?: (msg: string) => void
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const notify = (msg: string) => { if (onNotify) onNotify(msg); };

  try {
    const platform = detectPlatform();
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    const cleanFilename = filename.endsWith('.jpg') || filename.endsWith('.jpeg') ? filename : `${filename}.jpg`;

    // ── iOS Strategy: Native Share Sheet (Save to Photos) ───────────────────
    if (platform === 'ios') {
      const file = new File([blob], cleanFilename, { type: 'image/jpeg' });
      const canShareFiles = typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFiles) {
        try {
          notify('📤 Opening iOS Share Sheet...');
          await navigator.share({
            files: [file],
            title: cleanFilename,
          });
          notify('✅ Select "Save Image" to add to your Photos library');
          return true;
        } catch (shareErr: any) {
          if (shareErr?.name === 'AbortError') {
            notify('');
            return true;
          }
          console.warn('iOS Web Share API failed:', shareErr);
        }
      }

      // iOS Fallback (if Web Share API unavailable): Clear explicit guidance
      notify('Tap the Share button 📤 at the bottom of Safari and select "Save Image" to save to Photos.');
      return false;
    }

    // ── Android & Desktop Strategy: Binary Blob URL download ────────────────
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = cleanFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    notify(platform === 'android' ? '✅ Image downloaded! View in Gallery / Photos app' : '✅ JPG downloaded successfully');
    return true;
  } catch (err) {
    console.error('downloadImage error:', err);
    notify('❌ Download failed');
    return false;
  }
}

/**
 * Helper to convert any PNG/Canvas data URL to high-definition 98%+ quality JPEG with white background fill.
 */
export async function convertDataUrlToHighResJpg(dataUrl: string, quality = 0.98): Promise<string> {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      // Fill with solid white background to avoid JPEG black alpha artifacts
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Rigorously preloads, decodes, and verifies all <img> elements inside a DOM container
 * to ensure Safari and all mobile/desktop browsers have completely loaded and painted
 * every product image with valid natural dimensions prior to canvas capture.
 */
async function preloadAndVerifyImages(container: HTMLElement, timeoutMs = 4000): Promise<void> {
  const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
  if (imgs.length === 0) return;

  const loadPromises = imgs.map((img) => {
    return new Promise<void>((resolve) => {
      img.loading = 'eager';
      img.decoding = 'async';
      if (!img.crossOrigin && img.src && !img.src.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }

      const onDone = async () => {
        try {
          if (typeof img.decode === 'function') {
            await img.decode().catch(() => {});
          }
        } catch {}

        if (img.naturalWidth === 0 || img.naturalHeight === 0) {
          img.style.display = 'none';
          const sibling = img.nextElementSibling as HTMLElement | null;
          if (sibling) sibling.style.display = 'inline-flex';
        }
        resolve();
      };

      if (img.complete && img.naturalWidth > 0) {
        onDone();
      } else {
        const timer = setTimeout(() => {
          if (img.naturalWidth === 0 || img.naturalHeight === 0) {
            img.style.display = 'none';
            const sibling = img.nextElementSibling as HTMLElement | null;
            if (sibling) sibling.style.display = 'inline-flex';
          }
          resolve();
        }, timeoutMs);

        img.onload = () => {
          clearTimeout(timer);
          onDone();
        };
        img.onerror = () => {
          clearTimeout(timer);
          img.style.display = 'none';
          const sibling = img.nextElementSibling as HTMLElement | null;
          if (sibling) sibling.style.display = 'inline-flex';
          resolve();
        };
      }
    });
  });

  await Promise.all(loadPromises);

  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(resolve, 60);
    }
  });
}

/**
 * Generates a high-quality Full HD JPEG image from an invoice/document HTML string using client-side html2canvas.
 * Instantaneous (< 400ms), 0 MB server RAM, 0% server CPU.
 */
async function renderClientSideCanvas(html: string): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';

  const container = document.createElement('div');
  container.id = 'hd-export-container';
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 794px;
    min-width: 794px;
    max-width: 794px;
    padding: 0;
    margin: 0;
    background: #ffffff;
    z-index: -9999;
    font-size: 16px;
    box-sizing: border-box;
    transform: none !important;
    overflow: visible;
  `;

  const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  container.innerHTML = cleanHtml;
  document.body.appendChild(container);

  try {
    if ((document as any).fonts?.ready) {
      await Promise.race([(document as any).fonts.ready, new Promise((r) => setTimeout(r, 600))]);
    }

    // Comprehensive image preload, decode, and natural dimension verification
    await preloadAndVerifyImages(container, 4000);

    const contentHeight = container.scrollHeight || 1123;

    const html2canvasModule = await import('html2canvas');
    const html2canvas = html2canvasModule.default || html2canvasModule;

    const cvs = await html2canvas(container, {
      scale: 2.5, // 2.5x scale (1985px width Full HD edge-to-edge, ultra-sharp and fast)
      width: 794,
      height: contentHeight,
      windowWidth: 850,
      windowHeight: 1400,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 5000,
      onclone: (clonedDoc) => {
        const clonedElem = clonedDoc.getElementById('hd-export-container');
        if (clonedElem) {
          clonedElem.style.width = '794px';
          clonedElem.style.minWidth = '794px';
          clonedElem.style.maxWidth = '794px';
          clonedElem.style.padding = '0px';
          clonedElem.style.margin = '0px';
          clonedElem.style.transform = 'none';

          const clonedImgs = Array.from(clonedElem.querySelectorAll('img')) as HTMLImageElement[];
          for (const img of clonedImgs) {
            img.loading = 'eager';
            img.decoding = 'sync';
            if (!img.crossOrigin && img.src && !img.src.startsWith('data:')) {
              img.crossOrigin = 'anonymous';
            }
          }
        }
      },
    });

    return cvs.toDataURL('image/jpeg', 0.92);
  } catch (canvasErr) {
    console.warn('html2canvas client render error, falling back to server:', canvasErr);
    return '';
  } finally {
    container.parentNode?.removeChild(container);
  }
}

/**
 * Generates a True Full HD (2000px+ width) JPG image from an invoice/document HTML string.
 * Priority: Instant client-side HTML5 canvas (< 400ms) -> Server-side Puppeteer fallback.
 */
export async function generateTemplateJpgBase64(html: string): Promise<string> {
  if (!html || typeof window === 'undefined') return '';

  // ── Step 1: Instant Client-Side Generation (< 400ms, 0 MB server RAM & 0% server CPU) ──
  try {
    const clientJpg = await renderClientSideCanvas(html);
    if (clientJpg && clientJpg.length > 500) {
      return clientJpg;
    }
  } catch (clientErr) {
    console.warn('Client-side canvas render error, falling back to server render:', clientErr);
  }

  // ── Step 2: Server-Side Fallback (only if client-side rendering was not supported) ──
  const TARGET_WIDTH = 794;
  const token = typeof window !== 'undefined' ? (localStorage.getItem('sabzi_token') || localStorage.getItem('token') || localStorage.getItem('auth_token') || sessionStorage.getItem('sabzi_token') || sessionStorage.getItem('token') || '') : '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch('/api/render/jpeg', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ html, width: TARGET_WIDTH, quality: 85 }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string) || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch (err: any) {
    console.warn('Server JPEG render fallback failed:', err);
  }

  return '';
}

/**
 * Generates a high-quality Full HD image from an invoice/document HTML string.
 */
export async function generateTemplateImageBase64(html: string): Promise<string> {
  return await generateTemplateJpgBase64(html);
}


// ─── WhatsApp Image Sharing ────────────────────────────────────────────────────

export interface WhatsAppImageShareOptions {
  /** Pre-generated JPG base64 dataUrl (optional — if provided, skips image generation). */
  jpgBase64?: string;
  /** Document HTML to render if jpgBase64 is not provided. */
  html?: string;
  /** Filename for the downloaded image (e.g. "Invoice_IN-0001.jpg"). */
  filename: string;
  /** Client WhatsApp/phone number (e.g. "923001234567" or "03001234567"). */
  phone?: string;
}

export interface WhatsAppShareResult {
  /** Whether the share operation completed without error */
  success: boolean;
  /** 'native' = Web Share API used (mobile). 'modal' = caller should show WhatsAppShareModal. 'error' = failed to generate image. */
  method: 'native' | 'modal' | 'error';
  /** Generated JPG base64 (set when method === 'modal') */
  jpgBase64?: string;
  /** Formatted WhatsApp URL for the modal to use */
  whatsappUrl?: string;
}

/**
 * Shares a document (invoice / due statement) as a high-quality JPG image via WhatsApp.
 *
 * Priority strategy:
 *   1. Mobile native Web Share API with file attachment (Android / iOS Chrome & Safari).
 *   2. Desktop / unsupported — returns { method: 'modal', jpgBase64, whatsappUrl } so the
 *      caller can render <WhatsAppShareModal> which lets the user copy the image and open WhatsApp.
 *
 * @returns WhatsAppShareResult
 */
export async function shareDocumentAsImageOnWhatsApp(
  opts: WhatsAppImageShareOptions,
  onProgress?: (msg: string) => void,
): Promise<WhatsAppShareResult> {
  const notify = (msg: string) => { if (onProgress) onProgress(msg); };

  // ── Step 1: Obtain JPG ──────────────────────────────────────────────────────
  let jpgBase64 = opts.jpgBase64 || '';

  if (!jpgBase64 && opts.html) {
    notify('⏳ Generating image...');
    try {
      jpgBase64 = await generateTemplateJpgBase64(opts.html);
    } catch (err) {
      console.error('generateTemplateJpgBase64 failed:', err);
    }
  }

  if (!jpgBase64) {
    notify('❌ Unable to generate the image. Please try again.');
    return { success: false, method: 'error' };
  }

  // ── Step 2: Build phone number URL ──────────────────────────────────────────
  let ph = (opts.phone || '').replace(/[^0-9]/g, '');
  if (ph.startsWith('0') && ph.length === 11) ph = `92${ph.slice(1)}`;
  else if (ph.length === 10) ph = `92${ph}`;

  const whatsappUrl = ph ? `https://wa.me/${ph}` : 'https://wa.me/';

  // ── Step 3: Try native Web Share API (mobile Chrome/Safari) ─────────────────
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    try {
      // Convert base64 → Blob → File
      const base64Data = jpgBase64.includes(',') ? jpgBase64.split(',')[1] : jpgBase64;
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const file = new File([blob], opts.filename, { type: 'image/jpeg' });

      const shareData: ShareData = { files: [file], title: opts.filename };

      if (navigator.canShare(shareData)) {
        notify('📤 Opening share sheet...');
        await navigator.share(shareData);
        notify('✅ Image shared successfully!');
        return { success: true, method: 'native' };
      }
    } catch (shareErr: any) {
      // User cancelled (AbortError) — stop silently
      if (shareErr?.name === 'AbortError') {
        notify('');
        return { success: false, method: 'error' };
      }
      console.warn('Web Share API failed, falling back to modal:', shareErr);
    }
  }

  // ── Step 4: Desktop / fallback — return image data for caller to show modal ──
  notify('');
  return { success: true, method: 'modal', jpgBase64, whatsappUrl };
}
