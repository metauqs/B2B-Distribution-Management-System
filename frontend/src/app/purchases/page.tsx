'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { ProductAutocomplete } from '@/components/ui/ProductAutocomplete';
import { loadBrandConfig, loadBrandConfigWithLogo, generatePurchaseHTML, openPrintWindow, writeAndPrint, openDownloadWindow, writeAndDownload } from '@/utils/documentTemplates';
import { MobileCard, MobileCardRow, MobileCardBox } from '@/components/ui/MobileCard';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';

interface PurchaseItem { id?: string; itemName: string; qty: number; unit: string; rate: number; amount: number; productId?: string; }
interface Purchase {
  id: string; date: string; subtotal: number; transportCost: number; total: number; paid: number; balance: number; status: string; notes?: string;
  supplierId: string; supplier?: { id: string; name: string; } | null;
  items?: PurchaseItem[];
}
interface Supplier { id: string; name: string; currentBalance: number; }
interface Product  { id: string; name: string; urduName?: string | null; defaultUnit?: string; category?: string; }
interface InventoryRecord { productId: string; qty: number; avgCost: number; currentBuyPrice: number; previousBuyPrice: number; latestPurchasePrice: number; }

const blankItem = (): PurchaseItem => ({ itemName: '', qty: 1, unit: 'KG', rate: 0, amount: 0 });

const UNITS = ['KG','G','DOZEN','PIECE','BOX','CRATE'];

import { ProductVisual } from '@/components/ui/ProductVisual';

function Badge({ status, small, isMandi }: { status: string; small?: boolean; isMandi?: boolean }) {
  if (isMandi) {
    return <span className={`va-badge paid ${small ? 'small' : ''}`}>PURCHASED</span>;
  }
  const cls = status === 'PAID' ? 'paid' : status === 'PARTIAL' ? 'partial' : 'due';
  return <span className={`va-badge ${cls} ${small ? 'small' : ''}`}>{status}</span>;
}

