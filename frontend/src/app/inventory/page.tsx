'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDateTime } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import Icon from '@mdi/react';
import { mdiArchive, mdiHistory, mdiTune, mdiDeleteOutline, mdiArrowUpBold, mdiArrowDownBold } from '@mdi/js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InventoryItem {
  id: string;
  productId: string;
  qty: number;
  reservedQty?: number;
  availableQty: number;
  avgCost: number;
  currentBuyPrice: number;
  previousBuyPrice: number;
  lastPurchaseDate?: string;
  lastPurchaseQty?: number;
  totalValue: number;
  stockStatus: 'OK' | 'LOW' | 'OUT_OF_STOCK';
  product: {
    id: string; name: string; urduName?: string;
    category?: string; defaultUnit: string; minStock: number; availability: string;
  };
}

interface InventorySummary {
  totalProducts: number;
  totalQty: number;
  totalAvailableQty: number;
  lowStockCount: number;
  outOfStockCount: number;
  totalValue: number;
  todayStockIn: number;
  todayStockOut: number;
  todayWastage: number;
}

interface PriceHistoryEntry {
  id: string;
  date: string;
  productId: string;
  buyPrice: number;
  qty: number;
  product?: { name: string; urduName?: string; defaultUnit: string };
  supplier?: { name: string };
}

interface Movement {
  id: string;
  date: string;
  productId: string;
  productName: string;
  productUrdu: string;
  unit: string;
  type: string;
  qty: number;
  previousStock: number;
  newStock: number;
  stockIn: number;
  stockOut: number;
  refType: string;
  refId: string;
  userName?: string;
  note: string;
}

type View = 'list' | 'wastage' | 'adjust' | 'movements' | 'priceHistory';

const UNITS = ['KG','G','DOZEN','PIECE','BOX','CRATE','LITRE','BUNDLE','TRAY'];
const WASTAGE_REASONS = [
  'Rotten / Spoiled',
  'Physical Damage',
  'Expired',
  'Lost / Stolen',
  'Quality Issue',
  'Returned to Supplier',
  'Other',
];

const ADJUSTMENT_REASONS = [
  'Physical Verification Correction',
  'Opening Stock Entry',
  'Inventory Damage Correction',
  'Warehouse Stock Relocation',
  'Supplier Stock Return',
  'System Reconciliation',
  'Other',
];

