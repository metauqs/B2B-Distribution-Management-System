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

import html2canvas from 'html2canvas';
import { DEFAULT_LOGO_BASE64 } from './logoBase64';

// ─── Brand Configuration ───────────────────────────────────────────────────────

export interface BrandConfig {
  companyName: string;    // "HALAL VEGG SUPPLIES"
  tagline: string;        // "Fresh Produce Supply Management"
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
  tagline:       'Fresh Produce Supply Management',
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
      font-size: 10px;
      color: #6B7C6A;
      margin-top: 2px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
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
    .doc-kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .doc-kpi-box {
      background: ${b.lightBg};
      border: 1px solid ${b.lineColor};
      border-radius: 8px;
      padding: 12px 14px;
      text-align: center;
    }
    .doc-kpi-label {
      font-size: 9px;
      font-weight: 700;
      color: #7A8C79;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      line-height: 1.4;
    }
    .doc-kpi-urdu {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 15px;
      color: #000000;
      direction: rtl;
      unicode-bidi: isolate;
      display: block;
      margin-top: 2px;
      margin-bottom: 2px;
      line-height: 1.3;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .urdu-inline {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 13px;
      color: #FFFFFF;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.3;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .urdu-inline-dark {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      color: #000000;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.3;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .urdu-inline-val {
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      color: #000000;
      margin-left: 4px;
      direction: rtl;
      unicode-bidi: isolate;
      vertical-align: middle;
      display: inline-block;
      line-height: 1.3;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .doc-kpi-value {
      font-family: 'IBM Plex Mono', monospace;
      font-size: 17px;
      font-weight: 700;
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
      font-size: 15px;
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
      width: 300px;
      border: 1px solid ${b.lineColor};
      border-radius: 8px;
      overflow: hidden;
    }
    .doc-summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 14px;
      border-bottom: 1px solid ${b.lineColor};
      font-size: 12.5px;
    }
    .doc-summary-row:last-child { border-bottom: none; }
    .doc-summary-row .label { color: #4A5C49; }
    .doc-summary-row .label .urdu-sub {
      display: block;
      font-family: 'Jameel Khushkhat L', 'Noto Nastaliq Urdu', 'Noto Sans Arabic', 'Urdu Typesetting', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      color: #000000;
      direction: rtl;
      unicode-bidi: isolate;
      margin-top: 2px;
      line-height: 1.3;
      letter-spacing: normal !important;
      text-transform: none !important;
      font-weight: 700;
    }
    .doc-summary-row .val {
      font-family: 'IBM Plex Mono', monospace;
      font-weight: 700;
      font-size: 13px;
      color: ${b.primaryColor};
    }
    .doc-summary-row.prev .val  { color: #B5533C; }
    .doc-summary-row.credit-row .val { color: #2D6A4F; }
    .doc-summary-row.total-row {
      background: ${b.lightBg};
      font-weight: 700;
    }
    .doc-summary-row.grand-row {
      background: ${b.primaryColor};
      color: #FFFFFF;
      font-weight: 700;
      font-size: 14px;
    }
    .doc-summary-row.grand-row .label,
    .doc-summary-row.grand-row .label .urdu-sub { color: rgba(255,255,255,0.85); }
    .doc-summary-row.grand-row .val { color: #FFFFFF; font-size: 15px; }
    .doc-summary-row.paid-row { background: #F0FAF2; }
    .doc-summary-row.paid-row .val { color: #2D6A4F; }

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
  origin: string
): string {
  const logoSrc = (b.logoUrl && (b.logoUrl.startsWith('data:') || b.logoUrl.startsWith('http')))
    ? b.logoUrl
    : (b.logoUrl && b.logoUrl !== '/logo-transparent.png' ? `${origin}${b.logoUrl}` : DEFAULT_LOGO_BASE64);

  return `
    <div class="doc-header">
      <div class="doc-header-brand">
        <img class="doc-header-logo" src="${logoSrc}" alt="${b.companyName}">
        <div>
          <div class="doc-header-tagline">${b.tagline}</div>
        </div>
      </div>
      <div class="doc-header-meta">
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

// ─── Invoice Types ────────────────────────────────────────────────────────────

export interface InvoiceItem {
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  urduName?: string | null;
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
    origin
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label">Billed To <span class="urdu-inline-dark">(کلائنٹ)</span></div>
        <div class="doc-info-value large">${inv.clientName} <span style="font-size:11px;font-weight:500;color:#7A8C79;">(${inv.clientId || '—'})</span></div>
        ${inv.clientType ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${inv.clientType}</div>` : ''}
        ${clientPhone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${clientPhone}</div>` : ''}
        ${clientWA ? `<div class="doc-info-value" style="font-size:11px;color:#2D6A4F;">💬 WA: ${clientWA}</div>` : ''}
        ${inv.deliveryLocation || inv.clientAddress ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${inv.deliveryLocation || inv.clientAddress}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label">Delivery <span class="urdu-inline-dark">(ترسیل)</span></div>
        ${inv.employeeName ? `<div class="doc-info-value">👷 ${inv.employeeName} (03061110041)</div>` : '<div class="doc-info-value" style="color:#aaa;">—</div>'}
        ${inv.deliveryDate ? `<div class="doc-info-value" style="font-size:12px;">📅 ${new Date(inv.deliveryDate).toLocaleDateString('en-GB')}${inv.deliveryTime ? ` · ${inv.deliveryTime}` : ''}</div>` : ''}
        <div class="doc-info-label" style="margin-top:8px;">Payment Mode <span class="urdu-inline-dark">(ادائیگی)</span></div>
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
        <strong>${item.itemName}</strong>
        ${item.urduName ? `<span class="urdu-inline-val" style="font-size:9px;">(${item.urduName})</span>` : ''}
      </td>
      <td class="center mono" style="font-size:10px;padding:4px 6px;">${item.qty} ${item.unit}</td>
      <td class="right mono" style="font-size:10px;padding:4px 6px;">${item.rate.toLocaleString()}</td>
      <td class="right mono" style="font-size:10px;padding:4px 6px;font-weight:600;">${item.amount.toLocaleString()}</td>
    </tr>
  `).join('');

  const colHeader = `
    <thead>
      <tr>
        <th class="center" style="font-size:9px;padding:5px 6px;">#</th>
        <th style="font-size:9px;padding:5px 6px;">Item <span class="urdu-inline">(آئٹم)</span></th>
        <th class="center" style="font-size:9px;padding:5px 6px;">Qty</th>
        <th class="right" style="font-size:9px;padding:5px 6px;">Rate</th>
        <th class="right" style="font-size:9px;padding:5px 6px;">Amount</th>
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
          <th>Item <span class="urdu-inline">(آئٹم)</span></th>
          <th class="center">Qty</th>
          <th>Unit</th>
          <th class="right">Rate (Rs)</th>
          <th class="right">Amount (Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${inv.items.map((item, i) => `
          <tr>
            <td class="center muted">${i + 1}</td>
            <td>
              <strong>${item.itemName}</strong>
              ${item.urduName ? `<span class="urdu-inline-val">(${item.urduName})</span>` : ''}
            </td>
            <td class="center mono">${item.qty}</td>
            <td class="muted">${item.unit}</td>
            <td class="right mono">${item.rate.toLocaleString()}</td>
            <td class="right mono">${item.amount.toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const prevBalRow = prevBal > 0 ? `
    <div class="doc-summary-row prev">
      <span class="label">
        Previous Outstanding
        <span class="urdu-sub">بقایا</span>
      </span>
      <span class="val">Rs ${prevBal.toLocaleString()}</span>
    </div>
  ` : '';

  const summary = `
    <div class="doc-summary-wrap">
      <div class="doc-summary-box">
        ${prevBalRow}
        <div class="doc-summary-row">
          <span class="label">
            Current Bill
            <span class="urdu-sub">آج کا بل</span>
          </span>
          <span class="val">Rs ${inv.total.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row total-row">
          <span class="label">
            Total Payable Amount
            <span class="urdu-sub">کل واجب الادا</span>
          </span>
          <span class="val">Rs ${grandTotal.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">
            Amount Paid
            <span class="urdu-sub">کل ادائیگی</span>
          </span>
          <span class="val" style="color:#2D6A4F;">- Rs ${inv.paid.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row grand-row ${remaining <= 0 ? 'paid-row' : ''}">
          <span class="label">
            Remaining Balance
            <span class="urdu-sub">بقیہ رقم</span>
          </span>
          <span class="val">Rs ${Math.max(0, remaining).toLocaleString()}</span>
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
    origin
  );

  const whatsappLine = stmt.whatsapp && stmt.whatsapp !== stmt.phone ? ` · WA: ${stmt.whatsapp}` : '';
  const addrLine = [stmt.address, stmt.deliveryLocation ? `Delivery: ${stmt.deliveryLocation}` : ''].filter(Boolean).join(' · ');

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label">Client <span class="urdu-inline-dark">(کلائنٹ)</span></div>
        <div class="doc-info-value large">${stmt.clientName}</div>
        ${stmt.ownerName ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">Owner: ${stmt.ownerName}</div>` : ''}
        ${stmt.phone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${stmt.phone}${whatsappLine}</div>` : ''}
        ${addrLine ? `<div class="doc-info-value" style="font-size:11px;color:#7A8C79;">${addrLine}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label">Statement Date</div>
        <div class="doc-info-value large">${today}</div>
      </div>
    </div>
  `;

  const kpiGrid = `
    <div class="doc-kpi-grid">
      <div class="doc-kpi-box">
        <div class="doc-kpi-label">
          Total Sales
          <span class="doc-kpi-urdu">کل فروخت</span>
        </div>
        <div class="doc-kpi-value">Rs ${stmt.totalSales.toLocaleString()}</div>
      </div>
      <div class="doc-kpi-box">
        <div class="doc-kpi-label">
          Total Paid
          <span class="doc-kpi-urdu">کل ادائیگی</span>
        </div>
        <div class="doc-kpi-value ok">Rs ${stmt.totalCollected.toLocaleString()}</div>
      </div>
      <div class="doc-kpi-box">
        <div class="doc-kpi-label">
          Balance Due
          <span class="doc-kpi-urdu">کل واجب الادا</span>
        </div>
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
          <th>Date</th>
          <th>Description</th>
          <th class="right">Debit (Rs)</th>
          <th class="right">Credit (Rs)</th>
          <th class="right">Balance (Rs)</th>
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
}

export interface PriceListData {
  dateStr: string;
  items: PriceListItem[];
  notes?: string | null;
}

// ─── Price List HTML Generator ────────────────────────────────────────────────

export function generatePriceListHTML(data: PriceListData, brand: BrandConfig, origin = ''): string {
  const printedOn = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' });

  const header = buildHeader(
    brand,
    'DAILY PRICE LIST',
    `Date: ${data.dateStr}`,
    '',
    origin
  );

  // Split items into two halves for 2-column layout
  const half = Math.ceil(data.items.length / 2);
  const col1 = data.items.slice(0, half);
  const col2 = data.items.slice(half);

  const getProductEmoji = (name: string): string => {
    const n = (name || '').toLowerCase();
    if (n.includes('tomato')) return '🍅';
    if (n.includes('potato') || n.includes('aloo')) return '🥔';
    if (n.includes('onion') || n.includes('piaz')) return '🧅';
    if (n.includes('garlic') || n.includes('lehsun')) return '🧄';
    if (n.includes('ginger') || n.includes('adrak')) return '🫚';
    if (n.includes('chilli') || n.includes('mirch')) return '🌶️';
    if (n.includes('coriander') || n.includes('dhaniya') || n.includes('pudina') || n.includes('mint')) return '🌿';
    if (n.includes('cabbage') || n.includes('gobhi')) return '🥬';
    if (n.includes('cauliflower')) return '🥦';
    if (n.includes('carrot') || n.includes('gajar')) return '🥕';
    if (n.includes('peas') || n.includes('matar')) return '🫛';
    if (n.includes('spinach') || n.includes('palak')) return '🍃';
    if (n.includes('cucumber') || n.includes('kheera')) return '🥒';
    if (n.includes('brinjal') || n.includes('baingan') || n.includes('eggplant')) return '🍆';
    if (n.includes('lemon') || n.includes('limo')) return '🍋';
    if (n.includes('apple') || n.includes('seeb')) return '🍎';
    if (n.includes('banana') || n.includes('kela')) return '🍌';
    if (n.includes('mango') || n.includes('aam')) return '🥭';
    if (n.includes('orange') || n.includes('malta') || n.includes('kinnow') || n.includes('mosambi')) return '🍊';
    if (n.includes('grapes') || n.includes('angoor')) return '🍇';
    if (n.includes('watermelon') || n.includes('tarbooz')) return '🍉';
    if (n.includes('melon') || n.includes('kharbooza') || n.includes('sarda') || n.includes('garma')) return '🍈';
    if (n.includes('peach') || n.includes('aaroo')) return '🍑';
    if (n.includes('capsicum') || n.includes('shimla')) return '🫑';
    if (n.includes('corn') || n.includes('makai')) return '🌽';
    if (n.includes('mushroom')) return '🍄';
    if (n.includes('pear') || n.includes('nashpati')) return '🍐';
    if (n.includes('plum') || n.includes('alobukhara') || n.includes('alubukhara')) return '🍑';
    if (n.includes('beans') || n.includes('phaliyan') || n.includes('phali') || n.includes('okra') || n.includes('bhindi') || n.includes('ladyfinger')) return '🫛';
    if (n.includes('karela') || n.includes('bitter')) return '🥒';
    if (n.includes('lauki') || n.includes('ghia') || n.includes('tinda') || n.includes('gourd')) return '🥒';
    if (n.includes('pumpkin') || n.includes('kaddu')) return '🎃';
    if (n.includes('radish') || n.includes('mooli')) return '🥕';
    if (n.includes('turnip') || n.includes('shalgam')) return '🧅';
    if (n.includes('sweet potato') || n.includes('shakarkandi')) return '🍠';
    if (n.includes('apricot') || n.includes('khubani')) return '🍑';
    if (n.includes('pomegranate') || n.includes('anar')) return '🍎';
    if (n.includes('guava') || n.includes('amrood')) return '🍏';
    if (n.includes('strawberry')) return '🍓';
    if (n.includes('cherry')) return '🍒';
    if (n.includes('pineapple')) return '🍍';
    if (n.includes('coconut') || n.includes('nariyal')) return '🥥';
    return '🥬';
  };

  const buildPriceRows = (items: typeof data.items, startIdx: number) =>
    items.map((item, i) => {
      const emoji = getProductEmoji(item.itemName);
      return `
        <tr>
          <td class="center muted" style="font-size:11px;padding:6px 6px;vertical-align:middle;">${startIdx + i + 1}</td>
          <td style="padding:6px 6px;vertical-align:middle;">
            <span style="font-size:16px;margin-right:6px;vertical-align:middle;">${emoji}</span>
            <span class="urdu-inline-dark" style="font-size:15px;font-weight:700;color:#000000;vertical-align:middle;margin-right:4px;">${item.urduName || item.itemName}</span>
            <span style="font-size:11px;color:#555555;font-weight:500;vertical-align:middle;">(${item.itemName})</span>
          </td>
          <td class="center muted" style="font-size:11px;padding:6px 6px;vertical-align:middle;">${item.unit}</td>
          <td class="right mono" style="font-size:13px;padding:6px 6px;color:#000000;font-weight:700;vertical-align:middle;">Rs ${item.sellRate.toLocaleString()}</td>
        </tr>
      `;
    }).join('');

  const priceColHeader = `
    <thead>
      <tr>
        <th class="center" style="font-size:10px;padding:6px 6px;width:30px;">#</th>
        <th style="font-size:10px;padding:6px 6px;">Product / پروڈکٹ</th>
        <th class="center" style="font-size:10px;padding:6px 6px;width:60px;">Unit</th>
        <th class="right" style="font-size:10px;padding:6px 6px;width:90px;">Rate (Rs)</th>
      </tr>
    </thead>
  `;

  const table = `
    <div style="display:flex;gap:12px;align-items:flex-start;margin-top:10px;">
      <div style="flex:1;min-width:0;">
        <table class="doc-table" style="width:100%;">
          ${priceColHeader}
          <tbody>
            ${col1.length > 0 ? buildPriceRows(col1, 0) : '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:20px;">No rates available</td></tr>'}
          </tbody>
        </table>
      </div>
      ${col2.length > 0 ? `
      <div style="flex:1;min-width:0;">
        <table class="doc-table" style="width:100%;">
          ${priceColHeader}
          <tbody>
            ${buildPriceRows(col2, half)}
          </tbody>
        </table>
      </div>` : '<div style="flex:1;"></div>'}
    </div>
  `;

  const notesBlock = '';

  const footer = buildFooter(brand, `Printed: ${printedOn}`);

  const body = `
    ${header}
    ${notesBlock}
    ${table}
    ${footer}
  `;

  return buildDocShell(brand, `Daily Price List — ${data.dateStr}`, body);
}

// ─── Purchase Voucher Types ───────────────────────────────────────────────────

export interface PurchaseItem {
  itemName: string;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  urduName?: string | null;
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
        <strong>${item.itemName}</strong>
        ${item.urduName ? `<span class="urdu-inline-val">(${item.urduName})</span>` : ''}
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
    origin
  );

  const infoGrid = `
    <div class="doc-info-grid">
      <div class="doc-info-box">
        <div class="doc-info-label">Client <span class="urdu-inline-dark">(کلائنٹ)</span></div>
        <div class="doc-info-value large">${data.clientName}</div>
        ${data.phone ? `<div class="doc-info-value" style="font-size:11px;">📞 ${data.phone}</div>` : ''}
        ${data.whatsapp && data.whatsapp !== data.phone ? `<div class="doc-info-value" style="font-size:11px;color:#2D6A4F;">💬 WA: ${data.whatsapp}</div>` : ''}
      </div>
      <div class="doc-info-box">
        <div class="doc-info-label">Statement Date</div>
        <div class="doc-info-value large">${today}</div>
      </div>
    </div>
  `;

  const kpiGrid = `
    <div class="doc-kpi-grid">
      <div class="doc-kpi-box">
        <div class="doc-kpi-label">
          Total Outstanding
          <span class="doc-kpi-urdu">کل واجب الادا</span>
        </div>
        <div class="doc-kpi-value danger">Rs ${data.totalOutstanding.toLocaleString()}</div>
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
          <th>Invoice No</th>
          <th>Date</th>
          <th class="right">Total (Rs)</th>
          <th class="right">Paid (Rs)</th>
          <th class="right">Remaining Due (Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="6" style="text-align:center;color:#aaa;padding:20px;">No outstanding invoices</td></tr>'}
      </tbody>
    </table>
  `;

  const summary = `
    <div class="doc-summary-wrap">
      <div class="doc-summary-box">
        <div class="doc-summary-row">
          <span class="label">Total Billed / <span class="urdu-inline-dark" style="color: #000000; font-size: 14px; font-weight: 700; margin-left: 5px;">کل بل</span></span>
          <span class="val">Rs ${data.totalBilled.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">Total Paid / <span class="urdu-inline-dark" style="color: #000000; font-size: 14px; font-weight: 700; margin-left: 5px;">کل ادا شدہ</span></span>
          <span class="val">- Rs ${data.totalPaid.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row grand-row">
          <span class="label">
            Remaining Outstanding
            <span class="urdu-sub">بقیہ واجب الادا</span>
          </span>
          <span class="val">Rs ${data.totalOutstanding.toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;

  const notesBlock = ''; // Outstanding due statement doesn't have custom notes

  const statusBadge = ''; // No status badge for list statement

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
 * Triggers a crisp image download natively on both desktop and mobile OS.
 * Converts base64 to binary Blob so Android / iOS Photos treat it as a native high-res file.
 */
export function downloadImage(dataUrl: string, filename: string): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const blob = new Blob([u8arr], { type: mime });
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
  } catch (err) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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