export default function PurchasesPage() {
  const [pState, setPState] = usePreservedState('purchases', {
    view: 'list' as 'list' | 'create',
    formOpen: false,
    catalogSearch: '',
  });

  const formOpen = pState.formOpen || pState.view === 'create';
  const setFormOpen = (open: boolean) => setPState({ formOpen: open, view: open ? 'create' : 'list' });

  const catalogSearch = pState.catalogSearch;
  const setCatalogSearch = (s: string) => setPState({ catalogSearch: s });

  const [purchases, setPurchases] = useState<Purchase[]>(() => {
    return getCachedData<Purchase[]>('/api/purchases') || [];
  });
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    return getCachedData<Supplier[]>('/api/suppliers') || [];
  });
  const [products,  setProducts]  = useState<Product[]>(() => {
    return getCachedData<Product[]>('/api/products') || [];
  });
  const [inventoryData, setInventoryData] = useState<InventoryRecord[]>(() => {
    return (getCachedData<any>('/api/inventory')?.data as InventoryRecord[]) || [];
  });
  const [loading,    setLoading]    = useState(() => {
    return !getCachedData<Purchase[]>('/api/purchases');
  });
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');

  // Form State
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [source,     setSource]     = useState<'SUPPLIER' | 'MANDI'>('SUPPLIER');
  const [supplierId, setSupplierId] = useState('');
  const [date,       setDate]       = useState(() => todayInputDate());
  const [items,      setItems]      = useState<PurchaseItem[]>([]);
  const [paid,         setPaid]         = useState(0);
  const [transportCost, setTransportCost] = useState(0);
  const [notes,        setNotes]        = useState('');

  // Merge Conflict States
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeData, setMergeData] = useState<{
    itemName: string;
    rate1: number;
    rate2: number;
    index1: number;
    index2: number;
    currentList: PurchaseItem[];
  } | null>(null);

  // Price Conflict Warning State (Replaces DB merge auto-overwrite)
  const [showPriceConflictModal, setShowPriceConflictModal] = useState(false);
  const [priceConflictData, setPriceConflictData] = useState<{
    itemName: string;
    unit: string;
    prevPrice: number;
    newPrice: number;
    currentList: PurchaseItem[];
  } | null>(null);

  // Add Supplier Inline Modal State
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [newSupplierAddress, setNewSupplierAddress] = useState('');

  // Filters State
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterDate, setFilterDate] = useState(() => todayInputDate());

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async (isBackground = false) => {
    if (!isBackground && purchases.length === 0) setLoading(true);
    try {
      const [pd, sd, prd, invRes] = await Promise.all([
        fetchWithCache<Purchase[]>('/api/purchases', { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any[]>('/api/suppliers', { ttl: TTL_LONG, forceRefresh: isBackground }),
        fetchWithCache<any[]>('/api/products', { ttl: TTL_LONG, forceRefresh: isBackground }),
        fetchWithCache<any>('/api/inventory', { ttl: TTL_SHORT, forceRefresh: isBackground }),
      ]);
      if (pd)  setPurchases(pd);
      if (sd)  setSuppliers(sd);
      if (prd) setProducts(prd);
      if (invRes && invRes.data) setInventoryData(invRes.data);
    } catch (err) {
      console.error('purchases load error:', err);
    } finally {
      setLoading(false);
    }
  }, [purchases.length]);

  const productRefMap = useMemo(() => {
    const map = new Map<string, { prevPrice: number; avgCost: number; qty: number }>();
    (inventoryData || []).forEach(inv => {
      if (inv.productId) {
        const prevPrice = inv.currentBuyPrice > 0 
          ? inv.currentBuyPrice 
          : (inv.latestPurchasePrice > 0 ? inv.latestPurchasePrice : (inv.previousBuyPrice || 0));
        map.set(inv.productId, {
          prevPrice,
          avgCost: inv.avgCost || 0,
          qty: inv.qty || 0,
        });
      }
    });

    (purchases || []).forEach(p => {
      (p.items || []).forEach(it => {
        const key = it.productId || it.itemName.toLowerCase().trim();
        if (!map.has(key) && it.rate > 0) {
          map.set(key, { prevPrice: it.rate, avgCost: it.rate, qty: 0 });
        }
      });
    });

    return map;
  }, [inventoryData, purchases]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const handleRevalidate = () => {
      load(true);
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [load]);

  const updateItem = (index: number, key: keyof PurchaseItem, val: string | number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const updated = { ...item, [key]: val };
      updated.amount = updated.qty * updated.rate;
      return updated;
    }));
  };

  // Toggle a product in/out of current purchase catalog
  const toggleProduct = (prod: Product) => {
    setItems(prev => {
      const exists = prev.findIndex(it => it.productId === prod.id);
      if (exists >= 0) {
        return prev.filter((_, i) => i !== exists);
      }
      return [...prev, {
        itemName: prod.name,
        productId: prod.id,
        qty: 1,
        unit: prod.defaultUnit || 'KG',
        rate: 0,
        amount: 0,
      }];
    });
  };

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const total    = subtotal + transportCost;
  const balance  = total - paid;

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return showToast('Supplier name is required');
    try {
      const res = await apiFetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSupplierName, phone: newSupplierPhone, address: newSupplierAddress })
      });
      const data = await res.json();
      if (data.success) {
        invalidateCache('/api/suppliers');
        showToast('✅ Supplier created successfully');
        const sRes = await apiFetch('/api/suppliers');
        const sData = await sRes.json();
        if (sData.success) setSuppliers(sData.data);
        
        setSupplierId(data.data.id);
        setShowAddSupplierModal(false);
        setNewSupplierName('');
        setNewSupplierPhone('');
        setNewSupplierAddress('');
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to create supplier'));
      }
    } catch {
      showToast('❌ Network error creating supplier');
    }
  };

  const handleEditClick = (p: Purchase) => {
    setPurchaseId(p.id);
    const isMandi = p.supplier?.name === 'Mandi';
    setSource(isMandi ? 'MANDI' : 'SUPPLIER');
    setSupplierId(isMandi ? 'mandi' : p.supplierId);
    setDate(p.date.slice(0, 10));
    setItems(p.items ? p.items.map(i => ({
      productId: i.productId ?? undefined,
      itemName: i.itemName,
      qty: i.qty,
      unit: i.unit,
      rate: i.rate,
      amount: i.qty * i.rate
    })) : []);
    setPaid(p.paid);
    setTransportCost(p.transportCost);
    setNotes(p.notes ?? '');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (pId: string) => {
    if (!confirm('Are you sure you want to cancel and delete this purchase entry? This will reverse inventory stock levels.')) return;
    try {
      const res = await apiFetch(`/api/purchases/${pId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        invalidateCache('/api/purchases');
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        // Notify all open pages to refresh immediately
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('✅ Purchase deleted & stock levels adjusted');
        await load(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Delete failed'));
      }
    } catch {
      showToast('❌ Network error deleting purchase');
    }
  };

  const handlePrintClick = async (p: Purchase) => {
    const w = openPrintWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const brand = await loadBrandConfigWithLogo();
    const html = generatePurchaseHTML(
      {
        voucherNo: p.id.slice(-6).toUpperCase(),
        date: p.date,
        supplierName: p.supplier?.name ?? 'Unknown Supplier',
        supplierId: p.supplierId,
        items: (p.items || []).map(it => ({
          itemName: it.itemName,
          qty: it.qty,
          unit: it.unit,
          rate: it.rate,
          amount: it.amount
        })),
        subtotal: p.subtotal,
        transportCost: p.transportCost,
        total: p.total,
        paid: p.paid,
        balance: p.balance,
        notes: p.notes
      },
      brand,
      window.location.origin
    );
    writeAndPrint(w, html, `Purchase_${p.id.slice(-6)}.pdf`);
  };

  const handleDownloadClick = async (p: Purchase) => {
    const w = openDownloadWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const brand = await loadBrandConfigWithLogo();
    const html = generatePurchaseHTML(
      {
        voucherNo: p.id.slice(-6).toUpperCase(),
        date: p.date,
        supplierName: p.supplier?.name ?? 'Unknown Supplier',
        supplierId: p.supplierId,
        items: (p.items || []).map(it => ({
          itemName: it.itemName,
          qty: it.qty,
          unit: it.unit,
          rate: it.rate,
          amount: it.amount
        })),
        subtotal: p.subtotal,
        transportCost: p.transportCost,
        total: p.total,
        paid: p.paid,
        balance: p.balance,
        notes: p.notes
      },
      brand,
      window.location.origin
    );
    writeAndDownload(w, html, `Purchase_${p.id.slice(-6)}.pdf`);
  };

  const handleCancelForm = () => {
    setPurchaseId(null);
    setSource('SUPPLIER');
    setSupplierId('');
    setDate(todayInputDate());
    setItems([blankItem()]);
    setPaid(0);
    setTransportCost(0);
    setNotes('');
    setFormOpen(false);
  };

  const findDuplicateItems = (currentItems: PurchaseItem[]) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < currentItems.length; i++) {
      const name = currentItems[i].itemName.trim().toLowerCase();
      if (!name) continue;
      if (seen.has(name)) {
        return {
          itemName: currentItems[i].itemName,
          index1: seen.get(name)!,
          index2: i,
        };
      }
      seen.set(name, i);
    }
    return null;
  };



  const { isSubmitting: isSubmittingPurchase, submit: executeSavePurchase } = useIdempotentSubmit({
    onSubmit: async (itemsToSave: PurchaseItem[], idempotencyKey: string) => {
      const finalSupplierId = source === 'MANDI' ? 'mandi' : supplierId;
      const url = purchaseId ? `/api/purchases/${purchaseId}` : '/api/purchases';
      const method = purchaseId ? 'PUT' : 'POST';

      const res = await apiFetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ supplierId: finalSupplierId, items: itemsToSave, paid, transportCost, notes, date }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/purchases');
        invalidateCache('/api/inventory');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/reports');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(purchaseId ? '✅ Purchase updated successfully' : '✅ Purchase saved — stock updated');
        handleCancelForm();
        await load(true);
      } else {
        showToast('❌ ' + (data.error ?? 'Failed'));
      }
    },
    onError: () => {
      showToast('❌ Network error saving purchase');
    },
    getFingerprint: (items) => `${purchaseId}-${source}-${supplierId}-${paid}-${transportCost}-${date}-${(items || []).map(i => `${i.itemName}:${i.qty}:${i.rate}`).join(',')}`,
  });

  const savePurchaseToDb = (itemsToSave: PurchaseItem[]) => executeSavePurchase(itemsToSave);

  const checkAndSave = (currentItems: PurchaseItem[], bypassConflictCheck = false) => {
    // 1. Check for duplicate items within the current form
    const dup = findDuplicateItems(currentItems);
    if (dup) {
      const item1 = currentItems[dup.index1];
      const item2 = currentItems[dup.index2];
      
      if (item1.rate === item2.rate) {
        const merged = [...currentItems];
        merged[dup.index1].qty += item2.qty;
        merged[dup.index1].amount = merged[dup.index1].qty * item1.rate;
        const filtered = merged.filter((_, idx) => idx !== dup.index2);
        setItems(filtered);
        checkAndSave(filtered, bypassConflictCheck);
      } else {
        setMergeData({
          itemName: dup.itemName,
          rate1: item1.rate,
          rate2: item2.rate,
          index1: dup.index1,
          index2: dup.index2,
          currentList: currentItems
        });
        setShowMergeModal(true);
      }
      return;
    }

    // 2. Check for Purchase Price Conflict against Previous Purchase Price (Informational Warning, NOT Block!)
    if (!bypassConflictCheck) {
      for (const item of currentItems) {
        if (item.rate <= 0) continue;
        const key = item.productId || item.itemName.toLowerCase().trim();
        const ref = productRefMap.get(key);
        if (ref && ref.prevPrice > 0 && Math.abs(item.rate - ref.prevPrice) > 0.01) {
          setPriceConflictData({
            itemName: item.itemName,
            unit: item.unit,
            prevPrice: ref.prevPrice,
            newPrice: item.rate,
            currentList: currentItems,
          });
          setShowPriceConflictModal(true);
          return;
        }
      }
    }

    // Proceed to save with admin's entered rates
    savePurchaseToDb(currentItems);
  };

  const handleResolveMerge = (useRate: number) => {
    if (!mergeData) return;
    const { index1, index2, currentList } = mergeData;
    
    const updated = [...currentList];
    updated[index1].qty += updated[index2].qty;
    updated[index1].rate = useRate;
    updated[index1].amount = updated[index1].qty * useRate;
    
    const filtered = updated.filter((_, i) => i !== index2);
    setItems(filtered);
    
    setShowMergeModal(false);
    setMergeData(null);
    
    setTimeout(() => {
      checkAndSave(filtered);
    }, 50);
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSupplierId = source === 'MANDI' ? 'mandi' : supplierId;
    if (!finalSupplierId) return showToast('❌ Please select a supplier');
    if (!date) return showToast('❌ Purchase date is required');

    const validItems = items.filter(i => (i.itemName || (i as any).name) && Number(i.qty) > 0 && Number(i.rate) > 0);
    if (validItems.length === 0) {
      return showToast('❌ Please add at least one product with valid quantity (>0) and buy rate (>0)');
    }
    
    const subtotalCalc = validItems.reduce((s, i) => s + (i.qty * i.rate), 0);
    const totalCalc = subtotalCalc + (transportCost ?? 0);
    if (source !== 'MANDI' && paid > totalCalc) {
      return showToast(`❌ Amount paid (Rs ${paid.toLocaleString()}) cannot exceed total purchase amount (Rs ${totalCalc.toLocaleString()})`);
    }
    
    checkAndSave(validItems);
  };

  // Filter logic
  const filteredPurchases = purchases.filter(p => {
    const isMandi = p.supplier?.name === 'Mandi';
    
    const matchesSupplier = filterSupplier === 'all' || 
      (filterSupplier === 'mandi' && isMandi) ||
      (filterSupplier !== 'mandi' && p.supplierId === filterSupplier);
    
    const matchesDate = !filterDate || p.date.startsWith(filterDate);

    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || 
      (p.supplier?.name && p.supplier.name.toLowerCase().includes(searchLower)) ||
      (p.notes && p.notes.toLowerCase().includes(searchLower)) ||
      (p.items?.some(i => i.itemName.toLowerCase().includes(searchLower)));

    const matchesProduct = filterProduct === 'all' || p.items?.some(i => i.productId === filterProduct);

    return matchesSupplier && matchesDate && matchesSearch && matchesProduct;
  });

  const exportToCSV = () => {
    const headers = ['Source/Supplier', 'Date', 'Items', 'Subtotal', 'Transport', 'Total', 'Paid', 'Balance', 'Status'];
    const rows = filteredPurchases.map(p => [
      p.supplier?.name || '',
      fmtDate(p.date),
      p.items?.map(i => `${i.itemName} ${i.qty}${i.unit}`).join('; ') || '',
      p.subtotal,
      p.transportCost,
      p.total,
      p.paid,
      p.balance,
      p.supplier?.name === 'Mandi' ? 'PURCHASED' : p.status
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `purchases_report_${todayInputDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ─── Catalog filtered products ───────────────────────────────────────────
  const catalogFiltered = products.filter(p => {
    if (!catalogSearch) return true;
    const s = catalogSearch.toLowerCase();
    return p.name.toLowerCase().includes(s) || (p.urduName || '').toLowerCase().includes(s);
  });

  // Group by category
  const catOrder = ['VEGETABLE', 'FRUIT', 'OTHER'];
  const grouped = catOrder.reduce((acc, cat) => {
    const list = catalogFiltered.filter(p => (p.category || 'OTHER').toUpperCase() === cat);
    if (list.length) acc[cat] = list;
    return acc;
  }, {} as Record<string, Product[]>);
  const catLabels: Record<string, string> = { VEGETABLE: '🥦 Vegetables / سبزیاں', FRUIT: '🍎 Fruits / پھل', OTHER: '📦 Other / دیگر' };

  return (
    <DashboardLayout>
      {toast && <div className="va-toast">{toast}</div>}

      <div className="va-panel">
        <div className="va-panel-head">
          <h3>{purchaseId ? '✏️ Edit Purchase' : 'Record Purchase'}</h3>
          <button className="va-btn secondary small" onClick={purchaseId ? handleCancelForm : () => setFormOpen(!formOpen)}>
            {formOpen ? '✕ Cancel' : '+ New Purchase'}
          </button>
        </div>

        {formOpen && (
          <form onSubmit={handleSubmit}>
            {/* ── Header Fields ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
              <div className="va-field">
                <label>Purchase Source *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: source === 'SUPPLIER' ? 700 : 400 }}>
                    <input type="radio" checked={source === 'SUPPLIER'} onChange={() => { setSource('SUPPLIER'); setSupplierId(''); }} /> Supplier
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: source === 'MANDI' ? 700 : 400 }}>
                    <input type="radio" checked={source === 'MANDI'} onChange={() => { setSource('MANDI'); setSupplierId('mandi'); }} /> Mandi
                  </label>
                </div>
              </div>
              {source === 'SUPPLIER' && (
                <div className="va-field">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Supplier *
                    <button type="button" className="va-btn link small p-0" style={{ fontSize: 11 }} onClick={() => setShowAddSupplierModal(true)}>+ New</button>
                  </label>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required={source === 'SUPPLIER'}>
                    <option value="">— Select —</option>
                    {suppliers.filter(s => s.name !== 'Mandi').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div className="va-field">
                <label>Purchase Date *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
            </div>

            <div className="card-divider" style={{ margin: '4px 0 16px' }} />

            {/* ── Product Catalog ── */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--forest)' }}>
                  🛒 Select Products &amp; Enter Rates
                  {(() => {
                    const validCount = items.filter(i => (i.itemName || (i as any).name) && Number(i.qty) > 0).length;
                    return validCount > 0 ? (
                      <span style={{ marginLeft: 10, background: 'var(--forest)', color: '#fff', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                        {validCount} selected
                      </span>
                    ) : null;
                  })()}
                </div>
                <input
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="🔍 Search product..."
                  style={{ padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--paper)', color: 'var(--ink)', fontSize: 13, width: 200 }}
                />
              </div>

              {Object.entries(grouped).map(([cat, prods]) => (
                <div key={cat} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--line-soft)' }}>
                    {catLabels[cat] || cat}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap: 8 }}>
                    {prods.map(prod => {
                      const itemIdx = items.findIndex(it => it.productId === prod.id);
                      const isSelected = itemIdx >= 0;
                      const item = isSelected ? items[itemIdx] : null;
                      return (
                        <div
                          key={prod.id}
                          style={{
                            border: isSelected ? '2px solid var(--forest)' : '1.5px solid var(--line)',
                            borderRadius: 10,
                            background: isSelected ? 'rgba(31,61,43,0.06)' : 'var(--paper)',
                            padding: '10px 10px 8px',
                            transition: 'all 0.15s ease',
                            cursor: 'pointer',
                          }}
                        >
                          {/* Product header — click to toggle */}
                          <div
                            onClick={() => toggleProduct(prod)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isSelected ? 10 : 0 }}
                          >
                            <ProductVisual name={prod.name} size={22} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              {prod.urduName && (
                                <div style={{
                                  fontFamily: "'Jameel Khushkhat L','Noto Nastaliq Urdu',serif",
                                  fontSize: 15,
                                  fontWeight: 700,
                                  color: 'var(--ink)',
                                  lineHeight: 1.3,
                                  direction: 'rtl',
                                  textAlign: 'right',
                                }}>{prod.urduName}</div>
                              )}
                              <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500, lineHeight: 1.2 }}>{prod.name}</div>
                            </div>
                            <div style={{
                              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                              border: isSelected ? 'none' : '2px solid var(--line)',
                              background: isSelected ? 'var(--forest)' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: 13, fontWeight: 700,
                              transition: 'all 0.15s'
                            }}>
                              {isSelected ? '✓' : ''}
                            </div>
                          </div>

                          {/* Qty / Unit / Rate fields — shown when selected */}
                          {isSelected && item && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }} onClick={e => e.stopPropagation()}>
                              <div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>QTY</div>
                                <input
                                  type="number"
                                  value={item.qty}
                                  min="0.01"
                                  step="0.01"
                                  onChange={e => updateItem(itemIdx, 'qty', +e.target.value)}
                                  onClick={e => (e.target as HTMLInputElement).select()}
                                  style={{ width: '100%', padding: '5px 6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', fontSize: 13, fontWeight: 700 }}
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>UNIT</div>
                                <select
                                  value={item.unit}
                                  onChange={e => updateItem(itemIdx, 'unit', e.target.value)}
                                  style={{ width: '100%', padding: '5px 4px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }}
                                >
                                  {UNITS.map(u => <option key={u}>{u}</option>)}
                                </select>
                              </div>
                              <div>
                                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, marginBottom: 2 }}>RATE (Rs)</div>
                                <input
                                  type="number"
                                  value={item.rate || ''}
                                  min="0"
                                  step="0.01"
                                  placeholder="0"
                                  onChange={e => updateItem(itemIdx, 'rate', +e.target.value)}
                                  onClick={e => (e.target as HTMLInputElement).select()}
                                  style={{ width: '100%', padding: '5px 6px', border: '1.5px solid var(--mustard)', borderRadius: 6, background: 'var(--paper)', color: 'var(--forest)', fontSize: 13, fontWeight: 700 }}
                                />
                              </div>
                              {/* Reference Information Labels — guidance only, does not overwrite purchase price */}
                              {(() => {
                                const refKey = prod.id || prod.name.toLowerCase().trim();
                                const ref = productRefMap.get(refKey) || productRefMap.get(prod.name.toLowerCase().trim());
                                if (!ref) return null;
                                return (
                                  <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--muted)', padding: '3px 6px', background: 'rgba(0,0,0,0.03)', borderRadius: 4, display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                                    <span>Prev Price: <strong style={{ color: 'var(--ink)' }}>Rs {ref.prevPrice > 0 ? ref.prevPrice : '—'}</strong></span>
                                    <span>Avg Cost: <strong style={{ color: 'var(--ink)' }}>Rs {ref.avgCost > 0 ? ref.avgCost : '—'}</strong> ({ref.qty} {prod.defaultUnit || 'KG'})</span>
                                  </div>
                                );
                              })()}
                              {item.rate > 0 && (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'right', fontSize: 12, color: 'var(--forest)', fontWeight: 700, marginTop: 2 }}>
                                  = Rs {(item.qty * item.rate).toLocaleString()}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Totals & Extra Fields ── */}
            {items.length > 0 && (
              <>
                <div className="card-divider" style={{ margin: '0 0 14px' }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <div className="va-field">
                    <label>Transport Cost (Rs)</label>
                    <input type="number" value={transportCost} min="0" onChange={e => setTransportCost(+e.target.value)} />
                  </div>
                  <div className="va-field">
                    <label>Amount Paid (Rs)</label>
                    <input type="number" value={paid} min="0" onChange={e => setPaid(+e.target.value)} />
                    {source !== 'MANDI' && paid > total && (
                      <span style={{ color: '#B5533C', fontSize: 11, fontWeight: 700, marginTop: 4, display: 'block' }}>
                        ⚠️ Paid exceeds total
                      </span>
                    )}
                  </div>
                  <div className="va-field">
                    <label>Notes</label>
                    <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional note" />
                  </div>
                </div>

                <div style={{
                  background: 'var(--forest)', color: '#fff', padding: '12px 16px',
                  borderRadius: 10, marginBottom: 14,
                  display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, fontWeight: 600
                }}>
                  <span>Items: <strong>{items.length}</strong></span>
                  <span>Subtotal: <span className="mono">{fmtMoney(subtotal)}</span></span>
                  {transportCost > 0 && <span>Transport: <span className="mono">+{fmtMoney(transportCost)}</span></span>}
                  <span style={{ fontSize: 16 }}>Total: <strong className="mono">{fmtMoney(total)}</strong></span>
                  <span style={{ color: balance > 0 ? '#FFD580' : '#A7F3D0' }}>Balance: <strong className="mono">{fmtMoney(balance)}</strong></span>
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" className="va-btn" disabled={saving || items.length === 0}>
                {saving ? 'Saving…' : purchaseId ? '✓ Update Purchase' : `✓ Save Purchase (${items.length} items)`}
              </button>
              {purchaseId && <button type="button" className="va-btn secondary" onClick={handleCancelForm}>Cancel Edit</button>}
            </div>
          </form>
        )}
      </div>

      {/* Add Supplier Modal */}
      {showAddSupplierModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div className="va-panel" style={{ width: '100%', maxWidth: '400px', margin: 0 }}>
            <div className="va-panel-head">
              <h3>Create New Supplier</h3>
              <button className="va-btn secondary small" onClick={() => setShowAddSupplierModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSupplier}>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Supplier Name *</label>
                <input required value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} placeholder="e.g. Aslam Khan" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Phone Number</label>
                <input value={newSupplierPhone} onChange={e => setNewSupplierPhone(e.target.value)} placeholder="e.g. 03001234567" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 16 }}>
                <label>Address</label>
                <input value={newSupplierAddress} onChange={e => setNewSupplierAddress(e.target.value)} placeholder="e.g. Sabzi Mandi Shop #12" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button type="button" className="va-btn secondary" onClick={() => setShowAddSupplierModal(false)}>Cancel</button>
                <button type="submit" className="va-btn">Save Supplier</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Conflict Modal (Same voucher duplicates) */}
      {showMergeModal && mergeData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div className="va-panel" style={{ width: '100%', maxWidth: '460px', margin: 0, border: '1px solid var(--danger)' }}>
            <div className="va-panel-head">
              <h3 style={{ color: 'var(--clay)' }}>⚠️ Price Conflict Warning</h3>
              <button className="va-btn secondary small" onClick={() => { setShowMergeModal(false); setMergeData(null); }}>✕</button>
            </div>
            <div style={{ padding: '16px', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6 }}>
              <p style={{ margin: 0 }}>
                This product (<strong>{mergeData.itemName}</strong>) has already been added to the purchase list.
              </p>
              <p style={{ margin: '10px 0 0 0' }}>
                The existing Buy Rate is <strong className="mono">Rs {mergeData.rate1}</strong>, but the new Buy Rate is <strong className="mono">Rs {mergeData.rate2}</strong>.
              </p>
              <p style={{ margin: '12px 0 0 0', fontWeight: 500 }}>
                Please confirm which Buy Rate should be used before merging the quantities:
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 16px' }}>
              <button 
                type="button" 
                className="va-btn" 
                style={{ width: '100%', display: 'block' }}
                onClick={() => handleResolveMerge(mergeData.rate1)}
              >
                Keep Existing Buy Rate (Rs {mergeData.rate1})
              </button>
              <button 
                type="button" 
                className="va-btn" 
                style={{ width: '100%', background: 'var(--clay)', display: 'block' }}
                onClick={() => handleResolveMerge(mergeData.rate2)}
              >
                Replace with New Buy Rate (Rs {mergeData.rate2})
              </button>
              <button 
                type="button" 
                className="va-btn secondary" 
                style={{ width: '100%', display: 'block' }}
                onClick={() => { setShowMergeModal(false); setMergeData(null); }}
              >
                Cancel and edit the Buy Rate before saving
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Conflict Warning Modal */}
      {showPriceConflictModal && priceConflictData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div className="va-panel" style={{ width: '100%', maxWidth: '480px', margin: 0, border: '2px solid var(--mustard)' }}>
            <div className="va-panel-head">
              <h3 style={{ color: 'var(--ink)' }}>⚠️ Purchase Price Warning</h3>
              <button className="va-btn secondary small" onClick={() => { setShowPriceConflictModal(false); setPriceConflictData(null); }}>✕</button>
            </div>
            <div style={{ padding: '16px', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6 }}>
              <div style={{
                fontFamily: "'Jameel Khushkhat L','Noto Nastaliq Urdu',serif",
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--forest)',
                direction: 'rtl',
                textAlign: 'right',
                marginBottom: 8,
              }}>
                نئی خریداری کی قیمت پچھلی خریداری کی قیمت سے مختلف ہے۔
              </div>
              <p style={{ margin: '0 0 12px 0', fontWeight: 600 }}>
                Purchase price differs from the previous purchase price.
              </p>

              <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{priceConflictData.itemName}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block' }}>Previous Purchase Price (پچھلی قیمت)</span>
                    <strong className="mono" style={{ color: 'var(--ink)', fontSize: 14 }}>Rs {priceConflictData.prevPrice} / {priceConflictData.unit}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted)', fontSize: 11, display: 'block' }}>New Purchase Price (نئی قیمت)</span>
                    <strong className="mono" style={{ color: 'var(--forest)', fontSize: 15 }}>Rs {priceConflictData.newPrice} / {priceConflictData.unit}</strong>
                  </div>
                </div>
              </div>

              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                Clicking <strong>Continue / Override</strong> will save this purchase using your entered price (Rs {priceConflictData.newPrice}).
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, padding: '0 16px 16px', justifyContent: 'flex-end' }}>
              <button 
                type="button" 
                className="va-btn secondary" 
                onClick={() => { setShowPriceConflictModal(false); setPriceConflictData(null); }}
              >
                Cancel / Edit Price
              </button>
              <button 
                type="button" 
                className="va-btn" 
                style={{ background: 'var(--forest)', color: '#fff' }}
                onClick={() => {
                  const listToSave = priceConflictData.currentList;
                  setShowPriceConflictModal(false);
                  setPriceConflictData(null);
                  savePurchaseToDb(listToSave);
                }}
              >
                Continue / Override (Rs {priceConflictData.newPrice})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Search Section */}
      <div className="va-panel" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 Search supplier, items, notes..."
            style={{ flex: 2, minWidth: 200, padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
          />
          <select
            value={filterSupplier}
            onChange={e => setFilterSupplier(e.target.value)}
            style={{ flex: 1, minWidth: 140, padding: '6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
          >
            <option value="all">All Sources</option>
            <option value="mandi">Mandi</option>
            {suppliers.filter(s => s.name !== 'Mandi').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={filterProduct}
            onChange={e => setFilterProduct(e.target.value)}
            style={{ flex: 1, minWidth: 140, padding: '6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
          >
            <option value="all">All Products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="date"
              value={filterDate}
              onChange={e => setFilterDate(e.target.value)}
              style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
            />
            {filterDate && (
              <button
                type="button"
                className="va-btn secondary small"
                onClick={() => setFilterDate('')}
                title="Show All History"
                style={{ padding: '4px 8px', fontSize: 11 }}
              >
                Show All
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="va-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <h3>Purchase History</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="va-btn secondary small" onClick={exportToCSV}>📥 Export CSV</button>
            <button className="va-btn secondary small" onClick={() => load()}>↻ Refresh</button>
          </div>
        </div>
        {loading && purchases.length === 0 ? <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div> : filteredPurchases.length === 0 ? (
          <div className="va-empty"><div className="big">No purchases found</div></div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hide-mobile">
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table className="va-table" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th>Source/Supplier</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th className="mono" style={{ textAlign: 'right' }}>Subtotal</th>
                    <th className="mono" style={{ textAlign: 'right' }}>Transport</th>
                    <th className="mono" style={{ textAlign: 'right' }}>Total</th>
                    <th className="mono" style={{ textAlign: 'right' }}>Paid</th>
                    <th className="mono" style={{ textAlign: 'right' }}>Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPurchases.map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.supplier?.name}</td>
                      <td style={{ color: 'var(--muted)' }}>{fmtDate(p.date)}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{p.items?.map(i => `${i.itemName} ${i.qty}${i.unit}`).join(', ')}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(p.subtotal)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>{p.transportCost > 0 ? fmtMoney(p.transportCost) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(p.total)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>{fmtMoney(p.paid)}</td>
                      <td className="mono" style={{ textAlign: 'right', color: p.balance > 0 ? 'var(--clay)' : undefined }}>{fmtMoney(p.balance)}</td>
                      <td><Badge status={p.status} isMandi={p.supplier?.name === 'Mandi'} /></td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="va-btn secondary small" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleEditClick(p)}>Edit</button>
                          <button className="va-btn secondary small" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handlePrintClick(p)}>Print</button>
                          <button className="va-btn secondary small" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleDownloadClick(p)}>💾 Download PDF</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 700 }}>Totals</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.subtotal, 0))}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.transportCost, 0))}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--forest)' }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.total, 0))}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)', fontWeight: 700 }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.paid, 0))}</td>
                    <td className="mono" style={{ textAlign: 'right', color: 'var(--clay)', fontWeight: 700 }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.balance, 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
              </div>
            </div>

            {/* Mobile Card List View */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
              {filteredPurchases.map(p => (
                <MobileCard
                  key={p.id}
                  title={p.supplier?.name ?? 'Supplier'}
                  headerBadge={fmtDate(p.date)}
                  footer={
                    <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
                      <button className="va-btn secondary small" style={{ flex: '1 1 30%', fontWeight: 700 }} onClick={() => handleEditClick(p)}>✏️ Edit</button>
                      <button className="va-btn small" style={{ flex: '1 1 30%', fontWeight: 700 }} onClick={() => handlePrintClick(p)}>🖨️ Print</button>
                      <button className="va-btn secondary small" style={{ flex: '1 1 30%', fontWeight: 700 }} onClick={() => handleDownloadClick(p)}>💾 PDF</button>
                    </div>
                  }
                >
                  <MobileCardRow label="Total Amount" value={fmtMoney(p.total)} isMono />
                  {p.transportCost > 0 && (
                    <MobileCardRow label="Transport Cost" value={fmtMoney(p.transportCost)} isMono />
                  )}
                  <MobileCardRow label="Balance Due" value={fmtMoney(p.balance)} valueColor={p.balance > 0 ? '#991B1B' : '#166534'} isMono />
                  <MobileCardRow label="Status">
                    <Badge status={p.status} small isMandi={p.supplier?.name === 'Mandi'} />
                  </MobileCardRow>

                  {p.items && p.items.length > 0 && (
                    <MobileCardBox title={`Purchase Items (${p.items.length})`}>
                      {p.items.map(item => (
                        <div key={item.id || item.itemName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#15803D', fontWeight: 600, margin: '3px 0' }}>
                          <span>• {item.itemName}</span>
                          <span style={{ color: '#166534', fontWeight: 700 }}>{item.qty} {item.unit} @ Rs {item.rate}</span>
                        </div>
                      ))}
                    </MobileCardBox>
                  )}
                </MobileCard>
              ))}
            </div>

            <div style={{
              marginTop: '10px',
              padding: '12px 14px',
              background: 'rgba(0,0,0,0.03)',
              borderRadius: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span>Total Purchases</span>
                <span className="mono" style={{ fontWeight: 700 }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.total, 0))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span>Total Paid</span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.paid, 0))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span>Total Payables</span>
                <span className="mono" style={{ fontWeight: 700, color: 'var(--clay)' }}>{fmtMoney(filteredPurchases.reduce((s, p) => s + p.balance, 0))}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
