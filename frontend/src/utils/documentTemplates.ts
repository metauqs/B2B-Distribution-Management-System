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

// ─── Brand Configuration ───────────────────────────────────────────────────────

export interface BrandConfig {
  companyName: string;    // "HALAL VEGG SUPPLIES"
  tagline: string;        // "FRESH FROM MANDI . DAILY DELIVERY"
  logoUrl: string;        // "/logo-transparent.png"  (relative or absolute)
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

/**
 * Fetch brand config from /api/broadcasts/settings and merge with defaults.
 * Falls back gracefully if the API is unavailable.
 */
export async function loadBrandConfig(): Promise<BrandConfig> {
  try {
    const res = await fetch('/api/broadcasts/settings');
    if (!res.ok) return DEFAULT_BRAND;
    const data = await res.json();
    if (!data?.success) return DEFAULT_BRAND;
    const s = data.data ?? {};
    return {
      ...DEFAULT_BRAND,
      contactNumber: s.phoneNumber || DEFAULT_BRAND.contactNumber,
    };
  } catch {
    return DEFAULT_BRAND;
  }
}

/**
 * Load brand config AND embed the logo as a base64 data URI so it renders
 * correctly in both popup print windows and server-side Puppeteer.
 */
export async function loadBrandConfigWithLogo(origin = typeof window !== 'undefined' ? window.location.origin : ''): Promise<BrandConfig> {
  const brand = await loadBrandConfig();
  const logoDataUri = await resolveLogoDataUri(brand.logoUrl, origin);
  return { ...brand, logoUrl: logoDataUri };
}

// ─── Shared CSS Design System ─────────────────────────────────────────────────

/**
 * Returns the shared <style> block used by every document type.
 * Typography, page size, brand colors, table design, footer, and Urdu font
 * are all defined here once.
 */
function buildDocStyles(b: BrandConfig): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;600;700&family=Noto+Sans+Arabic:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap');

    @font-face {
      font-family: 'Jameel Khushkhat L';
      src: url('https://dashboard.urdufonts.com/storage/fonts/previews/GEdzNGZsOebPn6FOhNwfFKcy7j6TAV3vrHm2M5Jf.woff2') format('woff2');
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      font-family: 'Inter', 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Segoe UI', system-ui, sans-serif;
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
      font-family: 'Inter', sans-serif;
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
      font-family: 'Inter', sans-serif;
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
      font-size: 9.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      white-space: nowrap;
    }
    .doc-table thead th.right { text-align: right; }
    .doc-table thead th.center { text-align: center; }

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
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
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

