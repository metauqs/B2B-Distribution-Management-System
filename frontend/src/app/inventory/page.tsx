'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDateTime } from '@/utils/formatters';
import Icon from '@mdi/react';
import { mdiArchive } from '@mdi/js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InventoryItem {
  id: string;
  productId: string;
  qty: number;
  avgCost: number;
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
  lowStockCount: number;
  outOfStockCount: number;
  totalValue: number;
  todayStockIn: number;
  todayStockOut: number;
  todayWastage: number;
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
  stockIn: number;
  stockOut: number;
  refType: string;
  refId: string;
  note: string;
}

type View = 'list' | 'wastage' | 'adjust' | 'movements';

const UNITS = ['KG','G','DOZEN','PIECE','BOX','CRATE','LITRE','BUNDLE','TRAY'];

// ── Helper ────────────────────────────────────────────────────────────────────
function fmtQty(qty: number, unit = 'KG') {
  return `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${unit}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const [view,      setView]      = useState<View>('list');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [summary,   setSummary]   = useState<InventorySummary | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [movLoad,   setMovLoad]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');
  const [search,    setSearch]    = useState('');

  // Wastage form
  const [wProdId,  setWProdId]  = useState('');
  const [wQty,     setWQty]     = useState<number>(0);
  const [wUnit,    setWUnit]    = useState('KG');
  const [wReason,  setWReason]  = useState('');
  const [wDate,    setWDate]    = useState('');

  // Adjust form
  const [aProdId,  setAProdId]  = useState('');
  const [aPhysQty, setAPhysQty] = useState<number | ''>('');
  const [aReason,  setAReason]  = useState('');
  const [aSysQty,  setASysQty]  = useState<number>(0);

  // Movements filters
  const [mProdId,  setMProdId]  = useState('');
  const [mType,    setMType]    = useState('all');
  const [mFrom,    setMFrom]    = useState('');
  const [mTo,      setMTo]      = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Load inventory ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/inventory');
      const data = await res.json();
      if (data.success) {
        setInventory(data.data ?? []);
        setSummary(data.summary ?? null);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Load movements ──────────────────────────────────────────────────────────
  const loadMovements = useCallback(async () => {
    setMovLoad(true);
    try {
      const p = new URLSearchParams({ limit: '300' });
      if (mProdId)           p.set('productId', mProdId);
      if (mType !== 'all')   p.set('type', mType);
      if (mFrom)             p.set('from', mFrom);
      if (mTo)               p.set('to', mTo);
      const res  = await fetch(`/api/inventory/movements?${p}`);
      const data = await res.json();
      if (data.success) setMovements(data.data ?? []);
      else showToast('❌ Failed to load movements');
    } finally { setMovLoad(false); }
  }, [mProdId, mType, mFrom, mTo]);

  // ── Wastage submit ──────────────────────────────────────────────────────────
  const handleWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wProdId)     return showToast('❌ Select a product');
    if (!wQty || wQty <= 0) return showToast('❌ Quantity must be > 0');
    const inv = inventory.find(i => i.productId === wProdId);
    if (inv && wQty > inv.qty) return showToast(`❌ Qty (${wQty}) exceeds stock (${inv.qty.toFixed(2)})`);
    setSaving(true);
    try {
      const res  = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: wProdId, itemName: inv?.product?.name ?? '', qty: wQty, unit: wUnit, reason: wReason, date: wDate || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Wastage recorded — ${data.data?.refNo ?? ''}`);
        setWProdId(''); setWQty(0); setWReason(''); setWDate('');
        load(); setView('list');
      } else showToast('❌ ' + (data.error ?? 'Failed'));
    } finally { setSaving(false); }
  };

  // ── Adjust submit ───────────────────────────────────────────────────────────
  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aProdId)           return showToast('❌ Select a product');
    if (aPhysQty === '')    return showToast('❌ Enter physical count');
    if (Number(aPhysQty) < 0) return showToast('❌ Physical count cannot be negative');
    setSaving(true);
    try {
      const res  = await fetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: aProdId, adjustedQty: Number(aPhysQty), reason: aReason }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const { refNo, delta } = data.data;
        showToast(`✅ Stock adjusted — ${refNo} (${delta >= 0 ? '+' : ''}${delta})`);
        setAProdId(''); setAPhysQty(''); setAReason(''); setASysQty(0);
        load(); setView('list');
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
    PURCHASE:   '#1F3D2B',
    SALE:       '#2B5C8A',
    WASTAGE:    '#8A2B2B',
    ADJUSTMENT: '#7C5C1F',
    TRANSFER_IN:'#2B5C8A',
    TRANSFER_OUT:'#8A4A1F',
    OPENING:    '#3A3A6B',
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
              <h2 style={{ margin: 0 }}>Inventory</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Real-time stock tracking — Purchases, Sales, Wastage &amp; Adjustments</p>
          </div>
          {view === 'list' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="va-btn secondary small" onClick={() => { setView('movements'); loadMovements(); }} style={{ fontWeight: 700 }}>📋 Movements</button>
              <button className="va-btn secondary small" onClick={() => { setAProdId(''); setAPhysQty(''); setAReason(''); setASysQty(0); setView('adjust'); }} style={{ fontWeight: 700 }}>⚙ Adjust Stock</button>
              <button className="va-btn" onClick={() => { setWProdId(''); setWQty(0); setWReason(''); setView('wastage'); }}>🗑 Record Wastage</button>
            </div>
          )}
          {view !== 'list' && (
            <button className="va-btn secondary small" onClick={() => setView('list')}>← Back to Stock</button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: DASHBOARD + CURRENT STOCK                                       */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'list' && (
        <>
          {/* KPI Cards */}
          {summary && (
            <div className="va-cards">
              <div className="va-card accent">
                <div className="label">Total Products</div>
                <div className="value">{summary.totalProducts}</div>
                <div className="foot">in inventory</div>
              </div>
              <div className="va-card">
                <div className="label">Estimated Value</div>
                <div className="value" style={{ color: 'var(--forest)' }}>{fmtMoney(summary.totalValue)}</div>
                <div className="foot">at avg cost</div>
              </div>
              <div className="va-card">
                <div className="label">Low Stock</div>
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
                <div className="foot">units received today</div>
              </div>
              <div className="va-card">
                <div className="label">Today Stock Out</div>
                <div className="value" style={{ color: 'var(--clay)' }}>-{summary.todayStockOut.toFixed(1)}</div>
                <div className="foot">units sold today</div>
              </div>
              <div className="va-card">
                <div className="label">Today Wastage</div>
                <div className="value" style={{ color: summary.todayWastage > 0 ? '#8A2B2B' : 'var(--muted)' }}>{summary.todayWastage > 0 ? `-${summary.todayWastage.toFixed(1)}` : '0'}</div>
                <div className="foot">units wasted today</div>
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
                    {i.stockStatus === 'OUT_OF_STOCK' ? '❌' : '⚠'} {i.product?.name} · {fmtQty(i.qty, i.product?.defaultUnit)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search + Current Stock Table */}
          <div className="va-panel">
            <div className="va-panel-head">
              <h3>Current Stock</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="🔍 Search product…"
                  style={{ padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, width: 200 }}
                />
                <button className="va-btn secondary small" onClick={load}>↻ Refresh</button>
              </div>
            </div>

            {loading ? <div className="va-loading">Loading inventory…</div>
            : filtered.length === 0 ? (
              <div className="va-empty">
                <div className="big">No inventory data</div>
                <div>Record purchases to build stock</div>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table className="va-table" style={{ minWidth: 600 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th>Urdu Name</th>
                      <th>Unit</th>
                      <th style={{ textAlign: 'right' }}>Current Qty</th>
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
                      return (
                        <tr key={i.id} style={{ background: sc.bg }}>
                          <td className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                          <td style={{ fontWeight: 700 }}>{i.product?.name}</td>
                          <td style={{ fontSize: 14, color: 'var(--muted)', fontFamily: 'serif' }}>{i.product?.urduName ?? '—'}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i.product?.defaultUnit ?? 'KG'}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: i.qty <= 0 ? 'var(--danger)' : undefined }}>
                            {i.qty.toFixed(2)}
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
                      <td colSpan={6} style={{ color: '#fff', fontWeight: 700 }}>Total Stock Value ({filtered.length} products)</td>
                      <td className="mono" style={{ textAlign: 'right', color: '#6FD89A', fontWeight: 800, fontSize: 15 }}>
                        {fmtMoney(filtered.reduce((s, i) => s + i.totalValue, 0))}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: RECORD WASTAGE                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'wastage' && (
        <div className="va-panel" style={{ maxWidth: 640 }}>
          <div className="va-panel-head"><h3>🗑 Record Wastage</h3></div>
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
                  {inventory.map(i => (
                    <option key={i.productId} value={i.productId}>
                      {i.product?.name} (Stock: {i.qty.toFixed(2)} {i.product?.defaultUnit})
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
                <label>Reason</label>
                <input value={wReason} onChange={e => setWReason(e.target.value)}
                  placeholder="Spoilage, damage, expiry…" />
              </div>
            </div>
            <div className="va-form-row" style={{ marginTop: 12 }}>
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
            Use this when your physical count differs from the system. A Stock Movement of type ADJUSTMENT will be created for full audit trail.
          </p>
          <form onSubmit={handleAdjust}>
            <div className="va-form-row">
              <div className="va-field">
                <label>Product *</label>
                <select value={aProdId} onChange={e => {
                  setAProdId(e.target.value);
                  const inv = inventory.find(i => i.productId === e.target.value);
                  setASysQty(inv?.qty ?? 0);
                  setAPhysQty('');
                }} required>
                  <option value="">— Select product —</option>
                  {inventory.map(i => (
                    <option key={i.productId} value={i.productId}>
                      {i.product?.name} (System: {i.qty.toFixed(2)} {i.product?.defaultUnit})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {aProdId && (
              <>
                {/* Comparison panel */}
                <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(31,61,43,0.07)', borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>SYSTEM QTY</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--forest)', fontFamily: 'monospace' }}>{aSysQty.toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{inventory.find(i => i.productId === aProdId)?.product?.defaultUnit ?? 'KG'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: 'var(--muted)' }}>→</div>
                  <div style={{ flex: 1, padding: '14px 16px', background: 'rgba(43,91,138,0.07)', borderRadius: 10, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>PHYSICAL COUNT</div>
                    <input
                      type="number" min="0" step="0.01" required
                      value={aPhysQty}
                      onChange={e => setAPhysQty(e.target.value === '' ? '' : +e.target.value)}
                      style={{ width: '100%', fontSize: 22, fontWeight: 800, fontFamily: 'monospace', border: 'none', background: 'transparent', color: 'var(--forest)', outline: 'none' }}
                      placeholder="0.00"
                    />
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{inventory.find(i => i.productId === aProdId)?.product?.defaultUnit ?? 'KG'}</div>
                  </div>
                  {aPhysQty !== '' && (
                    <div style={{ flex: 1, padding: '14px 16px', background: Number(aPhysQty) >= aSysQty ? 'rgba(31,61,43,0.07)' : 'rgba(168,62,62,0.07)', borderRadius: 10, border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, marginBottom: 4 }}>DELTA</div>
                      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: Number(aPhysQty) >= aSysQty ? 'var(--ok)' : 'var(--danger)' }}>
                        {Number(aPhysQty) >= aSysQty ? '+' : ''}{(Number(aPhysQty) - aSysQty).toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: Number(aPhysQty) >= aSysQty ? 'var(--ok)' : 'var(--danger)' }}>
                        {Number(aPhysQty) >= aSysQty ? 'Stock Gain' : 'Stock Loss'}
                      </div>
                    </div>
                  )}
                </div>

                <div className="va-form-row">
                  <div className="va-field">
                    <label>Reason *</label>
                    <input value={aReason} onChange={e => setAReason(e.target.value)}
                      placeholder="Physical count difference, damaged stock…" required />
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="submit" className="va-btn" disabled={saving || !aProdId || aPhysQty === ''}>
                {saving ? 'Saving…' : '⚙ Apply Adjustment'}
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
              <button className="va-btn secondary small" onClick={loadMovements}>Apply</button>
              <button className="va-btn secondary small" onClick={loadMovements}>↻ Refresh</button>
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
                <table className="va-table" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th>Date &amp; Time</th>
                      <th>Product</th>
                      <th style={{ textAlign: 'center' }}>Type</th>
                      <th>Reference</th>
                      <th style={{ textAlign: 'right', color: 'var(--ok)' }}>Stock In</th>
                      <th style={{ textAlign: 'right', color: 'var(--danger)' }}>Stock Out</th>
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
                        <td className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {m.refId ? <span style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: 4 }}>{m.refId.length > 20 ? m.refId.slice(0, 8) + '…' : m.refId}</span> : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok)' }}>
                          {m.stockIn > 0 ? `+${m.stockIn.toFixed(2)} ${m.unit}` : '—'}
                        </td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                          {m.stockOut > 0 ? `-${m.stockOut.toFixed(2)} ${m.unit}` : '—'}
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