// ── Helper ────────────────────────────────────────────────────────────────────
function fmtQty(qty: number, unit = 'KG') {
  return `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${unit}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const [view, setView] = useState<View>('list');
  const [inventory, setInventory] = useState<InventoryItem[]>(() => {
    const cached = getCachedData<any>('/api/inventory');
    return cached?.data ?? cached ?? [];
  });
  const [summary, setSummary] = useState<InventorySummary | null>(() => {
    const cached = getCachedData<any>('/api/inventory');
    return cached?.summary ?? null;
  });
  const [movements, setMovements] = useState<Movement[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [histProdId, setHistProdId] = useState<string>('');

  const [loading, setLoading] = useState(() => {
    return !getCachedData<any>('/api/inventory');
  });
  const [movLoad, setMovLoad] = useState(false);
  const [histLoad, setHistLoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');

  // Wastage form
  const [wProdId, setWProdId] = useState('');
  const [wQty, setWQty] = useState<number>(0);
  const [wUnit, setWUnit] = useState('KG');
  const [wReason, setWReason] = useState(WASTAGE_REASONS[0]);
  const [wRemarks, setWRemarks] = useState('');
  const [wDate, setWDate] = useState('');

  // Adjust form
  const [aProdId, setAProdId] = useState('');
  const [aType, setAType] = useState<'SET' | 'INCREASE' | 'DECREASE'>('SET');
  const [aQtyVal, setAQtyVal] = useState<number | ''>('');
  const [aReason, setAReason] = useState(ADJUSTMENT_REASONS[0]);
  const [aRemarks, setARemarks] = useState('');
  const [aSysQty, setASysQty] = useState<number>(0);

  // Movements filters
  const [mProdId, setMProdId] = useState('');
  const [mType, setMType] = useState('all');
  const [mFrom, setMFrom] = useState('');
  const [mTo, setMTo] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Load inventory ──────────────────────────────────────────────────────────
  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && inventory.length === 0) setLoading(true);
    try {
      const data = await fetchWithCache<any>('/api/inventory', { ttl: TTL_SHORT, forceRefresh: isBackground });
      if (data) {
        setInventory(data.data ?? []);
        setSummary(data.summary ?? null);
      }
    } catch (err) {
      console.error('inventory load error:', err);
    } finally { setLoading(false); }
  }, [inventory.length]);

  useEffect(() => { load(); }, [load]);

  // ── Load movements ──────────────────────────────────────────────────────────
  const loadMovements = useCallback(async (isBackground = false) => {
    setMovLoad(true);
    try {
      const p = new URLSearchParams({ limit: '300' });
      if (mProdId) p.set('productId', mProdId);
      if (mType !== 'all') p.set('type', mType);
      if (mFrom) p.set('from', mFrom);
      if (mTo) p.set('to', mTo);
      const data = await fetchWithCache<any[]>(`/api/inventory/movements?${p}`, { ttl: TTL_MEDIUM, forceRefresh: isBackground });
      if (data) setMovements(data);
      else showToast('❌ Failed to load movements');
    } catch (err) {
      console.error('loadMovements error:', err);
    } finally { setMovLoad(false); }
  }, [mProdId, mType, mFrom, mTo]);

  // ── Load Price History ──────────────────────────────────────────────────────
  const loadPriceHistory = useCallback(async (prodId?: string) => {
    setHistLoad(true);
    try {
      const url = prodId ? `/api/inventory/price-history?productId=${prodId}` : '/api/inventory/price-history';
      const data = await fetchWithCache<any>(url, { ttl: TTL_SHORT, forceRefresh: true });
      setPriceHistory(data.data ?? data ?? []);
    } catch (err) {
      console.error('price history load error:', err);
    } finally { setHistLoad(false); }
  }, []);

  useEffect(() => {
    const handleRevalidate = () => {
      load(true);
      if (view === 'movements') loadMovements(true);
      if (view === 'priceHistory') loadPriceHistory(histProdId);
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [load, view, loadMovements, loadPriceHistory, histProdId]);

  // ── Wastage submit ──────────────────────────────────────────────────────────
  const handleWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wProdId) return showToast('❌ Select a product');
    if (!wQty || wQty <= 0) return showToast('❌ Quantity must be > 0');
    const inv = inventory.find(i => i.productId === wProdId);
    if (inv && wQty > inv.qty) return showToast(`❌ Qty (${wQty}) exceeds stock (${inv.qty.toFixed(2)})`);
    setSaving(true);
    try {
      const res = await apiFetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: wProdId,
          itemName: inv?.product?.name ?? '',
          qty: wQty,
          unit: wUnit,
          reason: wReason,
          remarks: wRemarks,
          date: wDate || undefined
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/reports');
        showToast(`✅ Wastage recorded — ${data.data?.refNo ?? ''}`);
        setWProdId(''); setWQty(0); setWRemarks(''); setWDate('');
        await load(true); setView('list');
      } else showToast('❌ ' + (data.error ?? 'Failed'));
    } finally { setSaving(false); }
  };

  // ── Adjust submit ───────────────────────────────────────────────────────────
  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aProdId) return showToast('❌ Select a product');
    if (aQtyVal === '') return showToast('❌ Enter quantity');
    if (Number(aQtyVal) < 0) return showToast('❌ Quantity cannot be negative');
    setSaving(true);
    try {
      const res = await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: aProdId,
          adjustedQty: Number(aQtyVal),
          adjustmentType: aType,
          reason: aReason,
          remarks: aRemarks
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/reports');
        const { refNo, delta, newQty } = data.data;
        showToast(`✅ Stock adjusted — ${refNo} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} → New: ${newQty.toFixed(2)})`);
        setAProdId(''); setAQtyVal(''); setARemarks(''); setASysQty(0);
        await load(true); setView('list');
      } else showToast('❌ ' + (data.error ?? 'Failed'));
    } finally { setSaving(false); }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const filtered = inventory.filter(i =>
    !search ||
    i.product?.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.product?.urduName ?? '').includes(search)
  );

  const typeColors: Record<string, string> = {
    PURCHASE: '#1F3D2B',
    SALE: '#2B5C8A',
    WASTAGE: '#8A2B2B',
    ADJUSTMENT: '#7C5C1F',
    TRANSFER_IN: '#2B5C8A',
    TRANSFER_OUT: '#8A4A1F',
    OPENING: '#3A3A6B',
  };
  const typeLabels: Record<string, string> = {
    PURCHASE: '📦 Purchase', SALE: '🧾 Sale', WASTAGE: '🗑 Wastage',
    ADJUSTMENT: '⚙ Adjustment', TRANSFER_IN: '↓ Transfer In',
    TRANSFER_OUT: '↑ Transfer Out', OPENING: '🔓 Opening',
  };

  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 4px 20px rgba(0,0,0,.2)' }}>
          {toast}
        </div>
      )}

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <div className="va-panel" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiArchive} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Inventory Hub</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Single Source of Truth — Live Stock, Buy Prices, Price History, Adjustments &amp; Wastage
            </p>
          </div>
          {view === 'list' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="va-btn secondary small" onClick={() => { setView('priceHistory'); loadPriceHistory(); }} style={{ fontWeight: 700 }}>
                <Icon path={mdiHistory} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Buy Price History
              </button>
              <button className="va-btn secondary small" onClick={() => { setView('movements'); loadMovements(); }} style={{ fontWeight: 700 }}>
                📋 Movements
              </button>
              <button className="va-btn secondary small" onClick={() => { setAProdId(''); setAQtyVal(''); setARemarks(''); setASysQty(0); setView('adjust'); load(true); }} style={{ fontWeight: 700 }}>
                <Icon path={mdiTune} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Adjust Stock
              </button>
              <button className="va-btn" onClick={() => { setWProdId(''); setWQty(0); setWRemarks(''); setView('wastage'); load(true); }}>
                <Icon path={mdiDeleteOutline} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Record Wastage
              </button>
            </div>
          )}
          {view !== 'list' && (
            <button className="va-btn secondary small" onClick={() => setView('list')}>← Back to Stock Hub</button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: DASHBOARD + CURRENT STOCK HUB                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <>
          {/* KPI Cards */}
          {summary && (
            <div className="va-cards">
              <div className="va-card accent">
                <div className="label">Total Products</div>
                <div className="value">{summary.totalProducts}</div>
                <div className="foot">active catalog items</div>
              </div>
              <div className="va-card">
                <div className="label">Total Available Qty</div>
                <div className="value" style={{ color: 'var(--primary)' }}>{summary.totalAvailableQty.toFixed(1)}</div>
                <div className="foot">units available for sale</div>
              </div>
              <div className="va-card">
                <div className="label">Stock Value</div>
                <div className="value" style={{ color: 'var(--forest)' }}>{fmtMoney(summary.totalValue)}</div>
                <div className="foot">at current buy price</div>
              </div>
              <div className="va-card">
                <div className="label">Low Stock Alert</div>
                <div className="value" style={{ color: summary.lowStockCount > 0 ? 'var(--mustard)' : 'var(--ok)' }}>{summary.lowStockCount}</div>
                <div className="foot">items need restocking</div>
              </div>
              <div className="va-card">
                <div className="label">Out of Stock</div>
                <div className="value" style={{ color: summary.outOfStockCount > 0 ? 'var(--danger)' : 'var(--ok)' }}>{summary.outOfStockCount}</div>
                <div className="foot">zero quantity items</div>
              </div>
              <div className="va-card">
                <div className="label">Today Stock In</div>
                <div className="value" style={{ color: 'var(--ok)' }}>+{summary.todayStockIn.toFixed(1)}</div>
                <div className="foot">purchased today</div>
              </div>
              <div className="va-card">
                <div className="label">Today Stock Out</div>
                <div className="value" style={{ color: 'var(--clay)' }}>-{summary.todayStockOut.toFixed(1)}</div>
                <div className="foot">sold today</div>
              </div>
            </div>
          )}

          {/* Low Stock Alert Banner */}
          {(summary?.lowStockCount ?? 0) + (summary?.outOfStockCount ?? 0) > 0 && (
            <div className="va-panel" style={{ borderLeft: '4px solid var(--danger)', padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: 13, marginBottom: 8 }}>⚠ Stock Alert</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {inventory.filter(i => i.stockStatus !== 'OK').map(i => (
                  <span key={i.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                    background: i.stockStatus === 'OUT_OF_STOCK' ? '#F5E1DE' : '#FEF3D4',
                    color: i.stockStatus === 'OUT_OF_STOCK' ? 'var(--danger)' : 'var(--mustard)',
                    border: `1px solid currentColor`,
                  }}>
                    {i.stockStatus === 'OUT_OF_STOCK' ? '❌' : '⚠'} {i.product?.name} · Available: {fmtQty(i.availableQty, i.product?.defaultUnit)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search + Central Stock Hub Table */}
          <div className="va-panel">
            <div className="va-panel-head">
              <h3>Central Stock Hub (Single Source of Truth)</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 Search product…"
                  style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, width: 220 }}
                />
                <button className="va-btn secondary small" onClick={() => load()}>↻ Refresh</button>
              </div>
            </div>

            {loading && inventory.length === 0 ? <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={7} /></div>
            : filtered.length === 0 ? (
              <div className="va-empty">
                <div className="big">No inventory stock found</div>
                <div>Record purchases to automatically populate stock hub</div>
              </div>
            ) : (
              <>
                {/* Desktop View Table */}
                <div className="hide-mobile" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table className="va-table" style={{ minWidth: 850 }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Product Name</th>
                        <th>Urdu Name</th>
                        <th>Unit</th>
                        <th style={{ textAlign: 'right' }}>Total Stock</th>
                        <th style={{ textAlign: 'right', color: 'var(--primary)' }}>Available Qty</th>
                        <th style={{ textAlign: 'right' }}>Prev Buy Price</th>
                        <th style={{ textAlign: 'right', color: 'var(--forest)' }}>Current Buy Price</th>
                        <th style={{ textAlign: 'right' }}>Avg Cost</th>
                        <th style={{ textAlign: 'right' }}>Stock Value</th>
                        <th style={{ textAlign: 'center' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((i, idx) => {
                        const sc = i.stockStatus === 'OUT_OF_STOCK'
                          ? { bg: '#FFF5F5', badge: 'var(--danger)', label: 'Out of Stock' }
                          : i.stockStatus === 'LOW'
                          ? { bg: '#FFFBF0', badge: '#B87333', label: 'Low Stock' }
                          : { bg: undefined, badge: 'var(--ok)', label: 'Available' };

                        const priceDiff = i.currentBuyPrice - i.previousBuyPrice;

                        return (
                          <tr key={i.id} style={{ background: sc.bg }}>
                            <td className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                            <td style={{ fontWeight: 700 }}>
                              {i.product?.name}
                              {i.lastPurchaseDate && (
                                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>
                                  Last buy: {new Date(i.lastPurchaseDate).toLocaleDateString('en-GB')} ({i.lastPurchaseQty ?? 0} {i.product?.defaultUnit})
                                </div>
                              )}
                            </td>
                            <td style={{ fontSize: 14, color: 'var(--muted)', fontFamily: 'serif' }}>{i.product?.urduName ?? '—'}</td>
                            <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i.product?.defaultUnit ?? 'KG'}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: i.qty <= 0 ? 'var(--danger)' : undefined }}>
                              {i.qty.toFixed(2)}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--primary)' }}>
                              {i.availableQty.toFixed(2)}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                              {i.previousBuyPrice > 0 ? `Rs ${i.previousBuyPrice.toFixed(2)}` : '—'}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--forest)' }}>
                              {i.currentBuyPrice > 0 ? `Rs ${i.currentBuyPrice.toFixed(2)}` : `Rs ${i.avgCost.toFixed(2)}`}
                              {i.previousBuyPrice > 0 && priceDiff !== 0 && (
                                <span style={{ fontSize: 10, marginLeft: 4, color: priceDiff > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                                  ({priceDiff > 0 ? `+${priceDiff.toFixed(1)}` : priceDiff.toFixed(1)})
                                </span>
                              )}
                            </td>
                            <td className="mono" style={{ textAlign: 'right' }}>Rs {i.avgCost.toFixed(2)}</td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--forest)' }}>{fmtMoney(i.totalValue)}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', fontSize: 11, fontWeight: 700,
                                padding: '3px 9px', borderRadius: 10,
                                background: sc.badge + '22', color: sc.badge,
                                border: `1px solid ${sc.badge}44`,
                              }}>{sc.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#1F3D2B', color: '#fff', fontWeight: 700 }}>
                        <td colSpan={5} style={{ color: '#fff', fontWeight: 700 }}>Total Stock Value ({filtered.length} products)</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#90CAF9', fontWeight: 800 }}>
                          {filtered.reduce((s, i) => s + i.availableQty, 0).toFixed(1)}
                        </td>
                        <td colSpan={3}></td>
                        <td className="mono" style={{ textAlign: 'right', color: '#6FD89A', fontWeight: 800, fontSize: 15 }}>
                          {fmtMoney(filtered.reduce((s, i) => s + i.totalValue, 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile View Cards */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%', marginTop: '14px' }}>
                  {filtered.map(i => {
                    const sc = i.stockStatus === 'OUT_OF_STOCK'
                      ? { badge: 'red' as const, label: 'Out of Stock' }
                      : i.stockStatus === 'LOW'
                      ? { badge: 'yellow' as const, label: 'Low Stock' }
                      : { badge: 'green' as const, label: 'Available' };
                    return (
                      <MobileCard
                        key={i.id}
                        title={i.product?.name ?? 'Product'}
                        headerBadge={i.product?.urduName || (i.product?.defaultUnit ?? 'KG')}
                      >
                        <MobileCardRow label="Total Stock" value={`${i.qty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} isMono />
                        <MobileCardRow label="Available Qty" value={`${i.availableQty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} valueColor="var(--primary)" isMono />
                        <MobileCardRow label="Current Buy Price" value={i.currentBuyPrice > 0 ? `Rs ${i.currentBuyPrice.toFixed(2)}` : '—'} isMono />
                        <MobileCardRow label="Previous Buy Price" value={i.previousBuyPrice > 0 ? `Rs ${i.previousBuyPrice.toFixed(2)}` : '—'} isMono />
                        <MobileCardRow label="Stock Value" value={fmtMoney(i.totalValue)} valueColor="#166534" isMono />
                        <MobileCardRow label="Status">
                          <MobileCardBadge variant={sc.badge}>{sc.label}</MobileCardBadge>
                        </MobileCardRow>
                      </MobileCard>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: PURCHASE BUY PRICE HISTORY                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'priceHistory' && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3><Icon path={mdiHistory} size={0.8} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Purchase Buy Price History</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={histProdId} onChange={e => { setHistProdId(e.target.value); loadPriceHistory(e.target.value); }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13 }}>
                <option value="">All Products</option>
                {inventory.map(i => <option key={i.productId} value={i.productId}>{i.product?.name}</option>)}
              </select>
              <button className="va-btn secondary small" onClick={() => loadPriceHistory(histProdId)}>↻ Refresh</button>
            </div>
          </div>

          {histLoad ? <div className="va-loading">Loading price history…</div>
          : priceHistory.length === 0 ? (
            <div className="va-empty">
              <div className="big">No purchase price history recorded</div>
              <div>Historical buy prices will accumulate automatically as purchases are created</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead>
                  <tr>
                    <th>Purchase Date</th>
                    <th>Product Name</th>
                    <th>Supplier</th>
                    <th style={{ textAlign: 'right' }}>Buy Price (Rs)</th>
                    <th style={{ textAlign: 'right' }}>Purchase Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map(entry => (
                    <tr key={entry.id}>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(entry.date)}</td>
                      <td style={{ fontWeight: 700 }}>{entry.product?.name ?? '—'}</td>
                      <td>{entry.supplier?.name ?? 'Mandi / Direct'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--forest)' }}>
                        Rs {entry.buyPrice.toFixed(2)}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {entry.qty.toFixed(2)} {entry.product?.defaultUnit ?? 'KG'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: RECORD WASTAGE                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'wastage' && (
        <div className="va-panel" style={{ maxWidth: 640 }}>
          <div className="va-panel-head"><h3>🗑 Record Stock Wastage</h3></div>
          <form onSubmit={handleWastage}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Product *</label>
                <select value={wProdId} onChange={e => {
                  setWProdId(e.target.value);
                  const inv = inventory.find(i => i.productId === e.target.value);
                  if (inv) setWUnit(inv.product?.defaultUnit ?? 'KG');
                }} required>
                  <option value="">— Select product —</option>
                  {[...inventory].sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '')).map(i => (
                    <option key={i.productId} value={i.productId}>
                      {i.product?.name ?? 'Product'} (Stock: {i.qty.toFixed(2)} {i.product?.defaultUnit ?? 'KG'})
                    </option>
                  ))}
                </select>
                {wProdId && (() => {
                  const inv = inventory.find(i => i.productId === wProdId);
                  return inv ? <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'block' }}>Current stock: {inv.qty.toFixed(2)} {inv.product?.defaultUnit}</span> : null;
                })()}
              </div>
              <div className="va-field">
                <label>Quantity Wasted *</label>
                <input type="number" required min="0.01" step="0.01"
                  value={wQty || ''} onChange={e => setWQty(+e.target.value)} />
                {wProdId && wQty > 0 && (() => {
                  const inv = inventory.find(i => i.productId === wProdId);
                  if (inv && wQty > inv.qty) return (
                    <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 700, marginTop: 2, display: 'block' }}>
                      ⚠ Exceeds current stock ({inv.qty.toFixed(2)})
                    </span>
                  );
                  return null;
                })()}
              </div>
            </div>
            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Unit</label>
                <select value={wUnit} onChange={e => setWUnit(e.target.value)}>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </div>
              <div className="va-field">
                <label>Reason *</label>
                <select value={wReason} onChange={e => setWReason(e.target.value)}>
                  {WASTAGE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Remarks / Notes</label>
                <input value={wRemarks} onChange={e => setWRemarks(e.target.value)}
                  placeholder="Additional details regarding wastage…" />
              </div>
              <div className="va-field">
                <label>Date (optional)</label>
                <input type="datetime-local" value={wDate} onChange={e => setWDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : '✓ Record Wastage'}</button>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: MANUAL STOCK ADJUSTMENT                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'adjust' && (
        <div className="va-panel" style={{ maxWidth: 640 }}>
          <div className="va-panel-head"><h3>⚙ Manual Stock Adjustment</h3></div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>
            Adjust inventory count. Every adjustment records previous stock, new stock, and user details in the Stock Movement audit log.
          </p>
          <form onSubmit={handleAdjust}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Product *</label>
                <select value={aProdId} onChange={e => {
                  setAProdId(e.target.value);
                  const inv = inventory.find(i => i.productId === e.target.value);
                  setASysQty(inv?.qty ?? 0);
                  setAQtyVal('');
                }} required>
                  <option value="">— Select product —</option>
                  {[...inventory].sort((a, b) => (a.product?.name ?? '').localeCompare(b.product?.name ?? '')).map(i => (
                    <option key={i.productId} value={i.productId}>
                      {i.product?.name ?? 'Product'} (System: {i.qty.toFixed(2)} {i.product?.defaultUnit ?? 'KG'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="va-field">
                <label>Adjustment Mode *</label>
                <select value={aType} onChange={e => setAType(e.target.value as any)}>
                  <option value="SET">Physical Count Correction (Set Total)</option>
                  <option value="INCREASE">Increase Stock (+ Add Qty)</option>
                  <option value="DECREASE">Decrease Stock (- Deduct Qty)</option>
                </select>
              </div>
            </div>

            {aProdId && (
              <>
                <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(31,61,43,0.07)', borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>SYSTEM STOCK</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--forest)', fontFamily: 'monospace' }}>{aSysQty.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{inventory.find(i => i.productId === aProdId)?.product?.defaultUnit ?? 'KG'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: 'var(--muted)' }}>→</div>
                  <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(43,91,138,0.07)', borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>
                      {aType === 'SET' ? 'NEW PHYSICAL COUNT' : aType === 'INCREASE' ? 'ADD QUANTITY' : 'DEDUCT QUANTITY'}
                    </div>
                    <input
                      type="number" min="0" step="0.01" required
                      value={aQtyVal}
                      onChange={e => setAQtyVal(e.target.value === '' ? '' : +e.target.value)}
                      style={{ width: '100%', fontSize: 22, fontWeight: 800, fontFamily: 'monospace', border: 'none', background: 'transparent', color: 'var(--forest)', outline: 'none' }}
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="va-form-row">
                  <div className="va-field">
                    <label>Reason *</label>
                    <select value={aReason} onChange={e => setAReason(e.target.value)}>
                      {ADJUSTMENT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label>Remarks / Notes</label>
                    <input value={aRemarks} onChange={e => setARemarks(e.target.value)}
                      placeholder="Additional notes for stock adjustment log…" />
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="submit" className="va-btn" disabled={saving || !aProdId || aQtyVal === ''}>
                {saving ? 'Saving…' : '⚙ Apply Stock Adjustment'}
              </button>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: STOCK MOVEMENTS HISTORY                                          */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'movements' && (
        <>
          {/* Movements Header */}
          <div className="va-panel" style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={mProdId} onChange={e => setMProdId(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, flex: 2, minWidth: 160 }}>
                <option value="">All Products</option>
                {inventory.map(i => <option key={i.productId} value={i.productId}>{i.product?.name}</option>)}
              </select>
              <select value={mType} onChange={e => setMType(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Types</option>
                {['PURCHASE','SALE','WASTAGE','ADJUSTMENT','OPENING'].map(t => <option key={t}>{t}</option>)}
              </select>
              <input type="date" value={mFrom} onChange={e => setMFrom(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
              <input type="date" value={mTo} onChange={e => setMTo(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} />
              <button className="va-btn secondary small" onClick={() => loadMovements()}>Apply</button>
              <button className="va-btn secondary small" onClick={() => loadMovements()}>↻ Refresh</button>
            </div>
          </div>

          <div className="va-panel">
            {movLoad ? <div className="va-loading">Loading movements…</div>
            : movements.length === 0 ? (
              <div className="va-empty">
                <div className="big">No stock movements found</div>
                <div>Try adjusting the filters or date range</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ minWidth: 800 }}>
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'center' }}>Type</th>
                      <th style={{ textAlign: 'right' }}>Prev Stock</th>
                      <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Stock In</th>
                      <th style={{ textAlign: 'right', color: 'var(--danger)' }}>Stock Out</th>
                      <th style={{ textAlign: 'right' }}>New Stock</th>
                      <th>User</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map(m => (
                      <tr key={m.id}>
                        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(m.date)}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{m.productName}</div>
                          {m.productUrdu && <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'serif' }}>{m.productUrdu}</div>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', fontSize: 11, fontWeight: 700,
                            padding: '3px 8px', borderRadius: 8,
                            background: (typeColors[m.type] ?? '#555') + '22',
                            color: typeColors[m.type] ?? '#555',
                            border: `1px solid ${(typeColors[m.type] ?? '#555')}44`,
                            whiteSpace: 'nowrap',
                          }}>{typeLabels[m.type] ?? m.type}</span>
                        </td>
                        <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                          {m.previousStock?.toFixed(2) ?? '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok)' }}>
                          {m.stockIn > 0 ? `+${m.stockIn.toFixed(2)} ${m.unit}` : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                          {m.stockOut > 0 ? `-${m.stockOut.toFixed(2)} ${m.unit}` : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 800 }}>
                          {m.newStock?.toFixed(2) ?? '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {m.userName ?? 'System'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 260 }}>
                          <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {m.note || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: '10px 16px', color: 'var(--muted)', fontSize: 12 }}>
                  Showing {movements.length} movements
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
