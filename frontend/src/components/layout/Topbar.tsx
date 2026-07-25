'use client';

import { usePathname } from 'next/navigation';

const PAGE_META: Record<string, { title: string; sub: string }> = {
  '/':            { title: 'Dashboard',           sub: "Today's snapshot across the business" },
  '/sales':       { title: 'Sales & Billing',     sub: 'Create orders and generate invoices' },
  '/pricelist':   { title: 'Price List',           sub: "Today's vegetable rates at a glance" },
  '/delivery':    { title: 'Delivery Tracking',    sub: 'Assign and track all outgoing orders' },
  '/purchases':   { title: 'Purchases',            sub: 'Record stock bought from mandi suppliers' },
  '/inventory':   { title: 'Daily Inventory',      sub: 'Live stock from purchases, sales & wastage' },
  '/collections': { title: 'Collections',          sub: 'Record payments received from clients' },
  '/clients':     { title: 'Client Profiles',      sub: 'Every client, their ledger, and risk rating' },
  '/expenses':    { title: 'Expenses',             sub: 'Transport, labour, fuel and other costs' },
  '/employees':   { title: 'Employees',            sub: 'Staff, attendance and salary management' },
  '/reports':     { title: 'Reports & Analysis',   sub: 'P&L, cash flow, aging and trends' },
  '/settings':    { title: 'Settings',             sub: 'Branch, users, products and app config' },
};

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
}

interface TopbarProps {
  onMenuToggle?: () => void;
}

export function Topbar({ onMenuToggle }: TopbarProps) {
  const pathname = usePathname();
  const baseKey  = '/' + (pathname.split('/')[1] ?? '');
  const meta     = PAGE_META[baseKey] ?? PAGE_META['/'];

  return (
    <div className="va-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onMenuToggle && (
          <button 
            type="button" 
            onClick={onMenuToggle}
            className="va-mobile-menu-btn"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '22px',
              color: 'var(--forest)',
              cursor: 'pointer',
              padding: '6px 10px 6px 0',
              display: 'none', // controlled via CSS media query
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ☰
          </button>
        )}
        <div>
          <h2>{meta.title}</h2>
          <div className="sub">{meta.sub}</div>
        </div>
      </div>
      <div className="va-date-badge">{fmtDate(new Date())}</div>
    </div>
  );
}