    /* ── Summary Box ───────────────────────────────────── */
    .doc-summary-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 20px;
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
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
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
    : (b.logoUrl && b.logoUrl !== '/logo-transparent.png' ? `${origin}${b.logoUrl}` : DEFAULT_LOGO_BASE64);

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

function buildDocShell(b: BrandConfig, title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
  // 1. Highest Priority: Uploaded Image from Product Master (imageUrl)
  if (imageUrl && imageUrl.trim()) {
    let finalUrl = imageUrl.trim();
    if (!finalUrl.startsWith('data:') && !finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `${origin}${finalUrl.startsWith('/') ? '' : '/'}${finalUrl}`;
    }
    return `<img src="${finalUrl}" alt="${name}" style="width:22px;height:22px;object-fit:cover;vertical-align:middle;border-radius:4px;margin-left:6px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:20px;margin-left:6px;vertical-align:middle;font-family:'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol',sans-serif;">${emoji || '🥬'}</span>`;
  }

  // 2. Second Priority: Explicit Product Master Emoji
  if (emoji && emoji.trim()) {
    return `<span style="font-size:22px;margin-left:6px;vertical-align:middle;font-family:'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol',sans-serif;">${emoji.trim()}</span>`;
  }

  const n = (name || '').toLowerCase().trim();

  // 3. Pre-mapped static image assets
  if (n.includes('lady finger') || n.includes('okra') || n.includes('bhindi') || n === 'ladyfinger') {
    return `<img src="${origin}/ladyfinger.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🫛</span>`;
  }
  if (n.includes('guava') || n.includes('amrood')) {
    return `<img src="${origin}/guava.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🍏</span>`;
  }
  if (n.includes('papaya') || n.includes('papeeta') || n.includes('papiya')) {
    return `<img src="${origin}/papaya.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🍈</span>`;
  }
  if (n.includes('pomegranate') || n.includes('anar')) {
    return `<img src="${origin}/pomegranate.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🍎</span>`;
  }
  if (n.includes('turnip') || n.includes('shalgam')) {
    return `<img src="${origin}/turnip.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🫜</span>`;
  }
  if (n.includes('radish') || n.includes('mooli')) {
    return `<img src="${origin}/radish.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🫜</span>`;
  }
  if (n.includes('beetroot') || n.includes('chukandar')) {
    return `<img src="${origin}/beetroot.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🫜</span>`;
  }
  if (n.includes('plum') || n.includes('alobukhara') || n.includes('alubukhara')) {
    return `<img src="${origin}/plum.png" alt="${name}" style="width:18px;height:18px;object-fit:cover;vertical-align:middle;border-radius:2px;margin-left:4px;" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='inline-block';"><span style="display:none;font-size:16px;margin-left:4px;vertical-align:middle;">🍑</span>`;
  }

  // 4. Standardized Fallback Emojis
  let fallbackEmoji = '🥬';
  if (n.includes('beans') || n.includes('phali')) fallbackEmoji = '🫘';
  else if (n.includes('bitter') || n.includes('karela')) fallbackEmoji = '🥒';
  else if (n.includes('bottle') || n.includes('lauki') || n.includes('ghia') || n.includes('gourd') || n.includes('tori') || n.includes('turi') || n.includes('turai')) fallbackEmoji = '🥒';
  else if (n.includes('brinjal') || n.includes('baingan') || n.includes('eggplant')) fallbackEmoji = '🍆';
  else if (n.includes('broccoli')) fallbackEmoji = '🥦';
  else if (n.includes('cabbage') || n.includes('gobhi') || n.includes('gobi')) fallbackEmoji = '🥬';
  else if (n.includes('capsicum') || n.includes('shimla')) fallbackEmoji = '🫑';
  else if (n.includes('carrot') || n.includes('gajar')) fallbackEmoji = '🥕';
  else if (n.includes('cauliflower')) fallbackEmoji = '🥦';
  else if (n.includes('coriander') || n.includes('dhaniya')) fallbackEmoji = '🌿';
  else if (n.includes('corn') || n.includes('makai') || n.includes('bhutta')) fallbackEmoji = '🌽';
  else if (n.includes('cucumber') || n.includes('kheera')) fallbackEmoji = '🥒';
  else if (n.includes('garlic') || n.includes('lehsun')) fallbackEmoji = '🧄';
  else if (n.includes('ginger') || n.includes('adrak')) fallbackEmoji = '𫚚';
  else if (n.includes('green chilli') || n.includes('green chili') || n.includes('hari mirch')) fallbackEmoji = '🌶️';
  else if (n.includes('chilli') || n.includes('chili') || n.includes('mirch')) fallbackEmoji = '🌶️';
  else if (n.includes('iceberg')) fallbackEmoji = '🥬';
  else if (n.includes('lemon') || n.includes('limo') || n.includes('nimbu')) fallbackEmoji = '🍋';
  else if (n.includes('lettuce')) fallbackEmoji = '🥬';
  else if (n.includes('mint') || n.includes('pudina')) fallbackEmoji = '🌿';
  else if (n.includes('mushroom')) fallbackEmoji = '🍄';
  else if (n.includes('onion') || n.includes('piaz') || n.includes('pyaz')) fallbackEmoji = '🧅';
  else if (n.includes('peas') || n.includes('matar')) fallbackEmoji = '🫛';
  else if (n.includes('potato') || n.includes('aloo')) fallbackEmoji = '🥔';
  else if (n.includes('pumpkin') || n.includes('kaddu')) fallbackEmoji = '🎃';
  else if (n.includes('spinach') || n.includes('palak')) fallbackEmoji = '🥬';
  else if (n.includes('sweet potato') || n.includes('shakarkandi')) fallbackEmoji = '🍠';
  else if (n.includes('tomato') || n.includes('tamatar')) fallbackEmoji = '🍅';
  else if (n.includes('apple') || n.includes('seeb')) fallbackEmoji = '🍎';
  else if (n.includes('banana') || n.includes('kela')) fallbackEmoji = '🍌';
  else if (n.includes('grapes') || n.includes('angoor')) fallbackEmoji = '🍇';
  else if (n.includes('mango') || n.includes('aam')) fallbackEmoji = '🥭';
  else if (n.includes('melon') || n.includes('kharbooza')) fallbackEmoji = '🍈';
  else if (n.includes('orange') || n.includes('malta') || n.includes('kinnow')) fallbackEmoji = '🍊';
  else if (n.includes('peach') || n.includes('aaroo')) fallbackEmoji = '🍑';
  else if (n.includes('pear') || n.includes('nashpati')) fallbackEmoji = '🍐';
  else if (n.includes('watermelon') || n.includes('tarbooz')) fallbackEmoji = '🍉';

  return `<span style="font-size:22px;margin-left:6px;vertical-align:middle;font-family:'Apple Color Emoji','Segoe UI Emoji','Segoe UI Symbol',sans-serif;">${fallbackEmoji}</span>`;
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
  });
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const prevBal = inv.previousBalance > 0 ? inv.previousBalance : 0;
  const grandTotal = prevBal + inv.total;
  const remaining = grandTotal - inv.paid;
  const statusClass = inv.status === 'PAID' ? 'PAID' : inv.status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID';

  const clientPhone = inv.clientPhone ?? '';
  const clientWA = inv.clientWhatsapp && inv.clientWhatsapp !== inv.clientPhone ? inv.clientWhatsapp : '';

  const header = buildHeader(
    brand,
    'INVOICE',
    `${today} · ${time}`,
    `#${inv.invoiceNo}`,
    origin,
    'انوائس'
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">کلائنٹ <span class="doc-info-sub-eng">(Billed To)</span></div>
        <div class="doc-info-value large">${inv.clientName} <span style="font-size:11px;font-weight:500;color:#7A8C79;">(${inv.clientId || '—'})</span></div>
        ${inv.clientType ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${inv.clientType}</div>` : ''}
        ${clientPhone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${clientPhone}</div>` : ''}
        ${clientWA ? `<div class="doc-info-value" style="font-size:11px;color:#2D6A4F;">💬 WA: ${clientWA}</div>` : ''}
        ${inv.deliveryLocation || inv.clientAddress ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${inv.deliveryLocation || inv.clientAddress}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">ترسیل <span class="doc-info-sub-eng">(Delivery)</span></div>
        ${inv.employeeName ? `<div class="doc-info-value">👷 ${inv.employeeName} (03061110041)</div>` : '<div class="doc-info-value" style="color:#aaa;">—</div>'}
        ${inv.deliveryDate ? `<div class="doc-info-value" style="font-size:12px;">📅 ${new Date(inv.deliveryDate).toLocaleDateString('en-GB')}${inv.deliveryTime ? ` · ${inv.deliveryTime}` : ''}</div>` : ''}
        <div class="doc-info-label-urdu" style="margin-top:8px;">ادائیگی طریقہ <span class="doc-info-sub-eng">(Payment Mode)</span></div>
        <div class="doc-info-value">${inv.paymentMode}</div>
      </div>
    </div>
  `;

  // Split items into two halves for the 2-column layout
  const half = Math.ceil(inv.items.length / 2);
  const col1Items = inv.items.slice(0, half);
  const col2Items = inv.items.slice(half);

  const buildColRows = (items: InvoiceItem[], startIndex: number) => items.map((item, i) => `
    <tr>
      <td class="center muted" style="font-size:10px;padding:4px 6px;">${startIndex + i + 1}</td>
      <td style="font-size:10px;padding:4px 6px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <div style="flex:1;min-width:0;">
            <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif;font-size:16px;font-weight:700;color:#000000;direction:rtl;line-height:1.4;">${item.urduName || item.itemName}</div>
            <div style="font-size:10.5px;color:#555555;">${item.itemName}</div>
          </div>
          ${getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl, origin)}
        </div>
      </td>
      <td class="center mono" style="font-size:10px;padding:4px 6px;">
        ${item.qty} ${item.unit}
        ${item.returnedQty && item.returnedQty > 0 ? `<div style="font-size:8.5px;color:#C2410C;font-weight:700;">↩ ${item.returnedQty} Ret</div>` : ''}
      </td>
      <td class="right mono" style="font-size:10px;padding:4px 6px;">${item.rate.toLocaleString()}</td>
      <td class="right mono" style="font-size:10px;padding:4px 6px;font-weight:600;">${item.amount.toLocaleString()}</td>
    </tr>
  `).join('');

  const colHeader = `
    <thead>
      <tr>
        <th class="center" style="font-size:9px;padding:5px 6px;">#</th>
        <th style="font-size:9.5px;padding:5px 6px;">پروڈکٹ / آئٹم <span style="font-size:9px;font-weight:500;">(Item)</span></th>
        <th class="center" style="font-size:9.5px;padding:5px 6px;">تعداد <span style="font-size:9px;font-weight:500;">(Qty)</span></th>
        <th class="right" style="font-size:9.5px;padding:5px 6px;">ریٹ <span style="font-size:9px;font-weight:500;">(Rate)</span></th>
        <th class="right" style="font-size:9.5px;padding:5px 6px;">رقم <span style="font-size:9px;font-weight:500;">(Amount)</span></th>
      </tr>
    </thead>
  `;

  // Use 2-column layout when there are more than 15 items, otherwise single column
  const itemsTable = inv.items.length > 15 ? `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-top:10px;">
      <div style="flex:1;min-width:0;">
        <table class="doc-table" style="width:100%;font-size:10px;">
          ${colHeader}
          <tbody>${buildColRows(col1Items, 0)}</tbody>
        </table>
      </div>
      <div style="flex:1;min-width:0;">
        <table class="doc-table" style="width:100%;font-size:10px;">
          ${colHeader}
          <tbody>${buildColRows(col2Items, half)}</tbody>
        </table>
      </div>
    </div>
  ` : `
    <table class="doc-table">
      <thead>
        <tr>
          <th class="center">#</th>
          <th>پروڈکٹ / آئٹم <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Item)</span></th>
          <th class="center">تعداد <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Qty)</span></th>
          <th>پیمائش <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Unit)</span></th>
          <th class="right">ریٹ <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Rate Rs)</span></th>
          <th class="right">کل رقم <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Amount Rs)</span></th>
        </tr>
      </thead>
      <tbody>
        ${inv.items.map((item, i) => `
          <tr>
            <td class="center muted">${i + 1}</td>
            <td>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div style="flex:1;min-width:0;">
                  <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu',sans-serif;font-size:17px;font-weight:700;color:#000000;direction:rtl;line-height:1.4;">${item.urduName || item.itemName}</div>
                  <div style="font-size:11px;color:#555555;font-weight:500;">${item.itemName}</div>
                </div>
                ${getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl, origin)}
              </div>
            </td>
            <td class="center mono">
              ${item.qty}
              ${item.returnedQty && item.returnedQty > 0 ? `<div style="font-size:9.5px;color:#C2410C;font-weight:700;margin-top:2px;">↩ ${item.returnedQty} ${item.unit} Ret</div>` : ''}
            </td>
            <td class="muted">${item.unit}</td>
            <td class="right mono">${item.rate.toLocaleString()}</td>
            <td class="right mono">${item.amount.toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const prevBalRow = `
    <div class="doc-summary-row prev">
      <span class="label">
        <span class="urdu-main" style="color:#991B1B;">سابقہ بقایا جات</span>
        <span class="eng-sub">Previous Outstanding</span>
      </span>
      <span class="val">Rs ${prevBal.toLocaleString()}</span>
    </div>
  `;

  const totalReturnCredit = inv.items.reduce((s, i) => s + (Number(i.returnedQty || 0) * Number(i.rate || 0)), 0);
  const grossInvoiceTotal = inv.items.reduce((s, i) => s + (Number(i.qty || 0) * Number(i.rate || 0)), 0);

  const returnBreakdownRows = totalReturnCredit > 0 ? `
    <div class="doc-summary-row" style="color:#64748B;">
      <span class="label">
        <span class="urdu-main" style="color:#64748B;">اصل آرڈر رقم</span>
        <span class="eng-sub">Gross Order Amount</span>
      </span>
      <span class="val">Rs ${grossInvoiceTotal.toLocaleString()}</span>
    </div>
    <div class="doc-summary-row" style="color:#C2410C;">
      <span class="label">
        <span class="urdu-main" style="color:#C2410C;">واپسی کٹوتی (کریڈٹ)</span>
        <span class="eng-sub">Sales Return Credit</span>
      </span>
      <span class="val" style="color:#C2410C;font-weight:700;">- Rs ${totalReturnCredit.toLocaleString()}</span>
    </div>
  ` : '';

  const summary = `
    <div class="doc-summary-wrap">
      <div class="doc-summary-box">
        ${prevBalRow}
        ${returnBreakdownRows}
        <div class="doc-summary-row">
          <span class="label">
            <span class="urdu-main">موجودہ بل</span>
            <span class="eng-sub">Current Bill</span>
          </span>
          <span class="val">Rs ${inv.total.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row total-row">
          <span class="label">
            <span class="urdu-main" style="color:#0284C7;">کل قابل ادائیگی (کل واجب الادا)</span>
            <span class="eng-sub">Total Payable Amount</span>
          </span>
          <span class="val">Rs ${grandTotal.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            <span class="urdu-main" style="color:#166534;">وصول شدہ رقم (کل ادائیگی)</span>
            <span class="eng-sub">Amount Paid Today</span>
          </span>
          <span class="val" style="color:#166534;">- Rs ${inv.paid.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row grand-row ${remaining <= 0 ? 'paid-row' : ''}">
          <span class="label">
            <span class="urdu-main" style="color:#FFFFFF !important; font-size:19px; font-weight:800;">بقیہ واجب الادا (بقایا رقم)</span>
            <span class="eng-sub" style="color:rgba(255,255,255,0.85); font-size:11px;">Remaining Balance</span>
          </span>
          <span class="val" style="color:#FFFFFF; font-size:20px; font-weight:900;">Rs ${Math.max(0, remaining).toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;

  const notesBlock = inv.notes ? `<div class="doc-notes"><strong>Note:</strong> ${inv.notes}</div>` : '';

  const statusBadge = `
    <div class="doc-status-wrap">
      <span class="doc-status-badge ${statusClass}">
        Payment Status: ${inv.status}
      </span>
    </div>
  `;

  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${infoGrid}
    ${itemsTable}
    ${summary}
    ${notesBlock}
    ${statusBadge}
    ${footer}
  `;

  return buildDocShell(brand, `Invoice #${inv.invoiceNo}`, body);
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
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });
  const isCredit = stmt.currentBalance <= 0;

  const header = buildHeader(
    brand,
    'DUE STATEMENT',
    `As of ${today}`,
    `Client: ${stmt.clientId || '—'}`,
    origin,
    'واجب الادا تفصیل'
  );

  const whatsappLine = stmt.whatsapp && stmt.whatsapp !== stmt.phone ? ` · WA: ${stmt.whatsapp}` : '';
  const addrLine = [stmt.address, stmt.deliveryLocation ? `Delivery: ${stmt.deliveryLocation}` : ''].filter(Boolean).join(' · ');

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">کلائنٹ <span class="doc-info-sub-eng">(Client)</span></div>
        <div class="doc-info-value large">${stmt.clientName}</div>
        ${stmt.ownerName ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">Owner: ${stmt.ownerName}</div>` : ''}
        ${stmt.phone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${stmt.phone}${whatsappLine}</div>` : ''}
        ${addrLine ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${addrLine}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">تاریخ <span class="doc-info-sub-eng">(Statement Date)</span></div>
        <div class="doc-info-value large">${today}</div>
      </div>
    </div>
  `;

  const kpiGrid = `
    <div class="doc-kpi-grid">
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu">کل فروخت</span>
        <span class="doc-kpi-label-eng">Total Sales</span>
        <div class="doc-kpi-value">Rs ${stmt.totalSales.toLocaleString()}</div>
      </div>
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu" style="color:#166534;">کل ادائیگی</span>
        <span class="doc-kpi-label-eng">Total Paid</span>
        <div class="doc-kpi-value ok">Rs ${stmt.totalCollected.toLocaleString()}</div>
      </div>
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu" style="color:#991B1B;">کل واجب الادا</span>
        <span class="doc-kpi-label-eng">Balance Due</span>
        <div class="doc-kpi-value ${isCredit ? 'ok' : 'danger'}">
          Rs ${Math.abs(stmt.currentBalance).toLocaleString()}${isCredit ? ' (Credit)' : ''}
        </div>
      </div>
    </div>
  `;

  const ledgerRows = [...stmt.ledger].reverse().map(e => {
    const dateStr = new Date(e.date).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi',
    });
    const balClass = e.runningBalance > 0 ? 'balance-pos' : 'balance-neg';
    return `
      <tr>
        <td>${dateStr}</td>
        <td>${e.description}</td>
        <td class="debit right">${e.debit > 0 ? 'Rs ' + e.debit.toLocaleString() : '—'}</td>
        <td class="credit right">${e.credit > 0 ? 'Rs ' + e.credit.toLocaleString() : '—'}</td>
        <td class="${balClass} right">Rs ${e.runningBalance.toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  const ledgerTable = `
    <table class="doc-table">
      <thead>
        <tr>
          <th>تاریخ <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Date)</span></th>
          <th>تفصیل <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Description)</span></th>
          <th class="right">بل / واجب <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Debit Rs)</span></th>
          <th class="right">وصولی / ادا <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Credit Rs)</span></th>
          <th class="right">بقایا جات <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Balance Rs)</span></th>
        </tr>
      </thead>
      <tbody>
        ${ledgerRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">No transactions found</td></tr>'}
      </tbody>
    </table>
  `;

  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${infoGrid}
    ${kpiGrid}
    ${ledgerTable}
    ${footer}
  `;

  return buildDocShell(brand, `Due Statement — ${stmt.clientName}`, body);
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
      const htmlVisual = getProductHtmlVisual(item.itemName, item.emoji, item.imageUrl);
      const bg = i % 2 === 0 ? '#072E1D' : '#0A3723';
      return `
        <tr style="background:${bg};border-bottom:1px solid #14492E;">
          <td style="padding:7px 10px;vertical-align:middle;text-align:left;white-space:nowrap;font-family:'IBM Plex Mono',monospace;font-size:16px;font-weight:800;color:#FACC15;">Rs ${item.sellRate.toLocaleString()}</td>
          <td style="padding:7px 10px;vertical-align:middle;text-align:center;text-transform:uppercase;font-size:12px;color:#FFFFFF;font-weight:700;">${item.unit}</td>
          <td style="padding:7px 10px;vertical-align:middle;">
            <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px;">
              <div style="display:flex;flex-direction:column;align-items:flex-start;">
                <span style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic',sans-serif;font-size:26px;font-weight:800;color:#FFFFFF;direction:rtl;line-height:1.2;">${item.urduName || item.itemName}</span>
                <span style="font-size:11px;color:#A3C9B3;font-weight:500;font-family:'Inter',sans-serif;margin-top:1px;">${item.itemName}</span>
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
        <th style="font-size:11px;padding:9px 10px;text-align:right;font-weight:800;color:#FACC15;letter-spacing:0.08em;">پروڈکٹ / PRODUCT</th>
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
    : (brand.logoUrl && brand.logoUrl !== '/logo-transparent.png' ? `${origin}${brand.logoUrl}` : PRICELIST_LOGO_BASE64);

  const bodyContent = `
    <div style="max-width:780px;margin:0 auto;background:linear-gradient(180deg, #062315 0%, #082E1C 100%);border:4px double #E5A93C;border-radius:12px;padding:24px 28px 28px;color:#FFFFFF;box-sizing:border-box;">
      
      <!-- Header Bar -->
      <div style="border-bottom:2px solid #E5A93C;padding-bottom:16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:16px;">
        <div style="background:#FFFFFF;padding:6px 14px;border-radius:10px;border:1.5px solid #E5A93C;box-shadow:0 4px 14px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
          <img src="${logoSrc}" alt="${brand.companyName || 'HALAL VEGG SUPPLIES'}" style="height:54px;width:auto;object-fit:contain;" />
        </div>

        <div style="text-align:right;">
          <div style="font-family:'Jameel Khushkhat L','Noto Nastaliq Urdu','Noto Sans Arabic',sans-serif;font-size:28px;font-weight:800;color:#FACC15;direction:rtl;line-height:1.2;">آج کی ریٹ لسٹ</div>
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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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

  return buildDocShell(brand, `Purchase Voucher #${pur.voucherNo}`, body);
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
  phone?: string | null;
  whatsapp?: string | null;
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
  });
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });

  const header = buildHeader(
    brand,
    'OUTSTANDING DUE STATEMENT',
    `${today} · ${time}`,
    `Client: ${data.clientId || '—'}`,
    origin,
    'واجب الادا تفصیل'
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">کلائنٹ <span class="doc-info-sub-eng">(Client)</span></div>
        <div class="doc-info-value large">${data.clientName}</div>
        ${data.phone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${data.phone}</div>` : ''}
        ${data.whatsapp && data.whatsapp !== data.phone ? `<div class="doc-info-value" style="font-size:11px;color:#2D6A4F;">💬 WA: ${data.whatsapp}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label-urdu">تاریخ <span class="doc-info-sub-eng">(Statement Date)</span></div>
        <div class="doc-info-value large">${today}</div>
      </div>
    </div>
  `;

  const kpiGrid = `
    <div class="doc-kpi-grid">
      <div class="doc-kpi-box">
        <span class="doc-kpi-urdu" style="color:#991B1B;">کل واجب الادا (کل بقایا جات)</span>
        <span class="doc-kpi-label-eng">Total Outstanding Balance</span>
        <div class="doc-kpi-value danger" style="font-size:22px;">Rs ${data.totalOutstanding.toLocaleString()}</div>
      </div>
    </div>
  `;

  const itemRows = data.invoices.map((inv, i) => `
    <tr>
      <td class="center muted">${i + 1}</td>
      <td class="mono font-bold" style="color:${brand.primaryColor};">${inv.invoiceNo}</td>
      <td>${new Date(inv.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td class="right mono">${inv.total.toLocaleString()}</td>
      <td class="right mono" style="color:#2D6A4F;">${inv.paid.toLocaleString()}</td>
      <td class="right mono" style="color:#B5533C;font-weight:700;">${inv.balance.toLocaleString()}</td>
    </tr>
  `).join('');

  const table = `
    <table class="doc-table">
      <thead>
        <tr>
          <th class="center">#</th>
          <th>انواﺋس نمبر <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Invoice No)</span></th>
          <th>تاریخ <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Date)</span></th>
          <th class="right">کل رقم <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Total Rs)</span></th>
          <th class="right">وصولی / ادائیگی <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Paid Rs)</span></th>
          <th class="right">بقیہ واجب الادا <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Remaining Due)</span></th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px;">No outstanding invoices</td></tr>'}
      </tbody>
    </table>
  `;

  const openBalRow = data.openingBalance && data.openingBalance > 0 ? `
    <div class="doc-summary-row prev">
      <span class="label">
        <span class="urdu-main" style="color:#991B1B;">سابقی بقایا</span>
        <span class="eng-sub">Opening Balance</span>
      </span>
      <span class="val">Rs ${data.openingBalance.toLocaleString()}</span>
    </div>
  ` : '';

  const summary = `
    <div class="doc-summary-wrap">
      <div class="doc-summary-box">
        ${openBalRow}
        <div class="doc-summary-row">
          <span class="label">
            <span class="urdu-main">کل بل (موجودہ)</span>
            <span class="eng-sub">Total Billed</span>
          </span>
          <span class="val">Rs ${data.totalBilled.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            <span class="urdu-main" style="color:#166534;">کل ادا شدہ (وصولی)</span>
            <span class="eng-sub">Total Paid</span>
          </span>
          <span class="val" style="color:#166534;">- Rs ${data.totalPaid.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row grand-row">
          <span class="label">
            <span class="urdu-main" style="color:#FFFFFF !important; font-size:19px; font-weight:800;">بقیہ واجب الادا (کل بقایا جات)</span>
            <span class="eng-sub" style="color:rgba(255,255,255,0.85); font-size:11px;">Remaining Outstanding</span>
          </span>
          <span class="val" style="color:#FFFFFF; font-size:20px; font-weight:900;">Rs ${data.totalOutstanding.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;

  const notesBlock = '';
  const statusBadge = '';
  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${infoGrid}
    ${kpiGrid}
    ${table}
    ${summary}
    ${notesBlock}
    ${statusBadge}
    ${footer}
  `;

  return buildDocShell(brand, `Outstanding Due Statement — ${data.clientName}`, body);
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
              <th>انواﺋس نمبر <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Invoice #)</span></th>
              <th class="num">وصول شدہ رقم <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Allocated Rs)</span></th>
              <th class="num">بقیہ انواﺋس واجب <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Remaining Due)</span></th>
              <th style="text-align:center;">حالت <span style="font-size:9.5px;font-weight:500;color:rgba(255,255,255,0.85);">(Status)</span></th>
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
            <span class="urdu-main" style="color:#0284C7;">کل قابل ادائیگی (کل واجب الادا)</span>
            <span class="eng-sub">Total Payable</span>
          </span>
          <span class="val">Rs ${fmtMoney(data.totalPayable)}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            <span class="urdu-main" style="color:#166534;">وصول شدہ رقم (آج کی وصولی)</span>
            <span class="eng-sub">Amount Received Today</span>
          </span>
          <span class="val" style="color:#166534;">- Rs ${fmtMoney(data.amountReceived)}</span>
        </div>
        <div class="doc-summary-row grand-row">
          <span class="label">
            <span class="urdu-main" style="color:#FFFFFF !important; font-size:19px; font-weight:800;">${excessAmt > 0 ? 'ایڈوانس کریڈٹ' : 'بقیہ واجب الادا (بقایا رقم)'}</span>
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

  return buildDocShell(brand, `Payment Receipt — ${data.clientName}`, body);
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
    <table style="width:100%; border-collapse:collapse; margin-top:10px; font-family:system-ui, sans-serif;">
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

  return buildDocShell(brand, `Daily Payment History — ${data.businessDate}`, body);
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
        body { font-family: system-ui, sans-serif; display: flex; align-items: center;
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
        body { font-family: system-ui, sans-serif; display: flex; align-items: center;
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
      font-family:system-ui,sans-serif;font-size:12px;font-weight:600;
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
/**
 * Generates a True Full HD (2000px+ width) JPG image from an invoice/document HTML string.
 * Uses a single-step, high-speed backend JPEG renderer with fallback to html2canvas.
 */
export async function generateTemplateJpgBase64(html: string): Promise<string> {
  if (!html || typeof window === 'undefined') return '';

  const TARGET_WIDTH = 794;

  // ── Step 1: Direct High-Speed Backend JPEG Screenshot ─────────────────────
  try {
    const res = await fetch('/api/render/jpeg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, width: TARGET_WIDTH, quality: 88 }),
      signal: AbortSignal.timeout(15000),
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
  } catch (err) {
    console.warn('Direct JPEG render fallback:', err);
  }

  // ── Step 2: Direct PNG Fallback ───────────────────────────────────────────
  try {
    const pngRes = await fetch('/api/render/png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, width: TARGET_WIDTH }),
      signal: AbortSignal.timeout(15000),
    });

    if (pngRes.ok) {
      const blob = await pngRes.blob();
      const pngBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string) || '');
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      if (pngBase64) return await convertDataUrlToHighResJpg(pngBase64, 0.95);
    }
  } catch (pngErr) {
    console.warn('Direct PNG fallback:', pngErr);
  }

  // ── Step 3: High-Definition Client-Side html2canvas Fallback ──────────────
  const pngBase64 = await generateTemplateImageBase64(html);
  if (!pngBase64) return '';
  return await convertDataUrlToHighResJpg(pngBase64, 0.95);
}

/**
 * Generates a high-quality Full HD image from an invoice/document HTML string using html2canvas.
 */
export async function generateTemplateImageBase64(html: string): Promise<string> {
  if (typeof window === 'undefined') return '';

  const TARGET_WIDTH = 794; // A4 standard width (renders at 3.5x scale = 2779px Full HD edge-to-edge)

  // ── Step 1: PDF → pdfjs-dist → canvas ──────────────────────────────────────
  try {
    const pdfRes = await fetch('/api/render/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, width: TARGET_WIDTH }),
      signal: AbortSignal.timeout(30000),
    });

    if (pdfRes.ok) {
      const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      const pdfDoc = await pdfjs.getDocument({ data: pdfBytes }).promise;
      const page = await pdfDoc.getPage(1);

      // 3.5x Retina scale (2779px width)
      const SCALE = 3.5;
      const viewport = page.getViewport({ scale: SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        return canvas.toDataURL('image/png');
      }
    }
  } catch (pdfErr) {
    console.warn('PDF→pdfjs pipeline fallback:', pdfErr);
  }

  // ── Step 2: Direct PNG screenshot from backend Puppeteer ───────────────────
  try {
    const pngRes = await fetch('/api/render/png', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, width: TARGET_WIDTH }),
      signal: AbortSignal.timeout(30000),
    });

    if (pngRes.ok) {
      const blob = await pngRes.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  } catch (pngErr) {
    console.warn('Direct PNG screenshot fallback:', pngErr);
  }

  // ── Step 3: High-Definition Client-Side html2canvas Fallback ─────────────────────
  // Create offscreen container fixed at 794px width with zero extra side margins
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
      await (document as any).fonts.ready;
    }

    // Wait for all images inside template to decode
    const imgs = Array.from(container.querySelectorAll('img'));
    await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; }))));

    // Wait 400ms for typography shaping & glyph rendering
    await new Promise((r) => setTimeout(r, 400));

    const contentHeight = container.scrollHeight || 1123;

    const html2canvasModule = await import('html2canvas');
    const html2canvas = html2canvasModule.default || html2canvasModule;

    const cvs = await html2canvas(container, {
      scale: 3.5, // Force 3.5x DPI (2779px width Full HD edge-to-edge)
      width: 794,
      height: contentHeight,
      windowWidth: 850, // Match 794px content width to avoid excessive side margins
      windowHeight: 1400,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000,
      onclone: (clonedDoc) => {
        const clonedElem = clonedDoc.getElementById('hd-export-container');
        if (clonedElem) {
          clonedElem.style.width = '794px';
          clonedElem.style.minWidth = '794px';
          clonedElem.style.maxWidth = '794px';
          clonedElem.style.padding = '0px';
          clonedElem.style.margin = '0px';
          clonedElem.style.transform = 'none';
        }
      },
    });

    return cvs.toDataURL('image/png');
  } catch (canvasErr) {
    console.error('html2canvas HD export failed:', canvasErr);
    return '';
  } finally {
    container.parentNode?.removeChild(container);
  }
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
