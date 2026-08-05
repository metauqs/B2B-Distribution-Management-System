'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, fmtDateTime } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable, SkeletonProfile } from '@/components/ui/Skeleton';
import { loadBrandConfig, loadBrandConfigWithLogo, generateStatementHTML, openPrintWindow, writeAndPrint, openDownloadWindow, writeAndDownload } from '@/utils/documentTemplates';
import { DueStatementModal } from '@/components/modals/DueStatementModal';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import { usePreservedState } from '@/hooks/usePreservedState';
import Icon from '@mdi/react';
import {
  mdiAccountMultiple,
  mdiCart,
  mdiFactory,
  mdiOfficeBuilding,
  mdiFoodForkDrink,
  mdiHome,
  mdiFoodVariant,
  mdiAccountGroup,
  mdiPackageVariant,
  mdiCircle,
  mdiMagnify,
  mdiTrendingUp,
  mdiTrendingDown,
  mdiTrendingNeutral,
  mdiAlertOutline,
  mdiCheckCircle,
  mdiChartTimelineVariant,
  mdiBookOpen,
  mdiFileDocument,
  mdiCash,
  mdiTruck,
  mdiWhatsapp,
  mdiEye,
  mdiAlert,
  mdiPlus
} from '@mdi/js';

const TYPE_ICON: Record<string, string> = {
  RETAIL: mdiCart,
  WHOLESALE: mdiFactory,
  HOTEL: mdiOfficeBuilding,
  RESTAURANT: mdiFoodForkDrink,
  HOSTEL: mdiHome,
  CATERER: mdiFoodVariant,
  HOUSEHOLD: mdiAccountGroup,
  OTHER: mdiPackageVariant
};

const TAB_ICONS: Record<string, string> = {
  overview: mdiEye,
  behaviour: mdiChartTimelineVariant,
  ledger: mdiBookOpen,
  invoices: mdiFileDocument,
  payments: mdiCash,
  deliveries: mdiTruck,
  broadcasts: mdiWhatsapp
};

const TREND_ICONS: Record<string, string> = {
  IMPROVING: mdiTrendingUp,
  STABLE: mdiTrendingNeutral,
  HIGH_VOLATILITY: mdiAlertOutline,
  DETERIORATING: mdiTrendingDown
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  clientId?: string | null;
  name: string;
  ownerName?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  deliveryLocation?: string | null;
  type: string;
  status: string;
  rating: string;
  creditLimit: number;
  paymentTerms: number;
  openingBalance: number;
  notes?: string | null;
  // computed
  currentBalance:  number;
  totalSales:      number;
  totalCollected:  number;
  salesCount:      number;
  lastOrderDate:   string | null;
}

interface SaleItem { id?: string; qty: number; unit: string; rate: number; amount: number; product?: { name: string; urduName?: string | null } | null; productName?: string; }
interface Sale {
  id: string; invoiceNo: string; date: string;
  subtotal: number; discount: number; previousBalance?: number; total: number;
  paid: number; balance: number; status: string;
  items: SaleItem[];
}
interface Collection { id: string; date: string; amount: number; method: string; notes?: string; reference?: string; client?: { name: string } | null; }
interface Delivery   { id: string; date?: string; createdAt: string; status: string; notes?: string; sale?: { invoiceNo: string; client?: { name: string } | null } | null; driver?: { name: string } | null; vehicle?: { numberPlate: string } | null; }
interface LedgerEntry {
  type: 'opening' | 'invoice' | 'payment';
  date: string; description: string; ref?: string;
  debit: number; credit: number; runningBalance: number;
  status?: string; id?: string;
}

interface Profile {
  client: Client;
  currentBalance:     number;
  totalSales:         number;
  totalCollected:     number;
  lastOrderDate:      string | null;
  outstandingInvoices: Sale[];
  sales:              Sale[];
  collections:        Collection[];
  deliveries:         Delivery[];
  ledger:             LedgerEntry[];
  broadcasts?:        any[];
  creditRisk?:        any;
  collectionBehaviour?: any;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENT_TYPES  = ['RETAIL', 'WHOLESALE', 'HOTEL', 'RESTAURANT', 'HOSTEL', 'CATERER', 'HOUSEHOLD', 'OTHER'];
const PAYMENT_TERMS = [{ label: 'Cash on Delivery', val: 0 }, { label: '7 Days', val: 7 }, { label: '15 Days', val: 15 }, { label: '30 Days', val: 30 }, { label: '60 Days', val: 60 }];
const RATING_COLOR: Record<string, string>  = { GREEN: 'var(--ok)', YELLOW: 'var(--mustard)', ORANGE: '#E67E22', RED: 'var(--danger)', NEW: 'var(--muted)' };
const RATING_EMOJI: Record<string, string>  = { GREEN: '🟢', YELLOW: '🟡', ORANGE: '🟠', RED: '🔴', NEW: '⚪' };
const TYPE_EMOJI:   Record<string, string>  = { RETAIL: '🛒', WHOLESALE: '🏭', HOTEL: '🏨', RESTAURANT: '🍽️', HOSTEL: '🏠', CATERER: '🍱', HOUSEHOLD: '👨‍👩‍👧', OTHER: '📦' };

const BLANK_FORM = {
  name: '', ownerName: '', phone: '', whatsapp: '',
  address: '', deliveryLocation: '', type: 'RETAIL',
  creditLimit: 0, paymentTerms: 0, openingBalance: 0,
  notes: '', rating: 'NEW',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="va-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>{value}</div>
      {sub && <div className="foot">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'PAID' ? 'paid' : status === 'PARTIAL' ? 'partial' : 'pending';
  return <span className={`va-badge ${cls}`}>{status}</span>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const [clients,  setClients]  = useState<Client[]>(() => {
    return getCachedData<Client[]>('/api/clients?stats=true') || [];
  });
  const [profile,  setProfile]  = useState<Profile | null>(null);
  const [loading,  setLoading]  = useState(() => {
    return !getCachedData<Client[]>('/api/clients?stats=true');
  });
  const [profLoad, setProfLoad] = useState(false);
  const [toast,    setToast]    = useState('');
  const [saving,   setSaving]   = useState(false);

  // ── Due Statement Modal state ──
  const [statementClient, setStatementClient] = useState<any | null>(null);
  const [statementInvoices, setStatementInvoices] = useState<any[]>([]);
  const [statementMode, setStatementMode] = useState<'view' | 'share'>('view');

  const handleViewDues = (client: any) => {
    if (!profile) return;
    setStatementClient(client);
    setStatementInvoices(profile.outstandingInvoices.map(s => ({
      invoiceNo: s.invoiceNo,
      date: s.date,
      total: s.total,
      paid: s.paid,
      balance: s.balance,
      status: s.status
    })));
    setStatementMode('view');
  };

  const handleSendDueStatement = (client: any) => {
    if (!profile) return;
    setStatementClient(client);
    setStatementInvoices(profile.outstandingInvoices.map(s => ({
      invoiceNo: s.invoiceNo,
      date: s.date,
      total: s.total,
      paid: s.paid,
      balance: s.balance,
      status: s.status
    })));
    setStatementMode('share');
  };

  const [pState, setPState] = usePreservedState('clients', {
    view: 'list' as 'list' | 'profile' | 'add' | 'edit',
    search: '',
    typeFilter: 'all',
    ratingFilter: 'all',
    profTab: 'overview' as 'overview' | 'behaviour' | 'ledger' | 'invoices' | 'payments' | 'deliveries' | 'broadcasts',
  });

  const view = pState.view;
  const setView = (v: any) => setPState({ view: v });

  const search = pState.search;
  const setSearch = (s: string) => setPState({ search: s });

  const typeFilter = pState.typeFilter;
  const setTypeFilter = (tf: string) => setPState({ typeFilter: tf });

  const ratingFilter = pState.ratingFilter;
  const setRatingFilter = (rf: string) => setPState({ ratingFilter: rf });

  const profTab = pState.profTab;
  const setProfTab = (pt: any) => setPState({ profTab: pt });

  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => clearTimeout(handler);
  }, [search]);

