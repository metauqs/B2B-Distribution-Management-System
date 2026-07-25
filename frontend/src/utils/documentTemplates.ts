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
  logoUrl:       '/logo-transparent.png',
  primaryColor:  '#1A3C28',
  accentColor:   '#2D6A4F',
  lightBg:       '#F4F8F0',
  lineColor:     '#D4E6CC',
  contactNumber: '03061110041',
  footerLine:    'For Payments & WhatsApp Orders',
};

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

// ─── Shared CSS Design System ─────────────────────────────────────────────────

/**
 * Returns the shared <style> block used by every document type.
 * Typography, page size, brand colors, table design, footer, and Urdu font
 * are all defined here once.
 */
function buildDocStyles(b: BrandConfig): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;600;700&family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
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
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      font-size: 12px;
      color: #5A7A58;
      direction: rtl;
      unicode-bidi: embed;
      display: block;
      margin-top: 4px;
      margin-bottom: 2px;
      line-height: 2.2;
    }
    .urdu-inline {
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.85);
      margin-left: 6px;
      direction: rtl;
      unicode-bidi: embed;
      vertical-align: middle;
      display: inline-block;
      line-height: 2.2;
    }
    .urdu-inline-dark {
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      font-size: 11px;
      color: #7A8C79;
      margin-left: 6px;
      direction: rtl;
      unicode-bidi: embed;
      vertical-align: middle;
      display: inline-block;
      line-height: 2.2;
    }
    .urdu-inline-val {
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      font-size: 11px;
      color: #5A7A58;
      margin-left: 6px;
      direction: rtl;
      unicode-bidi: embed;
      vertical-align: middle;
      display: inline-block;
      line-height: 2.2;
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
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      direction: rtl;
      unicode-bidi: embed;
      text-align: right;
      font-size: 13px;
      color: #3D5C3B;
      line-height: 2.4;
      padding-top: 6px;
      padding-bottom: 6px;
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
      font-family: 'Noto Nastaliq Urdu', 'Geeza Pro', 'Microsoft Urdu Typesetting', 'Arabic Typesetting', 'Noto Sans Arabic', sans-serif;
      font-size: 11px;
      color: #7A9C78;
      direction: rtl;
      unicode-bidi: embed;
      margin-top: 4px;
      line-height: 2.2;
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
  const logoSrc = b.logoUrl.startsWith('http') ? b.logoUrl : `${origin}${b.logoUrl}`;
  return `
    <div class="doc-header">
      <div class="doc-header-brand">
        <img class="doc-header-logo" src="${logoSrc}" alt="${b.companyName}" onerror="this.style.display='none'">
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
        ${inv.employeeName ? `<div class="doc-info-value">👷 ${inv.employeeName}${inv.employeePhone ? ` (${inv.employeePhone})` : ''}</div>` : '<div class="doc-info-value" style="color:#aaa;">—</div>'}
        ${inv.deliveryDate ? `<div class="doc-info-value" style="font-size:12px;">📅 ${new Date(inv.deliveryDate).toLocaleDateString('en-GB')}${inv.deliveryTime ? ` · ${inv.deliveryTime}` : ''}</div>` : ''}
        <div class="doc-info-label" style="margin-top:8px;">Payment Mode <span class="urdu-inline-dark">(ادائیگی)</span></div>
        <div class="doc-info-value">${inv.paymentMode}</div>
      </div>
    </div>
  `;

  const itemRows = inv.items.map((item, i) => `
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

  const itemsTable = `
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
        ${itemRows}
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

  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center muted">${i + 1}</td>
      <td><strong>${item.itemName}</strong></td>
      <td class="urdu">${item.urduName || '—'}</td>
      <td class="center muted">${item.unit}</td>
      <td class="right mono" style="color:${brand.primaryColor};font-size:14px;">Rs ${item.sellRate.toLocaleString()}</td>
    </tr>
  `).join('');

  const table = `
    <table class="doc-table">
      <thead>
        <tr>
          <th class="center">#</th>
          <th>Product <span class="urdu-inline">(پروڈکٹ)</span></th>
          <th class="right"><span class="urdu-inline" style="color:#FFF;">اردو نام</span></th>
          <th class="center">Unit</th>
          <th class="right">Rate (Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows || '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:20px;">No rates available for this date</td></tr>'}
      </tbody>
    </table>
  `;

  const notesBlock = data.notes ? `<div class="doc-notes"><strong>Note:</strong> ${data.notes}</div>` : '';

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
          <span class="label">Total Billed / کل بل</span>
          <span class="val">Rs ${data.totalBilled.toLocaleString()}</span>
        </div>
        <div class="doc-summary-row paid-row">
          <span class="label">Total Paid / کل ادا شدہ</span>
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
 * Renders any unified template HTML to a base64 JPEG image (data URI) using SVG foreignObject.
 * This guarantees that JPG preview, JPG download, and WhatsApp image shares display
 * cursive shaped RTL Urdu letters correctly (pixel-perfect matching browser/PDF rendering).
 */
export async function generateTemplateImageBase64(html: string): Promise<string> {
  if (typeof window === 'undefined') return '';

  const container = document.createElement('div');
  // Position offscreen with a fixed typical page width
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '780px';
  container.style.background = '#FFFFFF';
  container.style.zIndex = '-1000';
  
  // Strip script tags to avoid double printing or executing scripts twice
  const cleanHtml = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  container.innerHTML = cleanHtml;
  document.body.appendChild(container);

  try {
    // Wait for all web fonts (including Noto Nastaliq Urdu) to be fully loaded in the browser context
    if ((document as any).fonts) {
      await (document as any).fonts.ready;
    }
    // Safety buffer for rendering tree parse and layout calculations
    await new Promise((resolve) => setTimeout(resolve, 800));

    const width = 780;
    const height = container.scrollHeight || 1000;

    // Build the SVG code with foreignObject wrapper
    const svgHtml = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff;margin:0;padding:0;width:${width}px;height:${height}px;">
            ${cleanHtml}
          </div>
        </foreignObject>
      </svg>
    `;

    // Convert to Blob URL to bypass DOM String limits
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    // Load into Image element
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const dataUrl: string = await new Promise((resolve, reject) => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // Render at 2x scale for retina/high-quality resolution
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL('image/jpeg', 0.95));
        } else {
          reject(new Error('Canvas context failed'));
        }
        URL.revokeObjectURL(url);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });

    return dataUrl;
  } catch (err) {
    console.warn('SVG screenshot failed, falling back to html2canvas:', err);
    // Fallback to html2canvas if SVG method fails
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
    });
    return canvas.toDataURL('image/jpeg', 0.95);
  } finally {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}


