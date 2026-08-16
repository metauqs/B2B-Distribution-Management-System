'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDateTime, todayInputDate, dateOffset } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBox, MobileCardBadge } from '@/components/ui/MobileCard';
import { useAppSelector } from '@/store';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import Icon from '@mdi/react';
import {
  mdiArchive,
  mdiHistory,
  mdiTune,
  mdiDeleteOutline,
  mdiTagOutline,
  mdiPlus,
  mdiRefresh,
  mdiMagnify,
  mdiFilterVariant,
  mdiChevronDown,
  mdiCalendar,
  mdiArrowLeft,
  mdiAccount,
} from '@mdi/js';

import { ProductVisual } from '@/components/ui/ProductVisual';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InventoryItem {
  id: string;
  productId: string;
  qty: number;
  reservedQty?: number;
  availableQty: number;
  avgCost: number;
  currentBuyPrice: number;
  latestPurchasePrice?: number;
  previousBuyPrice: number;
  lastPurchaseDate?: string;
  lastPurchaseQty?: number;
  totalValue: number;
  stockStatus: 'OK' | 'LOW' | 'OUT_OF_STOCK';
  product: {
    id: string;
    name: string;
    urduName?: string;
    emoji?: string | null;
    imageUrl?: string | null;
    category?: string;
    defaultUnit: string;
    minStock: number;
    availability: string;
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
  product?: { name: string; urduName?: string; defaultUnit: string; imageUrl?: string | null; emoji?: string | null };
  supplier?: { name: string };
}

interface Movement {
  id: string;
  date: string;
  productId: string;
  productName: string;
  productUrdu: string;
  imageUrl?: string | null;
  emoji?: string | null;
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

const ADJUSTMENT_MODES = [
  { id: 'SET', label: '📋 Physical Count Correction (Set Total)', desc: 'Set exact physical count verified in warehouse' },
  { id: 'INCREASE', label: '➕ Increase Stock (+ Add Qty)', desc: 'Add quantity to current inventory' },
  { id: 'DECREASE', label: '➖ Decrease Stock (- Deduct Qty)', desc: 'Reduce quantity from current inventory' },
  { id: 'WASTAGE', label: '🗑 Record Wastage (Rotten / Spoiled)', desc: 'Record stock wastage and auto-deduct' },
  { id: 'DAMAGE', label: '💥 Record Damaged Stock', desc: 'Deduct damaged items from stock' },
  { id: 'SUPPLIER_RETURN', label: '🚛 Supplier Return (Stock Out)', desc: 'Deduct stock returned to supplier' },
  { id: 'OPENING', label: '🔓 Opening Balance Correction', desc: 'Set or correct initial opening stock' },
];

const REASON_PRESETS: Record<string, string[]> = {
  SET: ['Physical Verification Correction', 'System Audit Reconciliation', 'Opening Stock Correction', 'Other'],
  INCREASE: ['Purchased Local Stock', 'Found Extra Uncounted Stock', 'Correction Addition', 'Other'],
  DECREASE: ['Internal Consumption', 'Stock Correction Deduction', 'Sampling', 'Other'],
  WASTAGE: ['Rotten / Spoiled', 'Expired Produce', 'Quality Issue', 'Temperature Damage', 'Other'],
  DAMAGE: ['Physical Handling Damage', 'Transport Damage', 'Crushed in Storage', 'Other'],
  SUPPLIER_RETURN: ['Defective Quality Returned', 'Over-delivered Return', 'Supplier Recall', 'Other'],
  OPENING: ['Opening Inventory Setup', 'Initial Stock Entry', 'System Migration Opening', 'Other'],
};

// ── Emoji Helper ─────────────────────────────────────────────────────────────
function getProductEmoji(name: string = ''): string {
  const n = name.toLowerCase();
  if (n.includes('potato') || n.includes('aloo')) return '🥔';
  if (n.includes('onion') || n.includes('pyaz') || n.includes('piaz')) return '🧅';
  if (n.includes('tomato') || n.includes('timatar') || n.includes('tamatar')) return '🍅';
  if (n.includes('mango') || n.includes('aam')) return '🥭';
  if (n.includes('apple') || n.includes('seb')) return '🍎';
  if (n.includes('cabbage') || n.includes('gobhi') || n.includes('gobi')) return '🥬';
  if (n.includes('cauliflower')) return '🥦';
  if (n.includes('carrot') || n.includes('gajar')) return '🥕';
  if (n.includes('lemon') || n.includes('nimbu') || n.includes('limo')) return '🍋';
  if (n.includes('banana') || n.includes('kela')) return '🍌';
  if (n.includes('orange') || n.includes('malta') || n.includes('kino')) return '🍊';
  if (n.includes('garlic') || n.includes('lehsan')) return '🧄';
  if (n.includes('ginger') || n.includes('adrak')) return '🫚';
  if (n.includes('chilli') || n.includes('mirch')) return '🌶️';
  if (n.includes('cucumber') || n.includes('kheera')) return '🥒';
  return '📦';
}

function fmtQty(qty: number, unit = 'KG') {
  return `${qty % 1 === 0 ? qty : qty.toFixed(2)} ${unit}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function InventoryPage() {
  const user = useAppSelector((state: any) => state.auth.user);
  const isAdmin = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const [pState, setPState] = usePreservedState('inventory', {
    view: 'list' as View,
    search: '',
    mProdId: '',
    mType: 'all',
    mFrom: '',
    mTo: '',
    histProdId: '',
    aProdId: '',
    aProdSearch: '',
    aType: 'SET' as const,
    wProdId: '',
    wProdSearch: '',
  });

  const view = pState.view;
  const setView = (v: View) => setPState({ view: v });

  const search = pState.search;
  const setSearch = (s: string) => setPState({ search: s });

  const mProdId = pState.mProdId;
  const setMProdId = (id: string) => setPState({ mProdId: id });
  const mType = pState.mType;
  const setMType = (t: string) => setPState({ mType: t });
  const mFrom = pState.mFrom;
  const setMFrom = (f: string) => setPState({ mFrom: f });
  const mTo = pState.mTo;
  const setMTo = (t: string) => setPState({ mTo: t });

  const histProdId = pState.histProdId;
  const setHistProdId = (id: string) => setPState({ histProdId: id });

  const aProdId = pState.aProdId;
  const setAProdId = (id: string) => setPState({ aProdId: id });
  const aProdSearch = pState.aProdSearch;
  const setAProdSearch = (s: string) => setPState({ aProdSearch: s });
  const aType = pState.aType;
  const setAType = (t: any) => setPState({ aType: t });

  const wProdId = pState.wProdId;
  const setWProdId = (id: string) => setPState({ wProdId: id });
  const wProdSearch = pState.wProdSearch;
  const setWProdSearch = (s: string) => setPState({ wProdSearch: s });

  const [inventory, setInventory] = useState<InventoryItem[]>(() => {
    const cached = getCachedData<any>('/api/inventory');
    return cached?.data ?? cached ?? [];
  });
  const [allProducts, setAllProducts] = useState<any[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(() => {
    const cached = getCachedData<any>('/api/inventory');
    return cached?.summary ?? null;
  });
  const [movements, setMovements] = useState<Movement[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);

  const [loading, setLoading] = useState(() => {
    return !getCachedData<any>('/api/inventory');
  });
  const [movLoad, setMovLoad] = useState(false);
  const [histLoad, setHistLoad] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Buy Price Adjust Modal
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [pProdId, setPProdId] = useState('');
  const [pProdSearch, setPProdSearch] = useState('');
  const [pComboboxOpen, setPComboboxOpen] = useState(false);
  const [pNewPrice, setPNewPrice] = useState<number | ''>('');
  const [pReason, setPReason] = useState('');

  // Wastage form
  const [wComboboxOpen, setWComboboxOpen] = useState(false);
  const [wQty, setWQty] = useState<number>(0);
  const [wUnit, setWUnit] = useState('KG');
  const [wReason, setWReason] = useState('Rotten / Spoiled');
  const [wRemarks, setWRemarks] = useState('');
  const [wDate, setWDate] = useState('');

  // Adjust form
  const [aComboboxOpen, setAComboboxOpen] = useState(false);
  const [aQtyVal, setAQtyVal] = useState<number | ''>('');
  const [aReason, setAReason] = useState(REASON_PRESETS.SET[0]);
  const [aRemarks, setARemarks] = useState('');
  const [aSysQty, setASysQty] = useState<number>(0);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const openPriceAdjustModal = (item?: any) => {
    if (item) {
      setPProdId(item.productId);
      setPProdSearch(item.name || item.product?.name || '');
      setPNewPrice(item.currentBuyPrice > 0 ? item.currentBuyPrice : item.avgCost > 0 ? item.avgCost : '');
    } else {
      setPProdId('');
      setPProdSearch('');
      setPNewPrice('');
    }
    setPReason('Admin Manual Buy Rate Adjustment');
    setPriceModalOpen(true);
  };

  const handleBuyPriceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pProdId) return showToast('❌ Select a product');
    if (pNewPrice === '' || isNaN(pNewPrice) || pNewPrice < 0) return showToast('❌ Enter a valid buy rate');

    setSaving(true);
    showToast('⏳ Updating buy rate...');
    try {
      const res = await apiFetch('/api/inventory/adjust-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: pProdId, newPrice: pNewPrice, reason: pReason })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('✅ Product buy rate updated successfully');
        setPriceModalOpen(false);
        await load(true);
      } else {
        showToast(`❌ ${data.error || 'Failed to update buy price'}`);
      }
    } catch {
      showToast('❌ Network error updating buy price');
    } finally {
      setSaving(false);
    }
  };

  // ── Load Inventory ──────────────────────────────────────────────────────────
  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && inventory.length === 0) setLoading(true);
    try {
      const [invRes, prodRes] = await Promise.all([
        fetchWithCache<any>('/api/inventory', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any>('/api/products?minimal=true', { ttl: TTL_MEDIUM, forceRefresh: isBackground })
      ]);
      const data = invRes?.data ?? invRes ?? [];
      setInventory(data);
      setSummary(invRes?.summary ?? null);
      if (prodRes) setAllProducts(prodRes);
    } catch (err) {
      console.error('inventory load error:', err);
    } finally {
      setLoading(false);
    }
  }, [inventory.length]);

  useEffect(() => { load(); }, [load]);

  // Master product list (combines inventory and base products catalog)
  const masterProductsList = useMemo(() => {
    const map = new Map<string, { productId: string; name: string; urduName?: string; defaultUnit: string; qty: number; currentBuyPrice: number; avgCost: number; imageUrl?: string | null; emoji?: string | null }>();

    allProducts.forEach(p => {
      map.set(p.id, {
        productId: p.id,
        name: p.name,
        urduName: p.urduName,
        defaultUnit: p.defaultUnit ?? 'KG',
        qty: 0,
        currentBuyPrice: 0,
        avgCost: 0,
        imageUrl: p.imageUrl,
        emoji: p.emoji,
      });
    });

    inventory.forEach(i => {
      const existing = map.get(i.productId);
      map.set(i.productId, {
        productId: i.productId,
        name: i.product?.name ?? existing?.name ?? 'Unknown',
        urduName: i.product?.urduName ?? existing?.urduName,
        defaultUnit: i.product?.defaultUnit ?? existing?.defaultUnit ?? 'KG',
        qty: i.qty,
        currentBuyPrice: i.currentBuyPrice > 0 ? i.currentBuyPrice : (i.latestPurchasePrice ?? i.avgCost),
        avgCost: i.avgCost,
        imageUrl: (i.product as any)?.imageUrl ?? existing?.imageUrl,
        emoji: (i.product as any)?.emoji ?? existing?.emoji,
      });
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, allProducts]);

  // ── Load Movements ──────────────────────────────────────────────────────────
  const loadMovements = useCallback(async (isBackground = false) => {
    if (!isBackground) setMovLoad(true);
    try {
      const params = new URLSearchParams();
      if (mProdId) params.set('productId', mProdId);
      if (mType && mType !== 'all') params.set('type', mType);
      if (mFrom) params.set('startDate', mFrom);
      if (mTo) params.set('endDate', mTo);

      const url = `/api/inventory/movements?${params.toString()}`;
      const data = await fetchWithCache<any>(url, { ttl: TTL_SHORT, forceRefresh: isBackground });
      setMovements(data.data ?? data ?? []);
    } catch (err) {
      console.error('movements load error:', err);
    } finally { setMovLoad(false); }
  }, [mProdId, mType, mFrom, mTo]);

  useEffect(() => {
    if (view === 'movements') {
      loadMovements();
    }
  }, [view, loadMovements]);

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

  // ── Wastage submit with Idempotency Guard ──────────────────────────────────
  const { isSubmitting: isSubmittingWastage, handleSubmit: executeWastage } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      if (!wProdId) {
        showToast('❌ Select a product');
        return;
      }
      if (!wQty || wQty <= 0) {
        showToast('❌ Quantity must be > 0');
        return;
      }
      const inv = masterProductsList.find(i => i.productId === wProdId);
      if (inv && wQty > inv.qty) {
        showToast(`❌ Qty (${wQty}) exceeds stock (${inv.qty.toFixed(2)})`);
        return;
      }

      const res = await apiFetch('/api/inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          productId: wProdId,
          itemName: inv?.name ?? '',
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
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ Wastage recorded — ${data.data?.refNo ?? ''}`);
        setWProdId(''); setWProdSearch(''); setWQty(0); setWRemarks(''); setWDate('');
        await load(true); setView('list');
      } else {
        showToast('❌ ' + (data.error ?? 'Failed'));
      }
    },
    onError: (err: any) => {
      showToast(`❌ ${err.message || 'Network error'}`);
    },
    getFingerprint: () => `${wProdId}-${wQty}-${wUnit}-${wReason}-${wDate}`,
  });

  const handleWastage = (e: React.FormEvent) => executeWastage(e);

  // ── Calculation helper for Adjust Form ──────────────────────────────────────
  const prevStock = aSysQty;
  const numQtyVal = Number(aQtyVal || 0);

  let newExpectedStock = prevStock;
  let calcDiff = 0;

  if (aType === 'SET' || aType === 'OPENING') {
    newExpectedStock = Math.max(0, numQtyVal);
    calcDiff = newExpectedStock - prevStock;
  } else if (aType === 'INCREASE') {
    newExpectedStock = prevStock + Math.abs(numQtyVal);
    calcDiff = +Math.abs(numQtyVal);
  } else {
    newExpectedStock = prevStock - Math.abs(numQtyVal);
    calcDiff = -Math.abs(numQtyVal);
  }

  const isStockInvalid = newExpectedStock < 0;

  // ── Adjust submit with Idempotency Guard ────────────────────────────────────
  const { isSubmitting: isSubmittingAdjust, handleSubmit: executeAdjust } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      if (!aProdId) return showToast('❌ Select a product');
      if (aQtyVal === '' || isNaN(numQtyVal) || numQtyVal < 0) return showToast('❌ Enter a valid quantity');
      if (isStockInvalid) return showToast('❌ Resulting stock cannot be negative');

      const inv = masterProductsList.find(i => i.productId === aProdId);
      const res = await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          productId: aProdId,
          type: aType,
          quantity: numQtyVal,
          reason: aReason,
          remarks: aRemarks || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ Stock adjusted: ${data.data?.productName} → ${data.data?.newStock} ${inv?.defaultUnit ?? 'KG'}`);
        setAProdId(''); setAProdSearch(''); setAQtyVal(''); setARemarks(''); setASysQty(0);
        await load(true); setView('list');
      } else {
        showToast('❌ ' + (data.error ?? 'Failed'));
      }
    },
    onError: (err: any) => {
      showToast(`❌ ${err.message || 'Network error'}`);
    },
    getFingerprint: () => `${aProdId}-${aType}-${numQtyVal}-${aReason}`,
  });

  const handleAdjust = (e: React.FormEvent) => executeAdjust(e);

  const handleReconcile = async () => {
    setSaving(true);
    showToast('⏳ Reconciling stock ledger...');
    try {
      const res = await apiFetch('/api/inventory/reconcile', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ Reconciled ${data.data?.reconciledCount ?? 0} products from immutable ledger`);
        await load(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Reconciliation failed'));
      }
    } catch {
      showToast('❌ Reconciliation failed');
    } finally {
      setSaving(false);
    }
  };

  const openAdjustForProduct = (item: InventoryItem) => {
    setAProdId(item.productId);
    setAProdSearch(item.product?.name ?? '');
    setASysQty(item.qty);
    setAQtyVal(item.qty);
    setAType('SET');
    setAReason(REASON_PRESETS.SET[0]);
    setView('adjust');
  };

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!search.trim()) return inventory;
    const q = search.toLowerCase();
    return inventory.filter(i =>
      i.product?.name?.toLowerCase().includes(q) ||
      i.product?.urduName?.toLowerCase().includes(q) ||
      i.product?.category?.toLowerCase().includes(q)
    );
  }, [inventory, search]);

  const typeLabels: Record<string, string> = {
    PURCHASE: '🛒 Purchase',
    SALE: '🧾 Sale',
    WASTAGE: '🗑 Wastage',
    ADJUSTMENT: '⚙ Adjustment',
    TRANSFER_OUT: '📤 Transfer',
    OPENING: '🔓 Opening',
  };

  const typeColors: Record<string, string> = {
    PURCHASE: '#15803D',
    SALE: '#0284C7',
    WASTAGE: '#DC2626',
    ADJUSTMENT: '#D97706',
    TRANSFER_OUT: '#7C3AED',
    OPENING: '#475569',
  };

  return (
    <DashboardLayout>
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 18px', background: toast.startsWith('❌') ? '#991B1B' : '#14532D', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}

      {/* ─── TOP HEADER & NAVIGATION PANEL ───────────────────────────────────── */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '16px 20px', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 10, background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#166534' }}>
              <Icon path={mdiArchive} size={1.2} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '19px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                Inventory Hub
              </h2>
              <p style={{ color: '#64748B', fontSize: 12, margin: '2px 0 0 0' }}>
                Live stock from purchases, sales, adjustments &amp; wastage
              </p>
            </div>
          </div>

          {view === 'list' ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {isAdmin && (
                <button
                  className="va-btn secondary small"
                  onClick={() => openPriceAdjustModal()}
                  style={{ fontWeight: 700, borderColor: '#166534', color: '#166534', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <Icon path={mdiTagOutline} size={0.65} />
                  <span>Buy Rate</span>
                </button>
              )}
              <button
                className="va-btn secondary small"
                onClick={() => { setView('priceHistory'); loadPriceHistory(); }}
                style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Icon path={mdiHistory} size={0.65} />
                <span>Price History</span>
              </button>
              <button
                className="va-btn secondary small"
                onClick={() => { setView('movements'); loadMovements(); }}
                style={{ fontWeight: 700 }}
              >
                📋 Movements
              </button>
              <button
                className="va-btn secondary small"
                onClick={() => { setAProdId(''); setAProdSearch(''); setAQtyVal(''); setARemarks(''); setASysQty(0); setView('adjust'); load(true); }}
                style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <Icon path={mdiTune} size={0.65} />
                <span>Adjust Stock</span>
              </button>
              <button
                className="va-btn"
                onClick={() => { setWProdId(''); setWProdSearch(''); setWQty(0); setWRemarks(''); setView('wastage'); load(true); }}
                style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4, background: '#DC2626' }}
              >
                <Icon path={mdiDeleteOutline} size={0.65} />
                <span>Wastage</span>
              </button>
            </div>
          ) : (
            <button
              className="va-btn secondary small"
              onClick={() => { setAComboboxOpen(false); setWComboboxOpen(false); setView('list'); }}
              style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Icon path={mdiArrowLeft} size={0.65} />
              <span>Back to Stock Hub</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── MODAL: ADMIN BUY PRICE ADJUSTMENT ────────────────────────────────── */}
      {priceModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ width: '100%', maxWidth: 500, background: '#ffffff', borderRadius: 14, boxShadow: '0 20px 40px rgba(0,0,0,0.3)', padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: 12, marginBottom: 16 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: '#0F172A', fontSize: 17, fontWeight: 800 }}>
                <Icon path={mdiTagOutline} size={0.85} color="#166534" />
                Adjust Buy Rate (Buy Price)
              </h3>
              <button className="va-btn secondary small" onClick={() => setPriceModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleBuyPriceSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  Product * (Search English or Urdu name)
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="🔍 Search product..."
                    value={pProdSearch}
                    onFocus={() => setPComboboxOpen(true)}
                    onChange={e => { setPProdSearch(e.target.value); setPComboboxOpen(true); }}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, background: '#F8FAFC', color: '#0F172A', fontSize: 13, fontWeight: 600 }}
                  />

                  {pComboboxOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', background: '#ffffff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.18)', zIndex: 10001, marginTop: 4 }}>
                      {masterProductsList.filter(p => !pProdSearch || p.name.toLowerCase().includes(pProdSearch.toLowerCase()) || (p.urduName ?? '').includes(pProdSearch)).map(p => (
                        <div
                          key={p.productId}
                          onClick={() => {
                            setPProdId(p.productId);
                            setPProdSearch(p.name);
                            setPNewPrice(p.currentBuyPrice > 0 ? p.currentBuyPrice : '');
                            setPComboboxOpen(false);
                          }}
                          style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ProductVisual name={p.name} emoji={p.emoji} imageUrl={p.imageUrl} size={22} />
                            <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>{p.name} {p.urduName ? `/ ${p.urduName}` : ''}</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#166534', fontFamily: 'monospace' }}>
                            Current: Rs {p.currentBuyPrice.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  New Buy Rate (Rs / Unit) *
                </label>
                <input
                  type="number" min="0" step="any" required
                  value={pNewPrice}
                  onChange={e => setPNewPrice(e.target.value === '' ? '' : +e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #CBD5E1', borderRadius: 8, background: '#ffffff', color: '#0F172A', fontSize: 15, fontWeight: 800, fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  Adjustment Reason / Note
                </label>
                <input
                  type="text"
                  value={pReason}
                  onChange={e => setPReason(e.target.value)}
                  placeholder="Admin buy rate update..."
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #CBD5E1', borderRadius: 8, background: '#ffffff', color: '#0F172A', fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="va-btn secondary" onClick={() => setPriceModalOpen(false)}>Cancel</button>
                <button type="submit" className="va-btn" disabled={saving || !pProdId || pNewPrice === ''} style={{ fontWeight: 800 }}>
                  {saving ? 'Updating…' : '✓ Save Buy Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── VIEW 1: CENTRAL STOCK HUB LIST ─────────────────────────────────── */}
      {view === 'list' && (
        <>
          {/* KPI Cards */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={{ background: '#FFFFFF', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 800, textTransform: 'uppercase' }}>Total Products</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{summary.totalProducts}</div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>Catalog items</div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: 11, color: '#0369A1', fontWeight: 800, textTransform: 'uppercase' }}>Available Qty</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#0284C7', marginTop: 2 }}>{summary.totalAvailableQty.toFixed(1)}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Units in stock</div>
              </div>
              <div style={{ background: '#F0FDF4', padding: '12px 14px', borderRadius: 10, border: '1px solid #BBF7D0' }}>
                <div style={{ fontSize: 11, color: '#166534', fontWeight: 800, textTransform: 'uppercase' }}>Stock Value</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: '#15803D', marginTop: 2 }}>{fmtMoney(summary.totalValue)}</div>
                <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2 }}>At buy price</div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: 11, color: '#15803D', fontWeight: 800, textTransform: 'uppercase' }}>Today In</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#16A34A', marginTop: 2 }}>+{summary.todayStockIn.toFixed(1)}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Purchased</div>
              </div>
              <div style={{ background: '#FFFFFF', padding: '12px 14px', borderRadius: 10, border: '1px solid #E2E8F0', boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
                <div style={{ fontSize: 11, color: '#991B1B', fontWeight: 800, textTransform: 'uppercase' }}>Today Out</div>
                <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: '#DC2626', marginTop: 2 }}>-{summary.todayStockOut.toFixed(1)}</div>
                <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>Sold</div>
              </div>
            </div>
          )}

          {/* Search & Stock Panel */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <Icon path={mdiMagnify} size={0.8} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search product (English or Urdu)…"
                  style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, background: '#F8FAFC' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="va-btn secondary small" onClick={() => load()} style={{ fontWeight: 700 }}>↻ Refresh</button>
                <button className="va-btn secondary small" onClick={handleReconcile} disabled={saving} style={{ fontWeight: 700 }}>⚡ Reconcile</button>
              </div>
            </div>

            {loading && inventory.length === 0 ? (
              <div style={{ padding: 20 }}><SkeletonTable rows={6} cols={7} /></div>
            ) : filtered.length === 0 ? (
              <div className="va-empty" style={{ padding: 40, textAlign: 'center' }}>
                <div className="big" style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>No inventory stock found</div>
                <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Record purchases to automatically populate stock hub</div>
              </div>
            ) : (
              <>
                {/* ── Desktop Table ── */}
                <div className="hide-mobile" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 }}>
                        <th style={{ padding: '12px 14px' }}>#</th>
                        <th style={{ padding: '12px 14px' }}>Product</th>
                        <th style={{ padding: '12px 14px' }}>Urdu Name</th>
                        <th style={{ padding: '12px 14px' }}>Unit</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Total Stock</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Available</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Average Cost</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Latest Buy</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Stock Value</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>Status</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((i, idx) => {
                        const sc = i.stockStatus === 'OUT_OF_STOCK'
                          ? { bg: '#FEF2F2', badge: '#991B1B', label: 'Out of Stock' }
                          : i.stockStatus === 'LOW'
                          ? { bg: '#FFFBEB', badge: '#B45309', label: 'Low Stock' }
                          : { bg: '#FFFFFF', badge: '#15803D', label: 'Available' };

                        const latestRate = i.currentBuyPrice > 0 ? i.currentBuyPrice : (i.latestPurchasePrice ?? i.avgCost);
                        const avgCostVal = i.avgCost > 0 ? i.avgCost : latestRate;

                        return (
                          <tr key={i.id} style={{ borderBottom: '1px solid #F1F5F9', background: sc.bg }}>
                            <td className="mono" style={{ color: '#94A3B8', fontSize: 11, padding: '10px 14px' }}>{idx + 1}</td>
                            <td style={{ padding: '10px 14px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ProductVisual name={i.product?.name ?? ''} emoji={(i.product as any)?.emoji} imageUrl={(i.product as any)?.imageUrl} size={24} />
                                <div>
                                  <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 13 }}>{i.product?.name}</div>
                                  {i.lastPurchaseDate && (
                                    <div style={{ fontSize: 10, color: '#64748B' }}>
                                      Last: {new Date(i.lastPurchaseDate).toLocaleDateString('en-GB')} ({i.lastPurchaseQty ?? 0} {i.product?.defaultUnit})
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '10px 14px', fontSize: 13, color: '#64748B', fontFamily: 'serif' }}>{i.product?.urduName ?? '—'}</td>
                            <td style={{ padding: '10px 14px', color: '#64748B', fontSize: 12 }}>{i.product?.defaultUnit ?? 'KG'}</td>
                            <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: i.qty <= 0 ? '#DC2626' : '#0F172A' }}>
                              {i.qty.toFixed(2)}
                            </td>
                            <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#0284C7' }}>
                              {i.availableQty.toFixed(2)}
                            </td>
                            <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>
                              Rs {avgCostVal.toFixed(2)}
                            </td>
                            <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', color: '#64748B' }}>
                              {latestRate > 0 ? `Rs ${latestRate.toFixed(2)}` : '—'}
                            </td>
                            <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#15803D' }}>
                              {fmtMoney(i.totalValue)}
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: sc.badge + '22', color: sc.badge }}>
                                {sc.label}
                              </span>
                            </td>
                            <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', gap: 4 }}>
                                <button className="va-btn secondary small" onClick={() => openAdjustForProduct(i)} style={{ fontSize: 11, padding: '3px 8px', fontWeight: 700 }}>
                                  ⚙ Adjust
                                </button>
                                {isAdmin && (
                                  <button className="va-btn secondary small" onClick={() => openPriceAdjustModal(i)} style={{ fontSize: 11, padding: '3px 8px', fontWeight: 700, color: '#166534' }}>
                                    🏷️ Rate
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ── Mobile View Cards ── */}
                <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px' }}>
                  {filtered.map(i => {
                    const sc = i.stockStatus === 'OUT_OF_STOCK'
                      ? { badge: 'red' as const, label: 'Out of Stock' }
                      : i.stockStatus === 'LOW'
                      ? { badge: 'yellow' as const, label: 'Low Stock' }
                      : { badge: 'green' as const, label: 'Available' };
                    const latestRate = i.currentBuyPrice > 0 ? i.currentBuyPrice : (i.latestPurchasePrice ?? i.avgCost);
                    const avgCostVal = i.avgCost > 0 ? i.avgCost : latestRate;

                    return (
                      <MobileCard
                        key={i.id}
                        title={i.product?.name ?? 'Product'}
                        headerBadge={i.product?.urduName || (i.product?.defaultUnit ?? 'KG')}
                        footer={
                          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                            <button
                              type="button"
                              className="va-btn secondary small"
                              style={{ flex: 1, fontWeight: 800, padding: '8px' }}
                              onClick={() => openAdjustForProduct(i)}
                            >
                              ⚙ Adjust Stock
                            </button>
                            {isAdmin && (
                              <button
                                type="button"
                                className="va-btn secondary small"
                                style={{ flex: 1, fontWeight: 800, padding: '8px', color: '#166534' }}
                                onClick={() => openPriceAdjustModal(i)}
                              >
                                🏷️ Buy Rate
                              </button>
                            )}
                          </div>
                        }
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: '1px solid #F1F5F9' }}>
                          <ProductVisual name={i.product?.name ?? ''} emoji={(i.product as any)?.emoji} imageUrl={(i.product as any)?.imageUrl} size={28} />
                          <div>
                            <span style={{ fontWeight: 800, color: '#0F172A', fontSize: 14 }}>{i.product?.name}</span>
                            {i.product?.urduName && <div style={{ fontSize: 12, color: '#64748B', fontFamily: 'serif' }}>{i.product.urduName}</div>}
                          </div>
                        </div>

                        <MobileCardRow label="Available Qty" value={`${i.availableQty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} valueColor="#0284C7" isMono />
                        <MobileCardRow label="Total Stock" value={`${i.qty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} isMono />
                        <MobileCardRow label="Average Buy Cost" value={`Rs ${avgCostVal.toFixed(2)} / ${i.product?.defaultUnit ?? 'KG'}`} valueColor="#166534" isMono />
                        <MobileCardRow label="Latest Purchase Price" value={latestRate > 0 ? `Rs ${latestRate.toFixed(2)}` : '—'} isMono />
                        <MobileCardRow label="Inventory Value" value={fmtMoney(i.totalValue)} valueColor="#15803D" isMono />
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

      {/* ─── VIEW 2: STOCK MOVEMENTS HISTORY (MOBILE & DESKTOP REDESIGN) ───── */}
      {view === 'movements' && (
        <>
          {/* Filter Bar */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', padding: '14px 18px', marginBottom: 14, boxShadow: '0 2px 6px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
                <select
                  value={mProdId}
                  onChange={e => setMProdId(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, background: '#F8FAFC', flex: 1, minWidth: 140, fontWeight: 700 }}
                >
                  <option value="">All Products</option>
                  {masterProductsList.map(p => (
                    <option key={p.productId} value={p.productId}>{p.name} {p.urduName ? `(${p.urduName})` : ''}</option>
                  ))}
                </select>

                <select
                  value={mType}
                  onChange={e => setMType(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, background: '#F8FAFC', fontWeight: 700 }}
                >
                  <option value="all">All Movement Types</option>
                  {['PURCHASE','SALE','WASTAGE','ADJUSTMENT','TRANSFER_OUT','OPENING'].map(t => (
                    <option key={t} value={t}>{typeLabels[t] || t}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={mFrom}
                  onChange={e => setMFrom(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, background: '#F8FAFC' }}
                />
                <span style={{ fontSize: 11, color: '#64748B' }}>to</span>
                <input
                  type="date"
                  value={mTo}
                  onChange={e => setMTo(e.target.value)}
                  style={{ padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 12, background: '#F8FAFC' }}
                />
                <button className="va-btn secondary small" onClick={() => loadMovements()} style={{ fontWeight: 700 }}>Apply</button>
                <button className="va-btn secondary small" onClick={() => loadMovements()}>↻</button>
              </div>
            </div>
          </div>

          {/* Movements Output */}
          <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
            {movLoad ? (
              <div style={{ padding: 20 }}><SkeletonTable rows={6} cols={8} /></div>
            ) : movements.length === 0 ? (
              <div className="va-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: 6 }}>📋</div>
                <div className="big" style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>No stock movements found</div>
                <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Try adjusting the product filter or date range</div>
              </div>
            ) : (
              <>
                {/* ── Desktop Movements Table ── */}
                <div className="hide-mobile" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 }}>
                        <th style={{ padding: '12px 14px' }}>Date &amp; Time</th>
                        <th style={{ padding: '12px 14px' }}>Product</th>
                        <th style={{ padding: '12px 14px', textAlign: 'center' }}>Type</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Prev Stock</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', color: '#166534' }}>Stock In</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right', color: '#DC2626' }}>Stock Out</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>New Stock</th>
                        <th style={{ padding: '12px 14px' }}>User</th>
                        <th style={{ padding: '12px 14px' }}>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map(m => (
                        <tr key={m.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ fontSize: 12, color: '#64748B', whiteSpace: 'nowrap', padding: '10px 14px' }}>
                            {fmtDateTime(m.date)}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <ProductVisual name={m.productName} emoji={m.emoji} imageUrl={m.imageUrl} size={22} />
                              <div>
                                <div style={{ fontWeight: 700, color: '#0F172A' }}>{m.productName}</div>
                                {m.productUrdu && <div style={{ fontSize: 11, color: '#64748B', fontFamily: 'serif' }}>{m.productUrdu}</div>}
                              </div>
                            </div>
                          </td>
                          <td style={{ textAlign: 'center', padding: '10px 14px' }}>
                            <span style={{
                              display: 'inline-block', fontSize: 11, fontWeight: 800,
                              padding: '3px 8px', borderRadius: 8,
                              background: (typeColors[m.type] ?? '#555') + '22',
                              color: typeColors[m.type] ?? '#555',
                              border: `1px solid ${(typeColors[m.type] ?? '#555')}44`,
                              whiteSpace: 'nowrap',
                            }}>
                              {typeLabels[m.type] ?? m.type}
                            </span>
                          </td>
                          <td className="mono" style={{ textAlign: 'right', color: '#64748B', padding: '10px 14px' }}>
                            {m.previousStock?.toFixed(2) ?? '—'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#166534', padding: '10px 14px' }}>
                            {m.stockIn > 0 ? `+${m.stockIn.toFixed(2)} ${m.unit}` : '—'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#DC2626', padding: '10px 14px' }}>
                            {m.stockOut > 0 ? `-${m.stockOut.toFixed(2)} ${m.unit}` : '—'}
                          </td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: '#0F172A', padding: '10px 14px' }}>
                            {m.newStock?.toFixed(2) ?? '—'}
                          </td>
                          <td style={{ fontSize: 12, color: '#475569', padding: '10px 14px' }}>
                            {m.userName ?? 'System'}
                          </td>
                          <td style={{ fontSize: 12, color: '#64748B', maxWidth: 240, padding: '10px 14px' }}>
                            <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                              {m.note || '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* ── Mobile Movements Cards ── */}
                <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
                  {movements.map(m => {
                    const isPositive = m.stockIn > 0;
                    const isNegative = m.stockOut > 0;
                    const changeStr = isPositive 
                      ? `+${m.stockIn.toFixed(2)} ${m.unit}`
                      : isNegative 
                      ? `-${m.stockOut.toFixed(2)} ${m.unit}`
                      : `0.00 ${m.unit}`;

                    return (
                      <div
                        key={m.id}
                        style={{
                          background: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '12px',
                          padding: '12px 14px',
                          boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                        }}
                      >
                        {/* Header Row: Date & Type Badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
                            {fmtDateTime(m.date)}
                          </span>
                          <span style={{
                            fontSize: 10,
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: (typeColors[m.type] ?? '#555') + '22',
                            color: typeColors[m.type] ?? '#555',
                            border: `1px solid ${(typeColors[m.type] ?? '#555')}44`,
                          }}>
                            {typeLabels[m.type] ?? m.type}
                          </span>
                        </div>

                        {/* Product Visual & Name */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <ProductVisual name={m.productName} emoji={m.emoji} imageUrl={m.imageUrl} size={26} />
                          <div>
                            <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 14 }}>{m.productName}</div>
                            {m.productUrdu && <div style={{ fontSize: 11, color: '#64748B', fontFamily: 'serif' }}>{m.productUrdu}</div>}
                          </div>
                        </div>

                        {/* 3-Column Stock Stats */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr 1fr', gap: 6, background: '#F8FAFC', padding: '8px 10px', borderRadius: 8, border: '1px solid #E2E8F0', marginBottom: 8, textAlign: 'center' }}>
                          <div>
                            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Prev Stock</div>
                            <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginTop: 2 }}>
                              {m.previousStock?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Movement</div>
                            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: isPositive ? '#166534' : isNegative ? '#DC2626' : '#475569', marginTop: 2 }}>
                              {changeStr}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>New Stock</div>
                            <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                              {m.newStock?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                        </div>

                        {/* Footer: User & Note */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#64748B', borderTop: '1px solid #F1F5F9', paddingTop: 6 }}>
                          <span>👤 {m.userName || 'System'}</span>
                          <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
                            {m.note || '—'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── VIEW 3: PURCHASE BUY PRICE HISTORY ──────────────────────────────── */}
      {view === 'priceHistory' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #F1F5F9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon path={mdiHistory} size={0.8} color="#166534" />
              <span>Purchase Buy Price History</span>
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={histProdId}
                onChange={e => { setHistProdId(e.target.value); loadPriceHistory(e.target.value); }}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#F8FAFC', fontWeight: 700 }}
              >
                <option value="">All Products</option>
                {masterProductsList.map(p => (
                  <option key={p.productId} value={p.productId}>{p.name} {p.urduName ? `(${p.urduName})` : ''}</option>
                ))}
              </select>
              <button className="va-btn secondary small" onClick={() => loadPriceHistory(histProdId)}>↻</button>
            </div>
          </div>

          {histLoad ? (
            <div style={{ padding: 20 }}><SkeletonTable rows={5} cols={5} /></div>
          ) : priceHistory.length === 0 ? (
            <div className="va-empty" style={{ padding: 40, textAlign: 'center' }}>
              <div className="big" style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>No purchase price history recorded</div>
              <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>Historical buy prices accumulate automatically as purchases are recorded</div>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hide-mobile" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0', color: '#475569', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 800 }}>
                      <th style={{ padding: '12px 14px' }}>Date &amp; Time</th>
                      <th style={{ padding: '12px 14px' }}>Product</th>
                      <th style={{ padding: '12px 14px' }}>Supplier / Record</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Buy Price</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Purchase Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map(entry => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ fontSize: 12, color: '#64748B', padding: '10px 14px' }}>{fmtDateTime(entry.date)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ProductVisual name={entry.product?.name ?? ''} emoji={entry.product?.emoji} imageUrl={entry.product?.imageUrl} size={22} />
                            <div>
                              <div style={{ fontWeight: 700, color: '#0F172A' }}>{entry.product?.name ?? '—'}</div>
                              {entry.product?.urduName && <div style={{ fontSize: 11, color: '#64748B', fontFamily: 'serif' }}>{entry.product.urduName}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: 12, color: '#475569' }}>{entry.supplier?.name ?? 'Mandi / Direct / Admin Update'}</td>
                        <td className="mono" style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: '#166534' }}>
                          Rs {entry.buyPrice.toFixed(2)}
                        </td>
                        <td className="mono" style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {entry.qty.toFixed(2)} {entry.product?.defaultUnit ?? 'KG'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Price History Cards */}
              <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
                {priceHistory.map(entry => (
                  <div
                    key={entry.id}
                    style={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#64748B' }}>{fmtDateTime(entry.date)}</span>
                      <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>{entry.supplier?.name || 'Mandi Purchase'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ProductVisual name={entry.product?.name ?? ''} emoji={entry.product?.emoji} imageUrl={entry.product?.imageUrl} size={24} />
                        <span style={{ fontWeight: 800, color: '#0F172A', fontSize: 14 }}>{entry.product?.name}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="mono" style={{ fontSize: 15, fontWeight: 800, color: '#166534' }}>
                          Rs {entry.buyPrice.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          {entry.qty.toFixed(2)} {entry.product?.defaultUnit ?? 'KG'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── VIEW 4: RECORD WASTAGE ─────────────────────────────────────────── */}
      {view === 'wastage' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', maxWidth: 640, margin: '0 auto', padding: 24, boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
          <div style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#DC2626' }}>🗑 Record Stock Wastage</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
              Deduct spoiled, rotten, or unsellable inventory with automatic stock-out tracking.
            </p>
          </div>

          <form onSubmit={handleWastage}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                Product * (Search English or Urdu name)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="🔍 Search product (e.g. Tomato, ٹماٹر)..."
                  value={wProdSearch}
                  onFocus={() => setWComboboxOpen(true)}
                  onChange={e => { setWProdSearch(e.target.value); setWComboboxOpen(true); }}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, background: '#F8FAFC', color: '#0F172A', fontSize: 13, fontWeight: 600 }}
                />

                {wComboboxOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', background: '#ffffff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.18)', zIndex: 10001, marginTop: 4 }}>
                    {masterProductsList.filter(p => !wProdSearch || p.name.toLowerCase().includes(wProdSearch.toLowerCase()) || (p.urduName ?? '').includes(wProdSearch)).map(p => (
                      <div
                        key={p.productId}
                        onClick={() => {
                          setWProdId(p.productId);
                          setWProdSearch(p.name);
                          setWUnit(p.defaultUnit || 'KG');
                          setWComboboxOpen(false);
                        }}
                        style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProductVisual name={p.name} emoji={p.emoji} imageUrl={p.imageUrl} size={22} />
                          <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>{p.name} {p.urduName ? `/ ${p.urduName}` : ''}</span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: p.qty > 0 ? '#166534' : '#DC2626' }}>
                          Stock: {p.qty.toFixed(2)} {p.defaultUnit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  Wastage Qty *
                </label>
                <input
                  type="number" step="any" min="0.01" required
                  value={wQty || ''}
                  onChange={e => setWQty(+e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, fontWeight: 800 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  Reason Preset
                </label>
                <select
                  value={wReason}
                  onChange={e => setWReason(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                >
                  {REASON_PRESETS.WASTAGE.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                Remarks / Details
              </label>
              <input
                type="text"
                value={wRemarks}
                onChange={e => setWRemarks(e.target.value)}
                placeholder="Optional notes..."
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            <button
              type="submit"
              className="va-btn"
              disabled={isSubmittingWastage || !wProdId || wQty <= 0}
              style={{ width: '100%', padding: '12px', borderRadius: 10, fontWeight: 800, background: '#DC2626' }}
            >
              {isSubmittingWastage ? 'Recording…' : '🗑 Confirm Stock Wastage'}
            </button>
          </form>
        </div>
      )}

      {/* ─── VIEW 5: MANUAL STOCK ADJUSTMENT ────────────────────────────────── */}
      {view === 'adjust' && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '14px', maxWidth: 640, margin: '0 auto', padding: 24, boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
          <div style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: 12, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>⚙️ Manual Stock Adjustment</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
              Perform physical inventory corrections, additions, or audit adjustments.
            </p>
          </div>

          <form onSubmit={handleAdjust}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                Product * (Search English or Urdu name)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="🔍 Search product..."
                  value={aProdSearch}
                  onFocus={() => setAComboboxOpen(true)}
                  onChange={e => { setAProdSearch(e.target.value); setAComboboxOpen(true); }}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, background: '#F8FAFC', color: '#0F172A', fontSize: 13, fontWeight: 600 }}
                />

                {aComboboxOpen && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 220, overflowY: 'auto', background: '#ffffff', border: '1px solid #CBD5E1', borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.18)', zIndex: 10001, marginTop: 4 }}>
                    {masterProductsList.filter(p => !aProdSearch || p.name.toLowerCase().includes(aProdSearch.toLowerCase()) || (p.urduName ?? '').includes(aProdSearch)).map(p => (
                      <div
                        key={p.productId}
                        onClick={() => {
                          setAProdId(p.productId);
                          setAProdSearch(p.name);
                          setASysQty(p.qty);
                          setAQtyVal(p.qty);
                          setAComboboxOpen(false);
                        }}
                        style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ProductVisual name={p.name} emoji={p.emoji} imageUrl={p.imageUrl} size={22} />
                          <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 13 }}>{p.name} {p.urduName ? `/ ${p.urduName}` : ''}</span>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0284C7' }}>
                          Current: {p.qty.toFixed(2)} {p.defaultUnit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                Adjustment Mode *
              </label>
              <select
                value={aType}
                onChange={e => {
                  const t = e.target.value as any;
                  setAType(t);
                  setAReason(REASON_PRESETS[t]?.[0] || 'Manual Adjustment');
                }}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, background: '#F8FAFC', fontWeight: 700 }}
              >
                {ADJUSTMENT_MODES.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  {aType === 'SET' || aType === 'OPENING' ? 'New Verified Total Qty *' : 'Adjustment Qty *'}
                </label>
                <input
                  type="number" step="any" min="0" required
                  value={aQtyVal}
                  onChange={e => setAQtyVal(e.target.value === '' ? '' : +e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 14, fontWeight: 800 }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                  Reason Preset
                </label>
                <select
                  value={aReason}
                  onChange={e => setAReason(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, background: '#F8FAFC', fontWeight: 600 }}
                >
                  {(REASON_PRESETS[aType] || ['Other']).map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            {aProdId && (
              <div style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 8, border: '1px solid #CBD5E1', marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#475569' }}>
                  Previous Stock: <strong>{prevStock.toFixed(2)}</strong> → New Expected Stock: <strong style={{ color: '#166534' }}>{newExpectedStock.toFixed(2)}</strong> (Net: {calcDiff >= 0 ? `+${calcDiff.toFixed(2)}` : calcDiff.toFixed(2)})
                </div>
              </div>
            )}

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#334155' }}>
                Remarks
              </label>
              <input
                type="text"
                value={aRemarks}
                onChange={e => setARemarks(e.target.value)}
                placeholder="Optional remarks..."
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            <button
              type="submit"
              className="va-btn"
              disabled={isSubmittingAdjust || !aProdId || aQtyVal === '' || isStockInvalid}
              style={{ width: '100%', padding: '12px', borderRadius: 10, fontWeight: 800 }}
            >
              {isSubmittingAdjust ? 'Adjusting…' : '✓ Save Stock Adjustment'}
            </button>
          </form>
        </div>
      )}
    </DashboardLayout>
  );
}