  const [form,     setForm]     = useState({ ...BLANK_FORM });
  const [editId,   setEditId]   = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ─── Loaders ──────────────────────────────────────────────────────────────

  const loadClients = useCallback(async (isBackground = false) => {
    if (!isBackground && clients.length === 0) setLoading(true);
    const params = new URLSearchParams();
    params.set('stats', 'true');
    if (typeFilter !== 'all')   params.set('type', typeFilter);
    if (ratingFilter !== 'all') params.set('rating', ratingFilter);
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    const key = `/api/clients?${params}`;
    try {
      const data = await fetchWithCache<Client[]>(key, { ttl: TTL_MEDIUM, forceRefresh: isBackground });
      if (data) setClients(data);
    } catch (err) {
      console.error('loadClients error:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, typeFilter, ratingFilter, clients.length]);

  const loadProfile = useCallback(async (id: string, isBackground = false) => {
    if (!isBackground) setProfLoad(true);
    const key = `/api/clients/${id}`;
    try {
      const data = await fetchWithCache<any>(key, { ttl: TTL_MEDIUM, forceRefresh: isBackground });
      if (data) setProfile(data);
    } catch (err) {
      console.error('loadProfile error:', err);
    } finally {
      setProfLoad(false);
    }
  }, []);

  useEffect(() => { loadClients(); }, [loadClients]);

  useEffect(() => {
    const handleRevalidate = () => {
      loadClients(true);
      if (profile?.client?.id) {
        loadProfile(profile.client.id, true);
      }
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [loadClients, loadProfile, profile?.client?.id]);

  // ─── Client Actions ───────────────────────────────────────────────────────

  const openProfile = (c: Client) => {
    setProfile(getCachedData(`/api/clients/${c.id}`));
    setProfTab('overview');
    setView('profile');
    loadProfile(c.id);
  };

  const openAdd = () => {
    setForm({ ...BLANK_FORM });
    setEditId(null);
    setView('add');
  };

  const openEdit = (c: Client) => {
    setForm({
      name:             c.name,
      ownerName:        c.ownerName ?? '',
      phone:            c.phone ?? '',
      whatsapp:         c.whatsapp ?? '',
      address:          c.address ?? '',
      deliveryLocation: c.deliveryLocation ?? '',
      type:             c.type,
      creditLimit:      c.creditLimit,
      paymentTerms:     c.paymentTerms,
      openingBalance:   c.openingBalance,
      notes:            c.notes ?? '',
      rating:           c.rating,
    });
    setEditId(c.id);
    setView('edit');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return showToast('Business name is required');
    setSaving(true);
    try {
      const isEdit = view === 'edit' && editId;
      const url    = isEdit ? `/api/clients/${editId}` : '/api/clients';
      const method = isEdit ? 'PATCH' : 'POST';
      const res    = await apiFetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/clients');
        invalidateCache('/api/reports');
        showToast(isEdit ? '✅ Client updated' : '✅ Client created');
        setView('list');
        await loadClients(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Save failed'));
      }
    } finally { setSaving(false); }
  };

  const updateRating = async (clientId: string, rating: string) => {
    await apiFetch(`/api/clients/${clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    });
    invalidateCache('/api/clients');
    await loadClients(true);
    if (profile?.client.id === clientId) {
      setProfile(p => p ? { ...p, client: { ...p.client, rating } } : p);
    }
    showToast('✅ Rating updated');
  };

  const updateStatus = async (clientId: string, status: string) => {
    await apiFetch(`/api/clients/${clientId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    invalidateCache('/api/clients');
    await loadClients(true);
    showToast('✅ Status changed to ' + status);
  };

  // ─── PDF Export ─────────────────────────────────────────────────────────────────────

  const exportPDF = async () => {
    if (!profile) return;
    const { client, ledger, currentBalance, totalSales, totalCollected } = profile;
    // Open window synchronously first — avoids browser popup blocker
    const w = openPrintWindow();
    if (!w) return;
    const brand = await loadBrandConfigWithLogo();
    const html = generateStatementHTML(
      {
        clientName:      client.name,
        clientId:        client.clientId,
        ownerName:       client.ownerName,
        phone:           client.phone,
        whatsapp:        client.whatsapp,
        address:         client.address,
        deliveryLocation: client.deliveryLocation,
        totalSales,
        totalCollected,
        currentBalance,
        ledger,
      },
      brand,
      window.location.origin,
    );
    writeAndPrint(w, html, `Due Statement — ${client.name}`);
  };

  const downloadPDF = async () => {
    if (!profile) return;
    const { client, ledger, currentBalance, totalSales, totalCollected } = profile;
    // Open window synchronously first — avoids browser popup blocker
    const w = openDownloadWindow();
    if (!w) return;
    const brand = await loadBrandConfigWithLogo();
    const html = generateStatementHTML(
      {
        clientName:      client.name,
        clientId:        client.clientId,
        ownerName:       client.ownerName,
        phone:           client.phone,
        whatsapp:        client.whatsapp,
        address:         client.address,
        deliveryLocation: client.deliveryLocation,
        totalSales,
        totalCollected,
        currentBalance,
        ledger,
      },
      brand,
      window.location.origin,
    );
    writeAndDownload(w, html, `Due_Statement_${client.name.replace(/\s+/g, '_')}.pdf`);
  };

  const shareWhatsApp = () => {
    if (!profile) return;
    const { client, currentBalance, totalSales, totalCollected } = profile;
    const ph = (client.whatsapp ?? client.phone ?? '').replace(/[^0-9]/g, '');
    const isCredit = currentBalance <= 0;
    const msg = encodeURIComponent(
      `*HALAL VEGG SUPPLIES*\n` +
      `*Account Statement*\n` +
      `Client: ${client.name} (${client.clientId || '—'})\n` +
      `Date: ${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi' })}\n\n` +
      `Total Sales (کل فروخت): Rs ${totalSales.toLocaleString()}\n` +
      `Total Paid (کل ادائیگی): Rs ${totalCollected.toLocaleString()}\n` +
      `*Balance Due (کل واجب الادا): Rs ${Math.abs(currentBalance).toLocaleString()}${isCredit ? ' (Credit)' : ''}*\n\n` +
      `For Payments & WhatsApp Orders\nContact: 03061110041`
    );
    const waUrl = ph ? `https://wa.me/92${ph.replace(/^0/, '')}?text=${msg}` : `https://wa.me/?text=${msg}`;
    window.open(waUrl, '_blank');
  };

  // ─── Derived stats for list view ──────────────────────────────────────────

  const totalReceivables = clients.filter(c => c.currentBalance > 0).reduce((s, c) => s + c.currentBalance, 0);
  const totalClients     = clients.length;
  const highRiskClients = clients.filter(c => c.rating === 'RED' || c.rating === 'ORANGE').length;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.18)' }}>
          {toast}
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* VIEW: CLIENT LIST                                   */}
      {/* ════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <>
          {/* Header */}
          <div className="va-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
                  <Icon path={mdiAccountMultiple} size={1} color="var(--primary)" />
                  <h2 style={{ margin: 0 }}>Clients</h2>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Master customer ledger — all accounts, balances, and history</p>
              </div>
              <button className="va-btn" onClick={openAdd}>+ Add Client</button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="va-cards">
            <KpiCard label="Total Clients"      value={String(totalClients)}        sub="in directory" />
            <KpiCard label="Total Receivables"  value={fmtMoney(totalReceivables)}  sub="outstanding dues" color={totalReceivables > 0 ? 'var(--clay)' : undefined} />
            <KpiCard label="High-Risk Clients"  value={String(highRiskClients)}          sub="🔴/🟠 rated accounts" color={highRiskClients > 0 ? 'var(--danger)' : undefined} />
          </div>

          {/* Filters */}
          <div className="va-panel" style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search name, owner, phone, address…"
                style={{ flex: 2, minWidth: 200, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13 }}
              />
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Types</option>
                {CLIENT_TYPES.map(t => <option key={t} value={t}>{TYPE_EMOJI[t]} {t}</option>)}
              </select>
              <select value={ratingFilter} onChange={e => setRatingFilter(e.target.value)}
                style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Ratings</option>
                <option value="GREEN">🟢 Green</option>
                <option value="YELLOW">🟡 Yellow</option>
                <option value="ORANGE">🟠 Orange</option>
                <option value="RED">🔴 Red</option>
                <option value="NEW">⚪ New</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="va-panel">
            {loading && clients.length === 0 ? (
              <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div>
            ) : clients.length === 0 ? (
              <div className="va-empty">
                <div className="big">No clients found</div>
                <div>Add a client or adjust filters</div>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hide-mobile">
                  <table className="va-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Contact</th>
                        <th>Type</th>
                        <th>Rating</th>
                        <th style={{ textAlign: 'right' }}>Credit Limit</th>
                        <th style={{ textAlign: 'right' }}>Balance Due</th>
                        <th style={{ textAlign: 'right' }}>Total Sales</th>
                        <th>Last Order</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map(c => (
                        <tr key={c.id} style={{ background: c.rating === 'RED' ? '#FFF5F5' : c.rating === 'YELLOW' ? '#FFFBF0' : undefined }}>
                          <td>
                            <div style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Icon path={mdiCircle} size={0.55} color={RATING_COLOR[c.rating]} />
                              <span>{c.name}</span>
                              <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', background: '#e9ecef', padding: '1px 5px', borderRadius: 4, marginLeft: 6 }}>
                                {c.clientId || 'WH-0000'}
                              </span>
                            </div>
                            {c.ownerName && <div style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 16 }}>{c.ownerName}</div>}
                            {c.status === 'INACTIVE' && <span className="va-badge due" style={{ fontSize: 10, marginLeft: 16 }}>Inactive</span>}
                            {c.status === 'BLOCKED'  && <span className="va-badge" style={{ fontSize: 10, background: '#A83E3E', color: '#fff', marginLeft: 16 }}>Blocked</span>}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {c.phone && <div>{c.phone}</div>}
                            {c.whatsapp && c.whatsapp !== c.phone && <div style={{ color: 'var(--ok)' }}>WA: {c.whatsapp}</div>}
                            {c.address && <div style={{ color: 'var(--muted)' }}>{c.address}</div>}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <Icon path={TYPE_ICON[c.type] || mdiPackageVariant} size={0.65} color="var(--muted)" />
                              <span>{c.type}</span>
                            </div>
                          </td>
                          <td>
                            <select value={c.rating} onChange={e => updateRating(c.id, e.target.value)}
                              style={{ fontSize: 11, padding: '3px 6px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)', color: RATING_COLOR[c.rating], fontWeight: 700, cursor: 'pointer' }}>
                              {['GREEN','YELLOW','ORANGE','RED','NEW'].map(r => <option key={r} value={r}>{RATING_EMOJI[r]} {r}</option>)}
                            </select>
                          </td>
                          <td className="mono" style={{ textAlign: 'right' }}>{c.creditLimit > 0 ? fmtMoney(c.creditLimit) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', color: c.currentBalance > 0 ? 'var(--clay)' : c.currentBalance < 0 ? 'var(--ok)' : undefined, fontWeight: 700 }}>
                            {fmtMoney(Math.abs(c.currentBalance))}
                            {c.currentBalance < 0 && <span style={{ fontSize: 10 }}> CR</span>}
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontSize: 12, color: 'var(--muted)' }}>
                            {c.salesCount > 0 ? fmtMoney(c.totalSales) : '—'}
                            {c.salesCount > 0 && <div style={{ fontSize: 10 }}>{c.salesCount} invoices</div>}
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {c.lastOrderDate ? fmtDate(c.lastOrderDate) : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="va-btn secondary small" onClick={() => openProfile(c)}>Profile</button>
                              <button className="va-btn secondary small" onClick={() => openEdit(c)}>✏️</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {clients.map(c => {
                    return (
                      <MobileCard
                        key={c.id}
                        title={
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <Icon path={mdiCircle} size={0.45} color={RATING_COLOR[c.rating]} />
                            <span>{c.name}</span>
                          </div>
                        }
                        headerBadge={c.clientId || 'WH-0000'}
                        footer={
                          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                            <button 
                              onClick={() => openProfile(c)}
                              className="va-btn small"
                              style={{ flex: 1, fontWeight: 700 }}
                            >
                              👤 Profile
                            </button>
                            <button 
                              onClick={() => openEdit(c)}
                              className="va-btn secondary small"
                              style={{ flex: 1, fontWeight: 700 }}
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        }
                      >
                        <MobileCardRow 
                          label="Balance Due" 
                          value={`${fmtMoney(Math.abs(c.currentBalance))}${c.currentBalance < 0 ? ' (CR)' : ''}`} 
                          valueColor={c.currentBalance > 0 ? '#991B1B' : '#166534'} 
                          isMono 
                        />
                        <MobileCardRow label="Client Rating">
                          <select 
                            value={c.rating} 
                            onChange={e => updateRating(c.id, e.target.value)}
                            style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px 6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                          >
                            {['GREEN','YELLOW','ORANGE','RED','NEW'].map(r => <option key={r} value={r}>{RATING_EMOJI[r]} {r}</option>)}
                          </select>
                        </MobileCardRow>
                        <MobileCardRow label="Client Type" value={c.type} />
                        {c.phone && (
                          <MobileCardRow label="Phone">
                            <a href={`tel:${c.phone}`} style={{ color: '#2563EB', textDecoration: 'none', fontWeight: 700 }}>📞 {c.phone}</a>
                          </MobileCardRow>
                        )}
                        <MobileCardRow 
                          label="Credit Limit" 
                          value={c.creditLimit > 0 ? `${fmtMoney(c.creditLimit)}${c.paymentTerms > 0 ? ` (${c.paymentTerms}d)` : ''}` : '—'} 
                          isMono 
                        />
                        <MobileCardRow 
                          label="Total Sales" 
                          value={c.salesCount > 0 ? `${fmtMoney(c.totalSales)} (${c.salesCount} bills)` : '—'} 
                        />
                        <MobileCardRow label="Last Order" value={c.lastOrderDate ? fmtDate(c.lastOrderDate) : '—'} />
                      </MobileCard>
                    );
                  })}
                </div>

                <div style={{
                  marginTop: '16px',
                  padding: '16px',
                  background: 'rgba(0,0,0,0.03)',
                  borderRadius: '12px',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>Total Receivables</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)', fontSize: '16px' }}>{fmtMoney(totalReceivables)}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* VIEW: CLIENT PROFILE                               */}
      {/* ════════════════════════════════════════════════════ */}
      {view === 'profile' && (
        <>
          {/* Back + Actions */}
          <div className="va-panel" style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="va-btn secondary small" onClick={() => setView('list')}>← Back</button>
                {profile && (
                  <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Icon path={mdiCircle} size={0.55} color={RATING_COLOR[profile.client.rating]} />
                    <span>{profile.client.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)', background: '#e9ecef', padding: '1px 5px', borderRadius: 4, marginLeft: 8 }}>{profile.client.clientId || 'WH-0000'}</span>
                    <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)', marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Icon path={TYPE_ICON[profile.client.type] || mdiPackageVariant} size={0.65} color="var(--muted)" />
                      <span>{profile.client.type}</span>
                    </span>
                  </h3>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {profile && <button className="va-btn secondary small" onClick={() => openEdit(profile.client)}>✏️ Edit</button>}
                <button className="va-btn secondary small" onClick={exportPDF}>📄 PDF</button>
                <button className="va-btn secondary small" onClick={downloadPDF}>💾 Download PDF</button>
                <button className="va-btn secondary small" onClick={shareWhatsApp} style={{ background: '#25D366', color: '#fff', border: 'none' }}>📲 WhatsApp</button>
              </div>
            </div>
          </div>

          {profLoad && !profile ? (
            <div style={{ padding: 16 }}><SkeletonProfile /></div>
          ) : profile ? (
            <>
              {/* KPI Cards */}
              <div className="va-cards">
                <KpiCard
                  label="Current Balance"
                  value={fmtMoney(profile.currentBalance)}
                  sub={profile.currentBalance > 0 ? 'Amount owed to us' : profile.currentBalance < 0 ? 'We owe client' : 'Clear'}
                  color={profile.currentBalance > 0 ? 'var(--clay)' : profile.currentBalance < 0 ? 'var(--ok)' : undefined}
                />
                <KpiCard label="Total Purchases"  value={fmtMoney(profile.totalSales)}     sub={`${profile.sales.length} invoices`} />
                <KpiCard label="Total Paid"        value={fmtMoney(profile.totalCollected)} sub={`${profile.collections.length} payments`} color="var(--ok)" />
                <KpiCard label="Outstanding Bills" value={String(profile.outstandingInvoices.length)} sub="unpaid invoices" color={profile.outstandingInvoices.length > 0 ? 'var(--danger)' : undefined} />
              </div>

              {/* Client Details card */}
              <div className="va-panel" style={{ marginBottom: 0 }}>
                <div className="va-panel-head"><h3>Client Information</h3></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px 24px', fontSize: 13 }}>
                  {[
                    ['Client ID', profile.client.clientId || 'WH-0000'],
                    ['Business Name', profile.client.name],
                    ['Owner / Contact', profile.client.ownerName],
                    ['Phone', profile.client.phone],
                    ['WhatsApp', profile.client.whatsapp],
                    ['Address', profile.client.address],
                    ['Delivery Location', profile.client.deliveryLocation],
                    ['Credit Limit', profile.client.creditLimit > 0 ? fmtMoney(profile.client.creditLimit) : 'None'],
                    ['Payment Terms', profile.client.paymentTerms === 0 ? 'Cash on Delivery' : `${profile.client.paymentTerms} Days`],
                    ['Last Order', profile.lastOrderDate ? fmtDate(profile.lastOrderDate) : 'Never'],
                    ['Notes', profile.client.notes],
                  ].filter(([, v]) => v).map(([label, val]) => (
                    <div key={label as string}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 600 }}>{val ?? '—'}</div>
                    </div>
                  ))}
                </div>
                {/* Rating + Status */}
                <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Risk Rating:</div>
                  {['GREEN','YELLOW','ORANGE','RED','NEW'].map(r => (
                    <button key={r} onClick={() => updateRating(profile.client.id, r)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '2px solid', borderColor: profile.client.rating === r ? RATING_COLOR[r] : 'var(--line)', background: profile.client.rating === r ? RATING_COLOR[r] : 'transparent', color: profile.client.rating === r ? '#fff' : 'var(--ink)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      {RATING_EMOJI[r]} {r}
                    </button>
                  ))}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Status:</div>
                    {['ACTIVE','INACTIVE','BLOCKED'].map(s => (
                      <button key={s} onClick={() => updateStatus(profile.client.id, s)}
                        style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line)', background: profile.client.status === s ? 'var(--forest)' : 'transparent', color: profile.client.status === s ? '#fff' : 'var(--ink)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Dynamic Credit Risk Service Assessment Card */}
              {profile.creditRisk && (
                <div className="va-panel" style={{ marginTop: 16, borderLeft: `6px solid ${RATING_COLOR[profile.creditRisk.rating]}` }}>
                  <div className="va-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>📋 Credit Risk Management Dashboard</h3>
                    <span className={`va-badge`} style={{ fontWeight: 700, padding: '4px 12px', fontSize: 12, background: RATING_COLOR[profile.creditRisk.rating], color: '#fff' }}>
                      {RATING_EMOJI[profile.creditRisk.rating]} {profile.creditRisk.rating} RISK CATEGORY
                    </span>
                  </div>

                  {/* Recommended Action Policy Banner */}
                  <div style={{
                    background: profile.creditRisk.rating === 'GREEN' ? '#EBFCEF' : profile.creditRisk.rating === 'YELLOW' ? '#FFFBE6' : profile.creditRisk.rating === 'ORANGE' ? '#FFF0E6' : '#FFF1F0',
                    border: `1px solid ${RATING_COLOR[profile.creditRisk.rating]}`,
                    padding: '12px 16px',
                    borderRadius: 8,
                    marginBottom: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.5px' }}>RECOMMENDED ACTION</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: profile.creditRisk.rating === 'GREEN' ? 'var(--forest)' : profile.creditRisk.rating === 'YELLOW' ? 'var(--mustard)' : profile.creditRisk.rating === 'ORANGE' ? '#D35400' : 'var(--danger)' }}>
                      ⚠️ {profile.creditRisk.recommendedAction}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, fontSize: 13, marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Average Order Value (AOV)</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }} className="mono">{fmtMoney(profile.creditRisk.averageOrderValue)}</div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Last 30 orders baseline</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Outstanding Balance</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--clay)' }} className="mono">{fmtMoney(profile.creditRisk.currentBalance)}</div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Current exposed accounts receivable</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Credit Limit</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }} className="mono">
                        {fmtMoney(profile.creditRisk.effectiveCreditLimit)}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {profile.creditRisk.isManualLimitOverride ? '🔒 Manual Override Limit' : '🔄 Dynamic Limit (AOV × 3)'}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Exposure Percentage</div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: profile.creditRisk.exposurePct > 100 ? 'var(--danger)' : profile.creditRisk.exposurePct > 90 ? '#E67E22' : profile.creditRisk.exposurePct >= 70 ? 'var(--mustard)' : 'var(--forest)'
                      }}>
                        {profile.creditRisk.exposurePct}%
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Receivable ÷ Credit Limit</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Available Credit</div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: profile.creditRisk.availableCredit > 0 ? 'var(--forest)' : 'var(--danger)'
                      }} className="mono">
                        {fmtMoney(profile.creditRisk.availableCredit)}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Remaining safety buffer</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Avg Payment Cycle</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>
                        {profile.creditRisk.averagePaymentCycle} days
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Average days to receive payment</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Payment Reliability</div>
                      <div style={{
                        fontSize: 15,
                        fontWeight: 700,
                        color: profile.creditRisk.paymentReliabilityRating === 'EXCELLENT' ? 'var(--forest)' : profile.creditRisk.paymentReliabilityRating === 'GOOD' ? 'var(--ok)' : profile.creditRisk.paymentReliabilityRating === 'FAIR' ? 'var(--mustard)' : profile.creditRisk.paymentReliabilityRating === 'POOR' ? '#E67E22' : 'var(--danger)'
                      }}>
                        {profile.creditRisk.paymentReliabilityRating}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Behavior analysis status</span>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>Overdue Invoices</div>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: profile.creditRisk.overdueCount > 0 ? 'var(--danger)' : 'var(--forest)'
                      }}>
                        {profile.creditRisk.overdueCount} invoices
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Unpaid past allowed terms</span>
                    </div>
                  </div>

                  {profile.creditRisk.reasons && profile.creditRisk.reasons.length > 0 && (
                    <div style={{ background: 'var(--line-soft)', padding: '10px 14px', borderRadius: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>RISK FACTORS / BEHAVIOR ANALYSIS:</div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                        {profile.creditRisk.reasons.map((r: string, idx: number) => (
                          <li key={idx} style={{ color: profile.creditRisk.rating === 'RED' || profile.creditRisk.rating === 'ORANGE' ? '#B5533C' : 'var(--ink)', fontWeight: 600 }}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Profile Tabs */}
              <div className="va-tabs-inline">
                {(['overview','behaviour','ledger','invoices','payments','deliveries','broadcasts'] as const).map(t => (
                  <button key={t} className={profTab === t ? 'active' : ''} onClick={() => setProfTab(t)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon path={TAB_ICONS[t]} size={0.65} />
                    <span>{t === 'behaviour' ? 'Behaviour Analysis' : t === 'broadcasts' ? 'Broadcast History' : t.charAt(0).toUpperCase() + t.slice(1)}</span>
                    {t === 'invoices'  && profile.outstandingInvoices.length > 0 && <span style={{ marginLeft: 4, background: 'var(--danger)', color: '#fff', borderRadius: 10, padding: '1px 5px', fontSize: 10 }}>{profile.outstandingInvoices.length}</span>}
                  </button>
                ))}
              </div>

              {/* Behaviour Tab */}
              {profTab === 'behaviour' && profile.collectionBehaviour && (
                <div className="va-panel" style={{ borderTop: `4px solid ${
                  profile.collectionBehaviour.alertLevel === 'CRITICAL' ? 'var(--danger)' :
                  profile.collectionBehaviour.alertLevel === 'WARNING' ? '#E67E22' :
                  profile.collectionBehaviour.alertLevel === 'CAUTION' ? 'var(--mustard)' :
                  'var(--forest)'
                }` }}>
                  <div className="va-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon path={mdiChartTimelineVariant} size={0.9} color="var(--primary)" />
                      <h3 style={{ margin: 0 }}>Collection Behaviour Monitoring &amp; Pattern Analysis</h3>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>ALERT STATUS:</span>
                      <span className="va-badge" style={{
                        fontWeight: 700,
                        background:
                          profile.collectionBehaviour.alertLevel === 'CRITICAL' ? '#FFF1F0' :
                          profile.collectionBehaviour.alertLevel === 'WARNING' ? '#FFF0E6' :
                          profile.collectionBehaviour.alertLevel === 'CAUTION' ? '#FFFBE6' :
                          '#EBFCEF',
                        color:
                          profile.collectionBehaviour.alertLevel === 'CRITICAL' ? 'var(--danger)' :
                          profile.collectionBehaviour.alertLevel === 'WARNING' ? '#D35400' :
                          profile.collectionBehaviour.alertLevel === 'CAUTION' ? 'var(--mustard)' :
                          'var(--forest)',
                        border: '1px solid'
                      }}>
                        {profile.collectionBehaviour.alertLevel}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Alert Actions Banner */}
                  <div style={{
                    background:
                      profile.collectionBehaviour.alertLevel === 'CRITICAL' ? '#FFF1F0' :
                      profile.collectionBehaviour.alertLevel === 'WARNING' ? '#FFF0E6' :
                      profile.collectionBehaviour.alertLevel === 'CAUTION' ? '#FFFBE6' :
                      '#EBFCEF',
                    borderLeft: `5px solid ${
                      profile.collectionBehaviour.alertLevel === 'CRITICAL' ? 'var(--danger)' :
                      profile.collectionBehaviour.alertLevel === 'WARNING' ? '#E67E22' :
                      profile.collectionBehaviour.alertLevel === 'CAUTION' ? 'var(--mustard)' :
                      'var(--forest)'
                    }`,
                    padding: '12px 18px',
                    borderRadius: 6,
                    marginBottom: 20
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recommended Collection Action</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                      {profile.collectionBehaviour.recommendedAction}
                    </div>
                  </div>

                  {/* Dashboard Metrics Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, marginBottom: 20 }}>
                    
                    {/* Score Panel */}
                    <div style={{ background: 'var(--line-soft)', padding: '16px', borderRadius: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>Behaviour Score</div>
                      <div style={{
                        fontSize: 32,
                        fontWeight: 800,
                        color:
                          profile.collectionBehaviour.score >= 85 ? 'var(--forest)' :
                          profile.collectionBehaviour.score >= 70 ? 'var(--mustard)' :
                          profile.collectionBehaviour.score >= 40 ? '#E67E22' :
                          'var(--danger)'
                      }}>
                        {profile.collectionBehaviour.score}<span style={{ fontSize: 16, color: 'var(--muted)', fontWeight: 500 }}>/100</span>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginTop: 4 }}>
                        {profile.collectionBehaviour.score >= 85 ? '🟢 Excellent Consistency' :
                         profile.collectionBehaviour.score >= 70 ? '🟡 Good Patterns' :
                         profile.collectionBehaviour.score >= 40 ? '🟠 Minor Deviations' :
                         '🔴 High Risk Anomaly'}
                      </div>
                    </div>

                    {/* Payment Gap comparison */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Avg Payment Gap</div>
                      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }} className="mono">
                        {profile.collectionBehaviour.paymentGapCurr} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>Days</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                        Historical baseline: <strong className="mono">{profile.collectionBehaviour.paymentGapHist}d</strong>
                      </div>
                    </div>

                    {/* Payment Method Trend */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Preferred Payment Method</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                        {profile.collectionBehaviour.preferredMethodCurr}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                        Historical Preference: <strong>{profile.collectionBehaviour.preferredMethodHist}</strong>
                      </div>
                    </div>

                    {/* Payment Frequency */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Payment Frequency</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
                        {profile.collectionBehaviour.paymentFrequency}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
                        Avg interval: <strong className="mono">{profile.collectionBehaviour.avgPaymentIntervalDays} days</strong>
                      </div>
                    </div>

                    {/* Behavior Trend */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Payment Behavior Trend</div>
                       <div style={{
                        fontSize: 15,
                        fontWeight: 700,
                        marginTop: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        color:
                          profile.collectionBehaviour.trend === 'IMPROVING' ? 'var(--forest)' :
                          profile.collectionBehaviour.trend === 'STABLE' ? 'var(--ink)' :
                          profile.collectionBehaviour.trend === 'HIGH_VOLATILITY' ? '#E67E22' :
                          'var(--danger)'
                      }}>
                        <Icon path={TREND_ICONS[profile.collectionBehaviour.trend] || mdiTrendingNeutral} size={0.75} />
                        <span>
                          {profile.collectionBehaviour.trend === 'IMPROVING' ? 'Improving Cycle' :
                           profile.collectionBehaviour.trend === 'STABLE' ? 'Stable Behavior' :
                           profile.collectionBehaviour.trend === 'HIGH_VOLATILITY' ? 'High Volatility' :
                           'Deteriorating Cycle'}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Collection gap pattern trend</span>
                    </div>

                    {/* Ratios */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Invoice Settlement Types</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Paid Immediately:</span>
                          <strong className="mono">{profile.collectionBehaviour.paidImmediatelyPct}%</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Paid on Credit:</span>
                          <strong className="mono">{profile.collectionBehaviour.paidOnCreditPct}%</strong>
                        </div>
                      </div>
                    </div>

                    {/* Collections volume */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Avg Collection Size</div>
                      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }} className="mono">
                        {fmtMoney(profile.collectionBehaviour.avgCollectionAmount)}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Per collection transaction</span>
                    </div>

                    {/* Delayed & Partials */}
                    <div style={{ border: '1px solid var(--line)', padding: '14px', borderRadius: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Settlement Deviations</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, fontSize: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Delayed Payments:</span>
                          <strong className="mono" style={{ color: profile.collectionBehaviour.delayedPaymentsCount > 0 ? 'var(--danger)' : undefined }}>
                            {profile.collectionBehaviour.delayedPaymentsCount}
                          </strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--muted)' }}>Partial Settlements:</span>
                          <strong className="mono" style={{ color: profile.collectionBehaviour.partialPaymentsCount > 0 ? 'var(--mustard)' : undefined }}>
                            {profile.collectionBehaviour.partialPaymentsCount}
                          </strong>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Pattern Anomalies & Alerts List */}
                  <div style={{ background: 'var(--line-soft)', padding: '14px 18px', borderRadius: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                      Detected Behaviour Pattern Anomalies:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: '1.6' }}>
                      {profile.collectionBehaviour.alerts.map((a: string, idx: number) => (
                        <li key={idx} style={{
                          color:
                            profile.collectionBehaviour.alertLevel === 'CRITICAL' || profile.collectionBehaviour.alertLevel === 'WARNING' ? '#B5533C' : 'var(--ink)',
                          fontWeight: 600
                        }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>

                </div>
              )}

              {/* Overview Tab */}
              {profTab === 'overview' && (
                <div className="va-panel">
                  <div className="va-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3>Outstanding Invoices</h3>
                    {profile.outstandingInvoices.length > 0 && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="va-btn secondary small" onClick={() => handleViewDues(profile.client)}>View Dues</button>
                        <button className="va-btn small" onClick={() => handleSendDueStatement(profile.client)}>Send Due Statement</button>
                      </div>
                    )}
                  </div>
                  {profile.outstandingInvoices.length === 0 ? (
                    <div className="va-empty"><div className="big">All Clear ✅</div><div>No outstanding invoices</div></div>
                  ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                        <table className="va-table">
                          <thead><tr><th>Invoice</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Due</th><th>Status</th></tr></thead>
                          <tbody>
                            {profile.outstandingInvoices.map(s => (
                              <tr key={s.id} style={{ background: '#FFF5F5' }}>
                                <td className="mono" style={{ fontWeight: 700, color: 'var(--forest)' }}>{s.invoiceNo}</td>
                                <td>{fmtDate(s.date)}</td>
                                <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(s.total)}</td>
                                <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>{fmtMoney(s.paid)}</td>
                                <td className="mono" style={{ textAlign: 'right', color: 'var(--clay)', fontWeight: 700 }}>{fmtMoney(s.balance)}</td>
                                <td><StatusBadge status={s.status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card View */}
                      <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                        {profile.outstandingInvoices.map(s => {
                          const isPaid = s.balance <= 0;
                          const isPartial = s.paid > 0 && s.balance > 0;
                          return (
                            <MobileCard
                              key={s.id}
                              title={s.invoiceNo}
                              headerBadge={fmtDate(s.date)}
                            >
                              <MobileCardRow label="Total Amount" value={fmtMoney(s.total)} isMono />
                              <MobileCardRow label="Paid Amount" value={fmtMoney(s.paid)} valueColor="#166534" isMono />
                              <MobileCardRow label="Balance Due" value={fmtMoney(s.balance)} valueColor="#991B1B" isMono />
                              <MobileCardRow label="Payment Status">
                                <MobileCardBadge variant={isPaid ? 'green' : isPartial ? 'yellow' : 'red'}>
                                  {s.status}
                                </MobileCardBadge>
                              </MobileCardRow>
                            </MobileCard>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Ledger Tab */}
              {profTab === 'ledger' && (
                <div>
                  {/* Desktop Table View */}
                  <div className="hide-mobile" style={{ background: '#ffffff', borderRadius: 12, padding: '24px 20px 16px 20px', color: 'var(--ink)', border: '1px solid var(--line)', boxShadow: '0 1px 3px rgba(0,0,0,0.02)', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead style={{ borderBottom: '1px solid var(--line)' }}>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '12px 8px', color: 'var(--muted)', fontWeight: 500, fontSize: '13px', borderBottom: '1px solid var(--line)' }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '12px 8px', color: 'var(--muted)', fontWeight: 500, fontSize: '13px', borderBottom: '1px solid var(--line)' }}>Description</th>
                          <th style={{ textAlign: 'right', padding: '12px 8px', color: 'var(--muted)', fontWeight: 500, fontSize: '13px', borderBottom: '1px solid var(--line)' }}>Billed (dr)</th>
                          <th style={{ textAlign: 'right', padding: '12px 8px', color: 'var(--muted)', fontWeight: 500, fontSize: '13px', borderBottom: '1px solid var(--line)' }}>Paid (cr)</th>
                          <th style={{ textAlign: 'right', padding: '12px 8px', color: 'var(--muted)', fontWeight: 500, fontSize: '13px', borderBottom: '1px solid var(--line)' }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.ledger.map((entry, i) => {
                          const isToday = entry.date && new Date().toDateString() === new Date(entry.date).toDateString();
                          
                          const formatLedgerDate = (dateStr: string | Date, type: string) => {
                            if (type === 'opening' || !dateStr) return '—';
                            const d = new Date(dateStr);
                            if (isNaN(d.getTime())) return '—';
                            const day = d.getDate();
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return `${day} ${months[d.getMonth()]}`;
                          };

                          const formatLedgerDescription = (desc: string) => {
                            if (!desc) return '';
                            const d = desc.trim();
                            if (d.toLowerCase().startsWith('invoice generated')) {
                              return 'Invoice generated';
                            }
                            if (d.toLowerCase().startsWith('payment received')) {
                              const match = d.match(/\(([^)]+)\)/);
                              if (match) {
                                const method = match[1].toUpperCase();
                                if (['CASH', 'BANK', 'CHEQUE', 'ONLINE'].includes(method)) {
                                  return `Payment received (${method.toLowerCase()})`;
                                }
                                return `Payment received (${match[1]})`;
                              }
                              return 'Payment received';
                            }
                            if (d.toLowerCase() === 'opening balance') {
                              return 'Opening balance';
                            }
                            return d.charAt(0).toUpperCase() + d.slice(1);
                          };

                          const getLedgerIcon = (type: string, debit: number) => {
                            if (type === 'payment' || (type === 'adjustment' && debit === 0)) {
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(62, 122, 78, 0.1)', color: 'var(--ok)', flexShrink: 0, marginRight: 12, justifyContent: 'center' }}>
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                                    <rect width="20" height="12" x="2" y="6" rx="2"/>
                                    <circle cx="12" cy="12" r="2"/>
                                    <path d="M6 12h.01M18 12h.01"/>
                                  </svg>
                                </div>
                              );
                            }
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(168, 62, 62, 0.1)', color: 'var(--danger)', flexShrink: 0, marginRight: 12, justifyContent: 'center' }}>
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
                                  <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
                                </svg>
                              </div>
                            );
                          };

                          return (
                            <tr key={i} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                              <td style={{ padding: '14px 8px', color: 'var(--muted)', fontSize: '13.5px', verticalAlign: 'middle' }}>
                                {formatLedgerDate(entry.date, entry.type)}
                              </td>
                              <td style={{ padding: '14px 8px', verticalAlign: 'middle' }}>
                                {entry.type === 'opening' ? (
                                  <span style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '13.5px' }}>Opening balance</span>
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center' }}>
                                    {getLedgerIcon(entry.type, entry.debit)}
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '13.5px', display: 'flex', alignItems: 'center' }}>
                                        {formatLedgerDescription(entry.description)}
                                        {isToday && (
                                          <span style={{ marginLeft: 8, background: '#dbeafe', color: '#1e40af', fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '12px', display: 'inline-block' }}>
                                            Today
                                          </span>
                                        )}
                                      </span>
                                      {entry.ref && (
                                        <span style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px', fontFamily: 'monospace' }}>
                                          {entry.ref}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', padding: '14px 8px', color: entry.debit > 0 ? 'var(--danger)' : 'var(--muted)', fontSize: '13.5px', verticalAlign: 'middle', fontWeight: entry.debit > 0 ? 600 : 400 }}>
                                {entry.debit > 0 ? fmtMoney(entry.debit) : '—'}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', padding: '14px 8px', color: entry.credit > 0 ? 'var(--ok)' : 'var(--muted)', fontSize: '13.5px', verticalAlign: 'middle', fontWeight: entry.credit > 0 ? 600 : 400 }}>
                                {entry.credit > 0 ? fmtMoney(entry.credit) : '—'}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', padding: '14px 8px', color: 'var(--ink)', fontWeight: 700, fontSize: '13.5px', verticalAlign: 'middle' }}>
                                {fmtMoney(entry.runningBalance)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Card List View */}
                  <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                    {profile.ledger.map((entry, i) => {
                      const formatLedgerDate = (dateStr: string | Date, type: string) => {
                        if (type === 'opening' || !dateStr) return '—';
                        const d = new Date(dateStr);
                        if (isNaN(d.getTime())) return '—';
                        const day = d.getDate();
                        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        return `${day} ${months[d.getMonth()]}`;
                      };

                      const formatLedgerDescription = (desc: string) => {
                        if (!desc) return '';
                        const d = desc.trim();
                        if (d.toLowerCase().startsWith('invoice generated')) return 'Invoice generated';
                        if (d.toLowerCase().startsWith('payment received')) return 'Payment received';
                        if (d.toLowerCase() === 'opening balance') return 'Opening balance';
                        return d.charAt(0).toUpperCase() + d.slice(1);
                      };

                      return (
                        <MobileCard
                          key={i}
                          title={formatLedgerDescription(entry.description)}
                          headerBadge={formatLedgerDate(entry.date, entry.type)}
                        >
                          {entry.ref && <MobileCardRow label="Reference ID" value={entry.ref} isMono />}
                          {entry.debit > 0 && <MobileCardRow label="Billed (Dr)" value={fmtMoney(entry.debit)} valueColor="#991B1B" isMono />}
                          {entry.credit > 0 && <MobileCardRow label="Paid (Cr)" value={fmtMoney(entry.credit)} valueColor="#166534" isMono />}
                          <MobileCardRow label="Running Balance" value={fmtMoney(entry.runningBalance)} isMono />
                        </MobileCard>
                      );
                    })}
                  </div>
                  
                  {/* Current Balance Footer Block */}
                  <div style={{ 
                    marginTop: 16, 
                    background: 'var(--line-soft)', 
                    borderRadius: 12, 
                    padding: '16px 20px', 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                    border: '1px solid var(--line)'
                  }}>
                    <span style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '15px' }}>Current balance</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '18px', fontFamily: 'monospace' }}>
                      {fmtMoney(profile.currentBalance)}
                    </span>
                  </div>
                </div>
              )}

              {/* Invoices Tab */}
              {profTab === 'invoices' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Invoice Collections Registry Table</h3></div>
                  {profile.sales.length === 0 ? (
                    <div className="va-empty"><div className="big">No invoices yet</div></div>
                  ) : (
                    <>
                      {/* Desktop View Table */}
                      <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                        <table className="va-table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th>Invoice ID</th>
                              <th>Client ID</th>
                              <th>Client Name</th>
                              <th>Invoice Date &amp; Time</th>
                              <th style={{ textAlign: 'right' }}>Previous Dues</th>
                              <th style={{ textAlign: 'right' }}>Current Order Amount</th>
                              <th style={{ textAlign: 'right' }}>Total Payable Amount</th>
                              <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Pay Now</th>
                              <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Collected Amount</th>
                              <th style={{ textAlign: 'right', color: 'var(--clay)' }}>Due Balance</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              let runningDue = profile.client.openingBalance ?? 0;
                              const sortedSales = [...profile.sales].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                              return sortedSales.map(sale => {
                                const prevOutstanding = runningDue;
                                const currentOrder = sale.total;
                                const totalPayable = prevOutstanding + currentOrder;
                                const payNow = sale.paid;           // amount paid at checkout
                                const collectedAmount = sale.paid;  // total ever collected (same as Sale.paid)
                                const dueBalance = Math.max(0, totalPayable - collectedAmount);
                                runningDue = dueBalance;

                                let statusBadge = (
                                  <span className="va-badge" style={{ background: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Unpaid</span>
                                );
                                if (sale.status === 'PAID' || dueBalance <= 0) {
                                  statusBadge = (
                                    <span className="va-badge" style={{ background: '#E3F9E9', color: '#1B5E20', border: '1px solid #C8E6C9', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Paid</span>
                                  );
                                } else if (sale.status === 'PARTIAL' || collectedAmount > 0) {
                                  statusBadge = (
                                    <span className="va-badge" style={{ background: '#FFF3E0', color: '#E65100', border: '1px solid #FFE0B2', padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>Partial</span>
                                  );
                                }

                                return (
                                  <tr key={sale.id}>
                                    <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{sale.invoiceNo}</td>
                                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>{profile.client.clientId || 'WH-0000'}</td>
                                    <td style={{ fontWeight: 600 }}>{profile.client.name}</td>
                                    <td style={{ color: 'var(--muted)' }}>{fmtDateTime(sale.date)}</td>
                                    <td className="mono" style={{ textAlign: 'right', color: prevOutstanding > 0 ? 'var(--clay)' : 'var(--muted)' }}>{fmtMoney(prevOutstanding)}</td>
                                    <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmtMoney(currentOrder)}</td>
                                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(totalPayable)}</td>
                                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: payNow > 0 ? 'var(--ok)' : 'var(--muted)' }}>
                                      {payNow > 0 ? fmtMoney(payNow) : '—'}
                                    </td>
                                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: collectedAmount > 0 ? 'var(--ok)' : 'var(--muted)' }}>{fmtMoney(collectedAmount)}</td>
                                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: dueBalance > 0 ? 'var(--clay)' : 'var(--ok)' }}>{dueBalance > 0 ? fmtMoney(dueBalance) : '✓ 0'}</td>
                                    <td>{statusBadge}</td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card List View */}
                      <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                        {[...profile.sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(sale => {
                          const isPaid = sale.status === 'PAID' || sale.balance <= 0;
                          const isPartial = sale.status === 'PARTIAL' || (sale.paid > 0 && sale.balance > 0);
                          return (
                            <MobileCard
                              key={sale.id}
                              title={sale.invoiceNo}
                              headerBadge={fmtDateTime(sale.date)}
                            >
                              <MobileCardRow label="Order Amount" value={fmtMoney(sale.total)} isMono />
                              <MobileCardRow label="Amount Paid" value={fmtMoney(sale.paid)} valueColor="#166534" isMono />
                              <MobileCardRow label="Balance Due" value={fmtMoney(sale.balance)} valueColor={sale.balance > 0 ? '#991B1B' : '#166534'} isMono />
                              <MobileCardRow label="Status">
                                <MobileCardBadge variant={isPaid ? 'green' : isPartial ? 'yellow' : 'red'}>
                                  {isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'UNPAID'}
                                </MobileCardBadge>
                              </MobileCardRow>
                            </MobileCard>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Payments Tab */}
              {profTab === 'payments' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Payment History ({profile.collections.length})</h3></div>
                  {profile.collections.length === 0 ? (
                    <div className="va-empty"><div className="big">No payments received</div></div>
                  ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                        <table className="va-table">
                          <thead><tr><th>Date</th><th>Method</th><th>Notes</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                          <tbody>
                            {profile.collections.map(c => (
                              <tr key={c.id}>
                                <td>{fmtDate(c.date)}</td>
                                <td><span className="va-badge paid">{c.method}</span></td>
                                <td style={{ color: 'var(--muted)', fontSize: 12 }}>{c.notes ?? '—'}</td>
                                <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(c.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={3} style={{ fontWeight: 700 }}>Total Collected</td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(profile.totalCollected)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>

                      {/* Mobile Card List View */}
                      <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                        {profile.collections.map(c => (
                          <MobileCard
                            key={c.id}
                            title={`Payment via ${c.method}`}
                            headerBadge={fmtDate(c.date)}
                          >
                            <MobileCardRow label="Amount Collected" value={fmtMoney(c.amount)} valueColor="#166534" isMono />
                            <MobileCardRow label="Notes / Memo" value={c.notes ?? '—'} />
                          </MobileCard>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Deliveries Tab */}
              {profTab === 'deliveries' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Delivery History</h3></div>
                  {profile.deliveries.length === 0 ? (
                    <div className="va-empty"><div className="big">No deliveries yet</div></div>
                  ) : (
                    <>
                      {/* Desktop Table View */}
                      <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                        <table className="va-table">
                          <thead><tr><th>Date</th><th>Status</th><th>Notes</th></tr></thead>
                          <tbody>
                            {profile.deliveries.map(d => (
                              <tr key={d.id}>
                                <td>{fmtDate(d.createdAt)}</td>
                                <td><span className={`va-badge ${d.status === 'DELIVERED' ? 'paid' : d.status === 'OUT_FOR_DELIVERY' ? 'partial' : 'pending'}`}>{d.status.replace(/_/g,' ')}</span></td>
                                <td style={{ color: 'var(--muted)', fontSize: 12 }}>{d.notes ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Card List View */}
                      <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                        {profile.deliveries.map(d => {
                          const isDelivered = d.status === 'DELIVERED';
                          const isOut = d.status === 'OUT' || d.status === 'OUT_FOR_DELIVERY';
                          return (
                            <MobileCard
                              key={d.id}
                              title="Delivery Order"
                              headerBadge={fmtDate(d.createdAt)}
                            >
                              <MobileCardRow label="Status">
                                <MobileCardBadge variant={isDelivered ? 'green' : isOut ? 'blue' : 'yellow'}>
                                  {d.status.replace(/_/g, ' ')}
                                </MobileCardBadge>
                              </MobileCardRow>
                              <MobileCardRow label="Notes" value={d.notes ?? '—'} />
                            </MobileCard>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Broadcasts Tab */}
              {profTab === 'broadcasts' && (
                <div className="va-panel">
                  <div className="va-panel-head"><h3>WhatsApp Broadcast History</h3></div>
                  {!profile.broadcasts || profile.broadcasts.length === 0 ? (
                    <div className="va-empty"><div className="big">No broadcasts sent</div></div>
                  ) : (
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Broadcast Date</th>
                          <th>Image Thumbnail</th>
                          <th>Delivery Status</th>
                          <th>Sent Time</th>
                          <th style={{ textAlign: 'right' }}>Retry Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {profile.broadcasts.map(b => (
                          <tr key={b.id}>
                            <td style={{ fontWeight: 600 }}>{fmtDate(b.broadcast?.createdAt)}</td>
                            <td>
                              {b.broadcast?.imageUrl ? (
                                <a href={b.broadcast.imageUrl} target="_blank" rel="noopener noreferrer">
                                  <img 
                                    src={b.broadcast.imageUrl} 
                                    alt="Price list" 
                                    style={{ width: 60, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--line)', cursor: 'pointer' }}
                                    title="Click to view full image"
                                  />
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              <span className={`va-badge ${b.status === 'DELIVERED' ? 'paid' : b.status === 'PENDING' ? 'pending' : 'danger'}`}>
                                {b.status}
                              </span>
                              {b.errorMessage && (
                                <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{b.errorMessage}</div>
                              )}
                            </td>
                            <td>{fmtDateTime(b.updatedAt)}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>{b.attempts}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          ) : null}
        </>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/* VIEW: ADD / EDIT CLIENT FORM                       */}
      {/* ════════════════════════════════════════════════════ */}
      {(view === 'add' || view === 'edit') && (
        <>
          <div className="va-panel" style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="va-btn secondary small" onClick={() => setView('list')}>← Back</button>
              <h3 style={{ margin: 0 }}>{view === 'edit' ? '✏️ Edit Client' : '+ New Client'}</h3>
            </div>
          </div>

          <div className="va-panel">
            <form onSubmit={handleSave}>
              {/* Section: Business Info */}
              <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 10 }}>Business Information</div>
              <div className="va-form-row">
                <div className="va-field">
                  <label>Business Name *</label>
                  <input required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Al-Kareem Vegetables" />
                </div>
                <div className="va-field">
                  <label>Owner / Contact Person</label>
                  <input value={form.ownerName} onChange={e => setForm(p => ({ ...p, ownerName: e.target.value }))} placeholder="Muhammad Kareem" />
                </div>
                <div className="va-field">
                  <label>Client Type</label>
                  <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    {CLIENT_TYPES.map(t => <option key={t} value={t}>{TYPE_EMOJI[t]} {t}</option>)}
                  </select>
                </div>
              </div>

              {/* Section: Contact */}
              <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 10, marginTop: 20 }}>Contact Details</div>
              <div className="va-form-row">
                <div className="va-field">
                  <label>Phone Number</label>
                  <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="0300-0000000" />
                </div>
                <div className="va-field">
                  <label>WhatsApp Number</label>
                  <input value={form.whatsapp} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))} placeholder="0300-0000000 (if different)" />
                </div>
              </div>
              <div className="va-form-row">
                <div className="va-field">
                  <label>Full Address</label>
                  <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Block 5, PECHS, Karachi" />
                </div>
                <div className="va-field">
                  <label>Delivery Location / Area</label>
                  <input value={form.deliveryLocation} onChange={e => setForm(p => ({ ...p, deliveryLocation: e.target.value }))} placeholder="Near Main Market, PECHS" />
                </div>
              </div>

              {/* Section: Financial */}
              <div style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '.06em', marginBottom: 10, marginTop: 20 }}>Financial Settings</div>
              <div className="va-form-row">
                <div className="va-field">
                  <label>Credit Limit (Rs)</label>
                  <input type="number" min="0" value={form.creditLimit} onChange={e => setForm(p => ({ ...p, creditLimit: +e.target.value }))} />
                </div>
                <div className="va-field">
                  <label>Payment Terms</label>
                  <select value={form.paymentTerms} onChange={e => setForm(p => ({ ...p, paymentTerms: +e.target.value }))}>
                    {PAYMENT_TERMS.map(pt => <option key={pt.val} value={pt.val}>{pt.label}</option>)}
                  </select>
                </div>
                <div className="va-field">
                  <label>Opening Balance (Rs)</label>
                  <input type="number" value={form.openingBalance} onChange={e => setForm(p => ({ ...p, openingBalance: +e.target.value }))} />
                </div>
                <div className="va-field">
                  <label>Initial Risk Rating</label>
                  <select value={form.rating} onChange={e => setForm(p => ({ ...p, rating: e.target.value }))}>
                    {['GREEN','YELLOW','ORANGE','RED','NEW'].map(r => <option key={r} value={r}>{RATING_EMOJI[r]} {r}</option>)}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div className="va-field" style={{ marginTop: 16 }}>
                <label>Internal Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Any special notes about this client…"
                  rows={3}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
                <button type="submit" className="va-btn" disabled={saving}>
                  {saving ? 'Saving…' : (view === 'edit' ? '✓ Update Client' : '✓ Add Client')}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
      {statementClient && (
        <DueStatementModal
          client={statementClient}
          invoices={statementInvoices}
          mode={statementMode}
          onClose={() => setStatementClient(null)}
        />
      )}
    </DashboardLayout>
  );
}
