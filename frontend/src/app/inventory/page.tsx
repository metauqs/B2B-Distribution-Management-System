'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDateTime } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import { useAppSelector } from '@/store';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import Icon from '@mdi/react';
import { mdiArchive, mdiHistory, mdiTune, mdiDeleteOutline, mdiTagOutline } from '@mdi/js';

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
    if (pNewPrice === '' || isNaN(Number(pNewPrice)) || Number(pNewPrice) < 0) {
      return showToast('❌ Enter a valid non-negative buy rate');
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/inventory/buy-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: pProdId,
          newBuyPrice: Number(pNewPrice),
          reason: pReason || 'Admin Manual Buy Rate Adjustment',
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        showToast(`✅ Buy price updated — Rs ${Number(pNewPrice).toFixed(2)}`);
        setPriceModalOpen(false);
        await load(true);
      } else showToast('❌ ' + (data.error ?? 'Failed to update buy price'));
    } finally { setSaving(false); }
  };

  const handleReconcile = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/inventory/reconcile', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/inventory');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ ${data.message}`);
        await load(true);
      } else showToast('❌ ' + (data.error ?? 'Reconciliation failed'));
    } catch (err: any) {
      showToast('❌ ' + (err.message || 'Reconciliation failed'));
    } finally { setSaving(false); }
  };

  // ── Load inventory & all products ───────────────────────────────────────────
  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && inventory.length === 0) setLoading(true);
    try {
      const [invData, prodData] = await Promise.all([
        fetchWithCache<any>('/api/inventory', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any>('/api/products', { ttl: TTL_LONG, forceRefresh: isBackground }),
      ]);
      if (invData) {
        setInventory(invData.data ?? invData ?? []);
        setSummary(invData.summary ?? null);
      }
      if (prodData) {
        setAllProducts(prodData.data ?? prodData ?? []);
      }
    } catch (err) {
      console.error('inventory load error:', err);
    } finally { setLoading(false); }
  }, [inventory.length]);

  useEffect(() => { load(); }, [load]);

  // ── Combined Master Product List for Dropdowns ──────────────────────────────
  const masterProductsList = useMemo(() => {
    const map = new Map<string, { productId: string; name: string; urduName?: string; unit: string; qty: number; currentBuyPrice: number; previousBuyPrice: number; lastPurchaseDate?: string; lastPurchaseQty?: number }>();

    inventory.forEach(inv => {
      if (inv.productId) {
        map.set(inv.productId, {
          productId: inv.productId,
          name: inv.product?.name ?? 'Product',
          urduName: inv.product?.urduName ?? '',
          unit: inv.product?.defaultUnit ?? 'KG',
          qty: inv.qty ?? 0,
          currentBuyPrice: inv.currentBuyPrice ?? inv.avgCost ?? 0,
          previousBuyPrice: inv.previousBuyPrice ?? 0,
          lastPurchaseDate: inv.lastPurchaseDate,
          lastPurchaseQty: inv.lastPurchaseQty,
        });
      }
    });

    allProducts.forEach(prod => {
      if (prod.id && !map.has(prod.id)) {
        map.set(prod.id, {
          productId: prod.id,
          name: prod.name,
          urduName: prod.urduName ?? '',
          unit: prod.defaultUnit ?? 'KG',
          qty: 0,
          currentBuyPrice: 0,
          previousBuyPrice: 0,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, allProducts]);

  const matchingAdjProducts = useMemo(() => {
    return masterProductsList.filter(p =>
      !aProdSearch ||
      p.name.toLowerCase().includes(aProdSearch.toLowerCase()) ||
      (p.urduName ?? '').includes(aProdSearch)
    );
  }, [masterProductsList, aProdSearch]);

  const matchingWastageProducts = useMemo(() => {
    return masterProductsList.filter(p =>
      !wProdSearch ||
      p.name.toLowerCase().includes(wProdSearch.toLowerCase()) ||
      (p.urduName ?? '').includes(wProdSearch)
    );
  }, [masterProductsList, wProdSearch]);

  const selectedAdjProduct = useMemo(() => {
    return masterProductsList.find(p => p.productId === aProdId);
  }, [masterProductsList, aProdId]);

  const openAdjustForProduct = (item: InventoryItem) => {
    setAProdId(item.productId);
    setAProdSearch(item.product?.name ?? '');
    setASysQty(item.qty);
    setAQtyVal('');
    setAComboboxOpen(false);
    setView('adjust');
  };

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
    // DECREASE, WASTAGE, DAMAGE, SUPPLIER_RETURN
    newExpectedStock = prevStock - Math.abs(numQtyVal);
    calcDiff = -Math.abs(numQtyVal);
  }

  const isStockInvalid = newExpectedStock < 0;

  // ── Adjust submit with Idempotency Guard ────────────────────────────────────
  const { isSubmitting: isSubmittingAdjust, handleSubmit: executeAdjust } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      if (!aProdId) {
        showToast('❌ Select a product');
        return;
      }
      if (aQtyVal === '' || isNaN(Number(aQtyVal))) {
        showToast('❌ Enter a valid quantity');
        return;
      }
      if (Number(aQtyVal) < 0) {
        showToast('❌ Quantity cannot be negative');
        return;
      }
      if (isStockInvalid) {
        showToast('❌ Operation would result in negative stock!');
        return;
      }

      if (['DECREASE', 'WASTAGE', 'DAMAGE', 'SUPPLIER_RETURN'].includes(aType) && numQtyVal > prevStock) {
        showToast(`❌ Cannot deduct ${numQtyVal} from current stock (${prevStock.toFixed(2)})`);
        return;
      }

      const res = await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
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
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        const { refNo, delta, newQty } = data.data;
        showToast(`✅ Stock updated — ${refNo} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} → New Stock: ${newQty.toFixed(2)})`);
        setAProdId(''); setAProdSearch(''); setAQtyVal(''); setARemarks(''); setASysQty(0);
        await load(true); setView('list');
      } else {
        showToast('❌ ' + (data.error ?? 'Failed'));
      }
    },
    onError: (err: any) => {
      showToast(`❌ ${err.message || 'Network error'}`);
    },
    getFingerprint: () => `${aProdId}-${aQtyVal}-${aType}-${aReason}`,
  });

  const handleAdjust = (e: React.FormEvent) => executeAdjust(e);

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
              {isAdmin && (
                <button
                  className="va-btn secondary small"
                  onClick={() => openPriceAdjustModal()}
                  style={{ fontWeight: 700, borderColor: 'var(--forest)', color: 'var(--forest)' }}
                >
                  <Icon path={mdiTagOutline} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Adjust Buy Rate
                </button>
              )}
              <button className="va-btn secondary small" onClick={() => { setView('priceHistory'); loadPriceHistory(); }} style={{ fontWeight: 700 }}>
                <Icon path={mdiHistory} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Buy Price History
              </button>
              <button className="va-btn secondary small" onClick={() => { setView('movements'); loadMovements(); }} style={{ fontWeight: 700 }}>
                📋 Movements
              </button>
              <button className="va-btn secondary small" onClick={() => { setAProdId(''); setAProdSearch(''); setAQtyVal(''); setARemarks(''); setASysQty(0); setView('adjust'); load(true); }} style={{ fontWeight: 700 }}>
                <Icon path={mdiTune} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Adjust Stock
              </button>
              <button className="va-btn" onClick={() => { setWProdId(''); setWProdSearch(''); setWQty(0); setWRemarks(''); setView('wastage'); load(true); }}>
                <Icon path={mdiDeleteOutline} size={0.7} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Record Wastage
              </button>
            </div>
          )}
          {view !== 'list' && (
            <button className="va-btn secondary small" onClick={() => { setAComboboxOpen(false); setWComboboxOpen(false); setView('list'); }}>← Back to Stock Hub</button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADMIN BUY PRICE ADJUSTMENT                                      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {priceModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(4px)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }}>
          <div className="va-panel" style={{ width: '100%', maxWidth: 520, margin: 0, background: '#ffffff', borderRadius: 16, boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid #E2E8F0', paddingBottom: 12, marginBottom: 16 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: '#0F172A' }}>
                <Icon path={mdiTagOutline} size={0.9} color="var(--forest)" />
                Adjust Buy Rate (Buy Price)
              </h3>
              <button className="va-btn secondary small" onClick={() => setPriceModalOpen(false)}>✕</button>
            </div>

            <form onSubmit={handleBuyPriceSubmit}>
              <div className="va-field" style={{ position: 'relative', marginBottom: 14 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#0F172A' }}>
                  Product * (Search English or Urdu name)
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="🔍 Search product..."
                    value={pProdSearch}
                    onFocus={() => setPComboboxOpen(true)}
                    onChange={e => {
                      setPProdSearch(e.target.value);
                      setPComboboxOpen(true);
                    }}
                    style={{
                      width: '100%', padding: '10px 12px', border: '1px solid var(--line)',
                      borderRadius: 8, background: '#ffffff', color: '#0F172A', fontSize: 14, fontWeight: 600
                    }}
                  />

                  {pComboboxOpen && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 220,
                      overflowY: 'auto', background: '#ffffff', border: '1px solid #CBD5E1',
                      borderRadius: 8, boxShadow: '0 10px 25px rgba(0,0,0,0.18)', zIndex: 10001, marginTop: 4
                    }}>
                      {masterProductsList.filter(p => !pProdSearch || p.name.toLowerCase().includes(pProdSearch.toLowerCase()) || (p.urduName ?? '').includes(pProdSearch)).map(p => (
                        <div
                          key={p.productId}
                          onClick={() => {
                            setPProdId(p.productId);
                            setPProdSearch(p.name);
                            setPNewPrice(p.currentBuyPrice > 0 ? p.currentBuyPrice : '');
                            setPComboboxOpen(false);
                          }}
                          style={{
                            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            cursor: 'pointer', borderBottom: '1px solid #F1F5F9'
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                          onMouseLeave={e => (e.currentTarget.style.background = '#ffffff')}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 18 }}>{getProductEmoji(p.name)}</span>
                            <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{p.name} {p.urduName ? `/ ${p.urduName}` : ''}</span>
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

              {pProdId && (() => {
                const prod = masterProductsList.find(p => p.productId === pProdId);
                const currRate = prod?.currentBuyPrice ?? 0;
                const prevRate = prod?.previousBuyPrice ?? 0;
                const newRateNum = Number(pNewPrice || 0);
                const diff = newRateNum - currRate;

                return (
                  <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748B', marginBottom: 6 }}>
                      <span>Current Buy Rate: <strong style={{ color: '#0F172A' }}>Rs {currRate.toFixed(2)} / {prod?.unit}</strong></span>
                      <span>Previous Rate: <strong style={{ color: '#0F172A' }}>{prevRate > 0 ? `Rs ${prevRate.toFixed(2)}` : '—'}</strong></span>
                    </div>

                    {newRateNum > 0 && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: diff > 0 ? '#DC2626' : diff < 0 ? '#166534' : '#64748B' }}>
                        Rate Change: Rs {currRate.toFixed(2)} → Rs {newRateNum.toFixed(2)} ({diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)})
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="va-field" style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#0F172A' }}>
                  New Buy Rate (Rs / Unit) *
                </label>
                <input
                  type="number" min="0" step="0.01" required
                  value={pNewPrice}
                  onChange={e => setPNewPrice(e.target.value === '' ? '' : +e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8, background: '#ffffff', color: '#0F172A', fontSize: 16, fontWeight: 800, fontFamily: 'monospace' }}
                />
              </div>

              <div className="va-field" style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6, color: '#0F172A' }}>
                  Adjustment Reason / Note
                </label>
                <input
                  type="text"
                  value={pReason}
                  onChange={e => setPReason(e.target.value)}
                  placeholder="Admin buy rate update..."
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: '#ffffff', color: '#0F172A', fontSize: 13 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="va-btn secondary" onClick={() => setPriceModalOpen(false)}>Cancel</button>
                <button type="submit" className="va-btn" disabled={saving || !pProdId || pNewPrice === ''}>
                  {saving ? 'Updating…' : '✓ Save Buy Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                <button className="va-btn secondary small" onClick={handleReconcile} disabled={saving} style={{ fontWeight: 700 }}>⚡ Reconcile Stock</button>
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
                        <th style={{ textAlign: 'right', color: 'var(--forest)', fontWeight: 700 }}>Average Buy Cost</th>
                        <th style={{ textAlign: 'right' }}>Latest Purchase Price</th>
                        <th style={{ textAlign: 'right', fontWeight: 700 }}>Inventory Value</th>
                        <th style={{ textAlign: 'center' }}>Status</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((i, idx) => {
                        const sc = i.stockStatus === 'OUT_OF_STOCK'
                          ? { bg: '#FFF5F5', badge: 'var(--danger)', label: 'Out of Stock' }
                          : i.stockStatus === 'LOW'
                          ? { bg: '#FFFBF0', badge: '#B87333', label: 'Low Stock' }
                          : { bg: undefined, badge: 'var(--ok)', label: 'Available' };

                        const latestRate = i.currentBuyPrice > 0 ? i.currentBuyPrice : (i.latestPurchasePrice ?? i.avgCost);
                        const avgCostVal = i.avgCost > 0 ? i.avgCost : latestRate;
                        const priceDiff = latestRate - (i.previousBuyPrice > 0 ? i.previousBuyPrice : avgCostVal);

                        return (
                          <tr key={i.id} style={{ background: sc.bg }}>
                            <td className="mono" style={{ color: 'var(--muted)', fontSize: 11 }}>{idx + 1}</td>
                            <td style={{ fontWeight: 700 }}>
                              {getProductEmoji(i.product?.name)} {i.product?.name}
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
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--forest)' }}>
                              Rs {avgCostVal.toFixed(2)}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                              {latestRate > 0 ? `Rs ${latestRate.toFixed(2)}` : '—'}
                              {i.previousBuyPrice > 0 && priceDiff !== 0 && (
                                <span style={{ fontSize: 10, marginLeft: 4, color: priceDiff > 0 ? 'var(--danger)' : 'var(--ok)' }}>
                                  ({priceDiff > 0 ? `+${priceDiff.toFixed(1)}` : priceDiff.toFixed(1)})
                                </span>
                              )}
                            </td>
                            <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--forest)' }}>{fmtMoney(i.totalValue)}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{
                                display: 'inline-block', fontSize: 11, fontWeight: 700,
                                padding: '3px 9px', borderRadius: 10,
                                background: sc.badge + '22', color: sc.badge,
                                border: `1px solid ${sc.badge}44`,
                              }}>{sc.label}</span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <div style={{ display: 'inline-flex', gap: 4 }}>
                                <button className="va-btn secondary small" onClick={() => openAdjustForProduct(i)} style={{ fontSize: 11, padding: '3px 8px', fontWeight: 700 }}>
                                  ⚙ Adjust
                                </button>
                                {isAdmin && (
                                  <button className="va-btn secondary small" onClick={() => openPriceAdjustModal(i)} style={{ fontSize: 11, padding: '3px 8px', fontWeight: 700, color: 'var(--forest)' }} title="Adjust Buy Price">
                                    🏷️ Rate
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#1F3D2B', color: '#fff', fontWeight: 700 }}>
                        <td colSpan={5} style={{ color: '#fff', fontWeight: 700 }}>Total Inventory Value ({filtered.length} products)</td>
                        <td className="mono" style={{ textAlign: 'right', color: '#90CAF9', fontWeight: 800 }}>
                          {filtered.reduce((s, i) => s + i.availableQty, 0).toFixed(1)}
                        </td>
                        <td colSpan={2}></td>
                        <td className="mono" style={{ textAlign: 'right', color: '#6FD89A', fontWeight: 800, fontSize: 15 }}>
                          {fmtMoney(filtered.reduce((s, i) => s + i.totalValue, 0))}
                        </td>
                        <td colSpan={2}></td>
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
                    const latestRate = i.currentBuyPrice > 0 ? i.currentBuyPrice : (i.latestPurchasePrice ?? i.avgCost);
                    const avgCostVal = i.avgCost > 0 ? i.avgCost : latestRate;
                    return (
                      <MobileCard
                        key={i.id}
                        title={`${getProductEmoji(i.product?.name)} ${i.product?.name ?? 'Product'}`}
                        headerBadge={i.product?.urduName || (i.product?.defaultUnit ?? 'KG')}
                      >
                        <MobileCardRow label="Total Stock" value={`${i.qty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} isMono />
                        <MobileCardRow label="Available Qty" value={`${i.availableQty.toFixed(2)} ${i.product?.defaultUnit ?? 'KG'}`} valueColor="var(--primary)" isMono />
                        <MobileCardRow label="Average Buy Cost" value={`Rs ${avgCostVal.toFixed(2)} / ${i.product?.defaultUnit ?? 'KG'}`} valueColor="var(--forest)" isMono />
                        <MobileCardRow label="Latest Purchase Price" value={latestRate > 0 ? `Rs ${latestRate.toFixed(2)}` : '—'} isMono />
                        <MobileCardRow label="Inventory Value" value={fmtMoney(i.totalValue)} valueColor="#166534" isMono />
                        <MobileCardRow label="Status">
                          <MobileCardBadge variant={sc.badge}>{sc.label}</MobileCardBadge>
                        </MobileCardRow>
                        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                          <button className="va-btn secondary small" style={{ flex: 1, fontWeight: 700 }} onClick={() => openAdjustForProduct(i)}>
                            ⚙ Adjust Stock
                          </button>
                          {isAdmin && (
                            <button className="va-btn secondary small" style={{ flex: 1, fontWeight: 700, color: 'var(--forest)' }} onClick={() => openPriceAdjustModal(i)}>
                              🏷️ Buy Rate
                            </button>
                          )}
                        </div>
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
              <select value={histProdId} onChange={e => { setHistProdId(e.target.value); loadPriceHistory(e.target.value); }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--line)', fontSize: 13, background: '#ffffff', color: '#0F172A' }}>
                <option value="" style={{ background: '#ffffff', color: '#0F172A' }}>All Products</option>
                {masterProductsList.map(p => <option key={p.productId} value={p.productId} style={{ background: '#ffffff', color: '#0F172A' }}>{getProductEmoji(p.name)} {p.name} {p.urduName ? `/ ${p.urduName}` : ''}</option>)}
              </select>
              <button className="va-btn secondary small" onClick={() => loadPriceHistory(histProdId)}>↻ Refresh</button>
            </div>
          </div>

          {histLoad ? <div className="va-loading">Loading price history…</div>
          : priceHistory.length === 0 ? (
            <div className="va-empty">
              <div className="big">No purchase price history recorded</div>
              <div>Historical buy prices will accumulate automatically as purchases or manual adjustments are recorded</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead>
                  <tr>
                    <th>Date &amp; Time</th>
                    <th>Product Name</th>
                    <th>Supplier / Record</th>
                    <th style={{ textAlign: 'right' }}>Buy Price (Rs)</th>
                    <th style={{ textAlign: 'right' }}>Purchase / Stock Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map(entry => (
                    <tr key={entry.id}>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(entry.date)}</td>
                      <td style={{ fontWeight: 700 }}>{getProductEmoji(entry.product?.name)} {entry.product?.name ?? '—'}</td>
                      <td>{entry.supplier?.name ?? 'Mandi / Direct / Admin Update'}</td>
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
              {/* Searchable Product Combobox */}
              <div className="va-field" style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Product * (Search English or Urdu name)</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="🔍 Search product (e.g. Potato, آلو, Onion)..."
                    value={wProdSearch}
                    onFocus={() => setWComboboxOpen(true)}
                    onChange={e => {
                      setWProdSearch(e.target.value);
                      setWComboboxOpen(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: '#ffffff',
                      color: '#0F172A',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  />

                  {wComboboxOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: 250,
                        overflowY: 'auto',
                        background: '#ffffff',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        boxShadow: '0 10px 25px rgba(0,0,0,0.18)',
                        zIndex: 1000,
                        marginTop: 4,
                      }}
                    >
                      {matchingWastageProducts.length === 0 ? (
                        <div style={{ padding: '12px 16px', color: '#64748B', fontSize: 13, textAlign: 'center' }}>
                          No products match "{wProdSearch}"
                        </div>
                      ) : (
                        matchingWastageProducts.map(p => {
                          const emoji = getProductEmoji(p.name);
                          const isSelected = p.productId === wProdId;

                          return (
                            <div
                              key={p.productId}
                              onClick={() => {
                                setWProdId(p.productId);
                                setWProdSearch(p.name);
                                setWUnit(p.unit);
                                setWComboboxOpen(false);
                              }}
                              style={{
                                padding: '10px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                background: isSelected ? '#E2F0D9' : '#ffffff',
                                borderBottom: '1px solid #F1F5F9',
                                transition: 'background 0.15s ease',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                              onMouseLeave={e => (e.currentTarget.style.background = isSelected ? '#E2F0D9' : '#ffffff')}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 18 }}>{emoji}</span>
                                <div>
                                  <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{p.name}</span>
                                  {p.urduName && (
                                    <span style={{ marginLeft: 8, color: '#475569', fontSize: 14, fontFamily: 'serif' }}>
                                      / {p.urduName}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div style={{
                                fontSize: 12,
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: p.qty > 0 ? '#DCFCE7' : '#F1F5F9',
                                color: p.qty > 0 ? '#166534' : '#64748B',
                              }}>
                                Stock: {p.qty.toFixed(2)} {p.unit}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                <select
                  value={wProdId}
                  onChange={e => {
                    const selId = e.target.value;
                    setWProdId(selId);
                    const match = masterProductsList.find(p => p.productId === selId);
                    if (match) {
                      setWProdSearch(match.name);
                      setWUnit(match.unit);
                    }
                  }}
                  required
                  style={{
                    marginTop: 6,
                    padding: '8px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    background: '#ffffff',
                    color: '#0F172A',
                    fontSize: 13,
                    fontWeight: 600,
                    width: '100%',
                    cursor: 'pointer',
                  }}
                >
                  <option value="" style={{ background: '#ffffff', color: '#0F172A' }}>— Or select from full list ({masterProductsList.length} products) —</option>
                  {masterProductsList.map(p => (
                    <option key={p.productId} value={p.productId} style={{ background: '#ffffff', color: '#0F172A', padding: '6px' }}>
                      {getProductEmoji(p.name)} {p.name} {p.urduName ? `/ ${p.urduName}` : ''} — Stock: {p.qty.toFixed(2)} {p.unit}
                    </option>
                  ))}
                </select>

                {wProdId && (() => {
                  const inv = masterProductsList.find(i => i.productId === wProdId);
                  return inv ? <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>Current stock: {inv.qty.toFixed(2)} {inv.unit}</span> : null;
                })()}
              </div>

              <div className="va-field">
                <label>Quantity Wasted *</label>
                <input type="number" required min="0.01" step="0.01"
                  value={wQty || ''} onChange={e => setWQty(+e.target.value)}
                  style={{ background: '#ffffff', color: '#0F172A', fontSize: 14, fontWeight: 700, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)' }}
                />
                {wProdId && wQty > 0 && (() => {
                  const inv = masterProductsList.find(i => i.productId === wProdId);
                  if (inv && wQty > inv.qty) return (
                    <span style={{ color: 'var(--danger)', fontSize: 11, fontWeight: 700, marginTop: 4, display: 'block' }}>
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
                <select value={wUnit} onChange={e => setWUnit(e.target.value)} style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, fontWeight: 600 }}>
                  {UNITS.map(u => <option key={u} style={{ background: '#ffffff', color: '#0F172A' }}>{u}</option>)}
                </select>
              </div>
              <div className="va-field">
                <label>Reason *</label>
                <select value={wReason} onChange={e => setWReason(e.target.value)} style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, fontWeight: 600 }}>
                  {REASON_PRESETS.WASTAGE.map(r => <option key={r} value={r} style={{ background: '#ffffff', color: '#0F172A' }}>{r}</option>)}
                </select>
              </div>
            </div>

            <div className="va-form-row" style={{ marginTop: 12 }}>
              <div className="va-field">
                <label>Remarks / Notes</label>
                <input value={wRemarks} onChange={e => setWRemarks(e.target.value)}
                  placeholder="Additional details regarding wastage…"
                  style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, borderRadius: 8, padding: '8px 12px' }}
                />
              </div>
              <div className="va-field">
                <label>Date (optional)</label>
                <input type="datetime-local" value={wDate} onChange={e => setWDate(e.target.value)}
                  style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, borderRadius: 8, padding: '8px 12px' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : '✓ Record Wastage'}</button>
              <button type="button" className="va-btn secondary" onClick={() => setView('list')}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* VIEW: MANUAL STOCK ADJUSTMENT (PROFESSIONAL ERP MODULE)                */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {view === 'adjust' && (
        <div className="va-panel" style={{ maxWidth: 720 }}>
          <div className="va-panel-head">
            <h3>⚙ Professional ERP Manual Stock Adjustment</h3>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>
            Single Source of Truth — Stock corrections, physical verifications, wastage, damaged items, and supplier returns. Every action updates stock and records a full audit log.
          </p>

          <form onSubmit={handleAdjust}>
            <div className="va-form-row">
              {/* Searchable Product Combobox */}
              <div className="va-field" style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Product * (Search English or Urdu name)
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    placeholder="🔍 Search product (e.g. Potato, آلو, Onion)..."
                    value={aProdSearch}
                    onFocus={() => setAComboboxOpen(true)}
                    onChange={e => {
                      setAProdSearch(e.target.value);
                      setAComboboxOpen(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid var(--line)',
                      borderRadius: 8,
                      background: '#ffffff',
                      color: '#0F172A',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  />

                  {aComboboxOpen && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: 250,
                        overflowY: 'auto',
                        background: '#ffffff',
                        border: '1px solid #CBD5E1',
                        borderRadius: 8,
                        boxShadow: '0 10px 25px rgba(0,0,0,0.18)',
                        zIndex: 1000,
                        marginTop: 4,
                      }}
                    >
                      {matchingAdjProducts.length === 0 ? (
                        <div style={{ padding: '12px 16px', color: '#64748B', fontSize: 13, textAlign: 'center' }}>
                          No products match "{aProdSearch}"
                        </div>
                      ) : (
                        matchingAdjProducts.map(p => {
                          const emoji = getProductEmoji(p.name);
                          const isSelected = p.productId === aProdId;

                          return (
                            <div
                              key={p.productId}
                              onClick={() => {
                                setAProdId(p.productId);
                                setAProdSearch(p.name);
                                setASysQty(p.qty);
                                setAQtyVal('');
                                setAComboboxOpen(false);
                              }}
                              style={{
                                padding: '10px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                background: isSelected ? '#E2F0D9' : '#ffffff',
                                borderBottom: '1px solid #F1F5F9',
                                transition: 'background 0.15s ease',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#F0FDF4')}
                              onMouseLeave={e => (e.currentTarget.style.background = isSelected ? '#E2F0D9' : '#ffffff')}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ fontSize: 18 }}>{emoji}</span>
                                <div>
                                  <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{p.name}</span>
                                  {p.urduName && (
                                    <span style={{ marginLeft: 8, color: '#475569', fontSize: 14, fontFamily: 'serif' }}>
                                      / {p.urduName}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div style={{
                                fontSize: 12,
                                fontWeight: 700,
                                fontFamily: 'monospace',
                                padding: '3px 8px',
                                borderRadius: 6,
                                background: p.qty > 0 ? '#DCFCE7' : '#F1F5F9',
                                color: p.qty > 0 ? '#166534' : '#64748B',
                              }}>
                                Stock: {p.qty.toFixed(2)} {p.unit}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                <select
                  value={aProdId}
                  onChange={e => {
                    const selId = e.target.value;
                    setAProdId(selId);
                    const match = masterProductsList.find(p => p.productId === selId);
                    if (match) {
                      setAProdSearch(match.name);
                      setASysQty(match.qty);
                      setAQtyVal('');
                    }
                  }}
                  required
                  style={{
                    marginTop: 6,
                    padding: '8px 12px',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    background: '#ffffff',
                    color: '#0F172A',
                    fontSize: 13,
                    fontWeight: 600,
                    width: '100%',
                    cursor: 'pointer',
                  }}
                >
                  <option value="" style={{ background: '#ffffff', color: '#0F172A' }}>— Select from full product list ({masterProductsList.length} items) —</option>
                  {masterProductsList.map(p => (
                    <option key={p.productId} value={p.productId} style={{ background: '#ffffff', color: '#0F172A', padding: '6px' }}>
                      {getProductEmoji(p.name)} {p.name} {p.urduName ? `/ ${p.urduName}` : ''} — Stock: {p.qty.toFixed(2)} {p.unit}
                    </option>
                  ))}
                </select>
              </div>

              {/* Adjustment Mode Selection */}
              <div className="va-field">
                <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Adjustment Operation Mode *
                </label>
                <select
                  value={aType}
                  onChange={e => {
                    const newMode = e.target.value as any;
                    setAType(newMode);
                    if (REASON_PRESETS[newMode]) setAReason(REASON_PRESETS[newMode][0]);
                  }}
                  style={{ background: '#ffffff', color: '#0F172A', fontWeight: 600, fontSize: 13, width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line)' }}
                >
                  {ADJUSTMENT_MODES.map(m => (
                    <option key={m.id} value={m.id} style={{ background: '#ffffff', color: '#0F172A' }}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* ── ERP STOCK INFORMATION PANEL ──────────────────────────────── */}
            {selectedAdjProduct && (
              <div style={{
                margin: '16px 0',
                padding: '16px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 14,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>PRODUCT</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                    {getProductEmoji(selectedAdjProduct.name)} {selectedAdjProduct.name}
                  </div>
                  {selectedAdjProduct.urduName && (
                    <div style={{ fontSize: 13, color: '#475569', fontFamily: 'serif' }}>{selectedAdjProduct.urduName}</div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>CURRENT STOCK</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#166534', fontFamily: 'monospace', marginTop: 2 }}>
                    {selectedAdjProduct.qty.toFixed(2)} {selectedAdjProduct.unit}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>System Record</div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>LATEST BUY RATE</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1E3A8A', fontFamily: 'monospace', marginTop: 2 }}>
                    {selectedAdjProduct.currentBuyPrice > 0 ? `Rs ${selectedAdjProduct.currentBuyPrice.toFixed(2)}` : '—'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B' }}>per {selectedAdjProduct.unit}</div>
                  {isAdmin && (
                    <button
                      type="button"
                      className="va-btn secondary small"
                      onClick={() => openPriceAdjustModal(selectedAdjProduct)}
                      style={{ fontSize: 10, padding: '2px 6px', marginTop: 4, fontWeight: 700, color: 'var(--forest)' }}
                    >
                      🏷️ Adjust Rate
                    </button>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>PREVIOUS BUY RATE</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#64748B', fontFamily: 'monospace', marginTop: 2 }}>
                    {selectedAdjProduct.previousBuyPrice > 0 ? `Rs ${selectedAdjProduct.previousBuyPrice.toFixed(2)}` : '—'}
                  </div>
                  {selectedAdjProduct.previousBuyPrice > 0 && selectedAdjProduct.currentBuyPrice > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: selectedAdjProduct.currentBuyPrice > selectedAdjProduct.previousBuyPrice ? '#DC2626' : '#166534' }}>
                      {selectedAdjProduct.currentBuyPrice > selectedAdjProduct.previousBuyPrice ? `+${(selectedAdjProduct.currentBuyPrice - selectedAdjProduct.previousBuyPrice).toFixed(1)}` : (selectedAdjProduct.currentBuyPrice - selectedAdjProduct.previousBuyPrice).toFixed(1)}
                    </div>
                  )}
                </div>

                <div>
                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>LAST PURCHASE</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginTop: 2 }}>
                    {selectedAdjProduct.lastPurchaseDate ? new Date(selectedAdjProduct.lastPurchaseDate).toLocaleDateString('en-GB') : 'No purchases yet'}
                  </div>
                  {selectedAdjProduct.lastPurchaseQty && (
                    <div style={{ fontSize: 11, color: '#64748B' }}>{selectedAdjProduct.lastPurchaseQty} {selectedAdjProduct.unit} bought</div>
                  )}
                </div>
              </div>
            )}

            {/* ── DYNAMIC LIVE CALCULATION PREVIEW CARD ─────────────────────── */}
            {aProdId && (
              <>
                <div style={{
                  display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap',
                  padding: '14px', background: '#F1F5F9', borderRadius: 12, border: '1px solid #CBD5E1'
                }}>
                  <div style={{ flex: 1, padding: '12px 14px', background: '#ffffff', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>PREVIOUS STOCK</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#334155', fontFamily: 'monospace', marginTop: 2 }}>
                      {prevStock.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>{selectedAdjProduct?.unit ?? 'KG'}</div>
                  </div>

                  <div style={{ flex: 1.2, padding: '12px 14px', background: 'rgba(43,91,138,0.06)', borderRadius: 8, border: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>
                      {aType === 'SET' || aType === 'OPENING' ? 'ACTUAL PHYSICAL STOCK *'
                        : aType === 'INCREASE' ? 'QUANTITY TO ADD (+)'
                        : aType === 'DECREASE' ? 'QUANTITY TO DEDUCT (-)'
                        : aType === 'WASTAGE' ? 'QUANTITY WASTED (-)'
                        : aType === 'DAMAGE' ? 'QUANTITY DAMAGED (-)'
                        : 'QUANTITY RETURNED (-)'}
                    </div>
                    <input
                      type="number" min="0" step="0.01" required
                      value={aQtyVal}
                      onChange={e => setAQtyVal(e.target.value === '' ? '' : +e.target.value)}
                      style={{ width: '100%', fontSize: 22, fontWeight: 800, fontFamily: 'monospace', border: 'none', background: 'transparent', color: 'var(--forest)', outline: 'none', marginTop: 2 }}
                      placeholder="0.00"
                    />
                  </div>

                  <div style={{ flex: 1, padding: '12px 14px', background: '#ffffff', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700 }}>NEW EXPECTED STOCK</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: isStockInvalid ? '#DC2626' : '#166534', fontFamily: 'monospace', marginTop: 2 }}>
                      {newExpectedStock.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 11, color: isStockInvalid ? '#DC2626' : '#64748B' }}>
                      {isStockInvalid ? '⚠ Cannot be negative' : `${calcDiff >= 0 ? '+' : ''}${calcDiff.toFixed(2)} ${selectedAdjProduct?.unit ?? 'KG'}`}
                    </div>
                  </div>
                </div>

                <div className="va-form-row">
                  <div className="va-field">
                    <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Adjustment Reason *</label>
                    <select
                      value={aReason}
                      onChange={e => setAReason(e.target.value)}
                      style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, fontWeight: 600, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)' }}
                    >
                      {(REASON_PRESETS[aType] || REASON_PRESETS.SET).map(r => (
                        <option key={r} value={r} style={{ background: '#ffffff', color: '#0F172A' }}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="va-form-row" style={{ marginTop: 12 }}>
                  <div className="va-field">
                    <label style={{ display: 'block', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Remarks / Notes (Logged in Audit Trail)</label>
                    <input value={aRemarks} onChange={e => setARemarks(e.target.value)}
                      placeholder="Additional details for stock movement audit log…"
                      style={{ background: '#ffffff', color: '#0F172A', fontSize: 13, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)' }}
                    />
                  </div>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button type="submit" className="va-btn" disabled={saving || !aProdId || aQtyVal === '' || isStockInvalid}>
                {saving ? 'Saving ERP Update…' : '⚙ Apply Stock Adjustment'}
              </button>
              <button type="button" className="va-btn secondary" onClick={() => { setAComboboxOpen(false); setView('list'); }}>Cancel</button>
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
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, flex: 2, minWidth: 160, background: '#ffffff', color: '#0F172A' }}>
                <option value="" style={{ background: '#ffffff', color: '#0F172A' }}>All Products</option>
                {masterProductsList.map(p => <option key={p.productId} value={p.productId} style={{ background: '#ffffff', color: '#0F172A' }}>{getProductEmoji(p.name)} {p.name}</option>)}
              </select>
              <select value={mType} onChange={e => setMType(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, background: '#ffffff', color: '#0F172A' }}>
                <option value="all" style={{ background: '#ffffff', color: '#0F172A' }}>All Movement Types</option>
                {['PURCHASE','SALE','WASTAGE','ADJUSTMENT','TRANSFER_OUT','OPENING'].map(t => <option key={t} style={{ background: '#ffffff', color: '#0F172A' }}>{t}</option>)}
              </select>
              <input type="date" value={mFrom} onChange={e => setMFrom(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, background: '#ffffff', color: '#0F172A' }} />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
              <input type="date" value={mTo} onChange={e => setMTo(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13, background: '#ffffff', color: '#0F172A' }} />
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
                          <div style={{ fontWeight: 600 }}>{getProductEmoji(m.productName)} {m.productName}</div>
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
