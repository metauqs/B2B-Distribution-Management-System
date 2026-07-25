'use client';

import { useEffect, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, todayInputDate } from '@/utils/formatters';
import { loadBrandConfig, generatePurchaseHTML, openPrintWindow, writeAndPrint, openDownloadWindow, writeAndDownload } from '@/utils/documentTemplates';

interface PurchaseItem { id?: string; itemName: string; qty: number; unit: string; rate: number; amount: number; productId?: string; }
interface Purchase {
  id: string; date: string; subtotal: number; transportCost: number; total: number; paid: number; balance: number; status: string; notes?: string;
  supplierId: string; supplier?: { id: string; name: string; } | null;
  items?: PurchaseItem[];
}
interface Supplier { id: string; name: string; currentBalance: number; }
interface Product  { id: string; name: string; }

const blankItem = (): PurchaseItem => ({ itemName: '', qty: 1, unit: 'KG', rate: 0, amount: 0 });

function Badge({ status, small, isMandi }: { status: string; small?: boolean; isMandi?: boolean }) {
  if (isMandi) {
    return <span className={`va-badge paid ${small ? 'small' : ''}`}>PURCHASED</span>;
  }
  const cls = status === 'PAID' ? 'paid' : status === 'PARTIAL' ? 'partial' : 'due';
  return <span className={`va-badge ${cls} ${small ? 'small' : ''}`}>{status}</span>;
}

export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products,  setProducts]  = useState<Product[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');
  const [formOpen,   setFormOpen]   = useState(false);

  // Form State
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [source,     setSource]     = useState<'SUPPLIER' | 'MANDI'>('SUPPLIER');
  const [supplierId, setSupplierId] = useState('');
  const [date,       setDate]       = useState(() => todayInputDate());
  const [items,      setItems]      = useState<PurchaseItem[]>([blankItem()]);
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

  const [showDbMergeModal, setShowDbMergeModal] = useState(false);
  const [dbMergeData, setDbMergeData] = useState<{
    itemName: string;
    dbRate: number;
    formRate: number;
    itemIndex: number;
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

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, sRes, prRes] = await Promise.all([
      fetch('/api/purchases'),
      fetch('/api/suppliers'),
      fetch('/api/products'),
    ]);
    const [pd, sd, prd] = await Promise.all([pRes.json(), sRes.json(), prRes.json()]);
    if (pd.success)  setPurchases(pd.data);
    if (sd.success)  setSuppliers(sd.data);
    if (prd.success) setProducts(prd.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateItem = (index: number, key: keyof PurchaseItem, val: string | number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      
      let productId = item.productId;
      if (key === 'itemName') {
        const prod = products.find(p => p.name === val);
        productId = prod ? prod.id : undefined;
      }
      
      const updated = { ...item, [key]: val, productId };
      updated.amount = updated.qty * updated.rate;
      return updated;
    }));
  };

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const total    = subtotal + transportCost;
  const balance  = total - paid;

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSupplierName.trim()) return showToast('Supplier name is required');
    try {
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSupplierName, phone: newSupplierPhone, address: newSupplierAddress })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Supplier created successfully');
        const sRes = await fetch('/api/suppliers');
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
    })) : [blankItem()]);
    setPaid(p.paid);
    setTransportCost(p.transportCost);
    setNotes(p.notes ?? '');
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteClick = async (pId: string) => {
    if (!confirm('Are you sure you want to cancel and delete this purchase entry? This will reverse inventory stock levels.')) return;
    try {
      const res = await fetch(`/api/purchases/${pId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('✅ Purchase deleted & stock levels adjusted');
        await load();
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
    const brand = await loadBrandConfig();
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
    const brand = await loadBrandConfig();
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

  const getDbDuplicate = (currentItems: PurchaseItem[]) => {
    const dayStr = date.slice(0, 10);
    const sameDayPurchases = purchases.filter(p => p.date.startsWith(dayStr) && p.id !== purchaseId);
    
    for (let i = 0; i < currentItems.length; i++) {
      const item = currentItems[i];
      const name = item.itemName.trim().toLowerCase();
      if (!name) continue;
      
      for (const p of sameDayPurchases) {
        const matched = p.items?.find(it => 
          (item.productId && it.productId === item.productId) || 
          (it.itemName.toLowerCase() === name)
        );
        if (matched && matched.rate !== item.rate) {
          return {
            itemName: item.itemName,
            dbRate: matched.rate,
            formRate: item.rate,
            itemIndex: i,
            currentList: currentItems
          };
        }
      }
    }
    return null;
  };

  const savePurchaseToDb = async (itemsToSave: PurchaseItem[]) => {
    const finalSupplierId = source === 'MANDI' ? 'mandi' : supplierId;
    setSaving(true);
    try {
      const url = purchaseId ? `/api/purchases/${purchaseId}` : '/api/purchases';
      const method = purchaseId ? 'PATCH' : 'POST';

      const res  = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId: finalSupplierId, items: itemsToSave, paid, transportCost, notes, date }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(purchaseId ? '✅ Purchase updated successfully' : '✅ Purchase saved — stock updated');
        handleCancelForm();
        await load();
      } else showToast('❌ ' + (data.error ?? 'Failed'));
    } catch {
      showToast('❌ Network error saving purchase');
    } finally {
      setSaving(false);
    }
  };

  const checkAndSave = (currentItems: PurchaseItem[]) => {
    // 1. Check for duplicates in the current form
    const dup = findDuplicateItems(currentItems);
    if (dup) {
      const item1 = currentItems[dup.index1];
      const item2 = currentItems[dup.index2];
      
      if (item1.rate === item2.rate) {
        // Automatically merge if rates are the same
        const merged = [...currentItems];
        merged[dup.index1].qty += item2.qty;
        merged[dup.index1].amount = merged[dup.index1].qty * item1.rate;
        const filtered = merged.filter((_, idx) => idx !== dup.index2);
        setItems(filtered);
        checkAndSave(filtered);
      } else {
        // Show merge modal for different rates
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

    // 2. Check for rate conflicts with previously saved purchases on the same day
    const dbDup = getDbDuplicate(currentItems);
    if (dbDup) {
      setDbMergeData({
        itemName: dbDup.itemName,
        dbRate: dbDup.dbRate,
        formRate: dbDup.formRate,
        itemIndex: dbDup.itemIndex,
        currentList: dbDup.currentList
      });
      setShowDbMergeModal(true);
      return;
    }

    // No duplicates, proceed to save
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

  const handleResolveDbMerge = (useRate: number) => {
    if (!dbMergeData) return;
    const { itemIndex, currentList } = dbMergeData;
    
    const updated = [...currentList];
    updated[itemIndex].rate = useRate;
    updated[itemIndex].amount = updated[itemIndex].qty * useRate;
    setItems(updated);
    
    setShowDbMergeModal(false);
    setDbMergeData(null);
    
    setTimeout(() => {
      checkAndSave(updated);
    }, 50);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSupplierId = source === 'MANDI' ? 'mandi' : supplierId;
    if (!finalSupplierId) return showToast('Please select a supplier');
    if (!date) return showToast('Purchase date is required');
    if (items.some(i => !i.itemName || i.qty <= 0 || i.rate <= 0)) return showToast('All items need name, qty > 0 & rate > 0');
    
    const subtotalCalc = items.reduce((s, i) => s + (i.qty * i.rate), 0);
    const totalCalc = subtotalCalc + (transportCost ?? 0);
    if (source !== 'MANDI' && paid > totalCalc) {
      return showToast(`❌ Amount paid (Rs ${paid.toLocaleString()}) cannot exceed total purchase amount (Rs ${totalCalc.toLocaleString()})`);
    }
    
    checkAndSave(items);
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

  return (
    <DashboardLayout>
      {toast && <div className="va-toast">{toast}</div>}

      <div className="va-panel">
        <div className="va-panel-head">
          <h3>{purchaseId ? '✏️ Edit Purchase' : 'Record Purchase'}</h3>
          <button className="va-btn secondary small" onClick={purchaseId ? handleCancelForm : () => setFormOpen(f => !f)}>
            {formOpen ? '✕ Cancel' : '+ New Purchase'}
          </button>
        </div>

        {formOpen && (
          <form onSubmit={handleSubmit}>
            <div className="va-form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div className="va-field">
                <label>Purchase Source *</label>
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={source === 'SUPPLIER'} onChange={() => { setSource('SUPPLIER'); setSupplierId(''); }} />
                    Supplier
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" checked={source === 'MANDI'} onChange={() => { setSource('MANDI'); setSupplierId('mandi'); }} />
                    Mandi
                  </label>
                </div>
              </div>

              {source === 'SUPPLIER' && (
                <div className="va-field">
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Supplier *
                    <button type="button" className="va-btn link small p-0" style={{ fontSize: 11 }} onClick={() => setShowAddSupplierModal(true)}>+ New Supplier</button>
                  </label>
                  <select value={supplierId} onChange={e => setSupplierId(e.target.value)} required={source === 'SUPPLIER'}>
                    <option value="">— Select supplier —</option>
                    {suppliers.filter(s => s.name !== 'Mandi').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              <div className="va-field">
                <label>Purchase Date *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
            </div>

            <div className="card-divider" style={{ margin: '16px 0' }} />

            {items.map((item, i) => (
              <div key={i} className="va-item-row">
                <div className="va-field" style={{ flex: 3 }}>
                  {i === 0 && <label>Item</label>}
                  <input list={`prod-${i}`} value={item.itemName} onChange={e => updateItem(i, 'itemName', e.target.value)} placeholder="Product name" required />
                  <datalist id={`prod-${i}`}>{products.map(p => <option key={p.id} value={p.name} />)}</datalist>
                </div>
                <div className="va-field" style={{ flex: 1 }}>
                  {i === 0 && <label>Qty</label>}
                  <input type="number" value={item.qty} min="0.01" step="0.01" onChange={e => updateItem(i, 'qty', +e.target.value)} required />
                </div>
                <div className="va-field" style={{ flex: 1 }}>
                  {i === 0 && <label>Unit</label>}
                  <select value={item.unit} onChange={e => updateItem(i, 'unit', e.target.value)}>
                    {['KG','G','DOZEN','PIECE','BOX','CRATE'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>
                <div className="va-field" style={{ flex: 1 }}>
                  {i === 0 && <label>Buy Rate (Rs)</label>}
                  <input type="number" value={item.rate} min="0.01" step="0.01" onChange={e => updateItem(i, 'rate', +e.target.value)} required />
                </div>
                <div className="va-field" style={{ flex: 1 }}>
                  {i === 0 && <label>Amount</label>}
                  <input readOnly value={fmtMoney(item.amount)} className="mono" style={{ background: 'var(--line-soft)' }} />
                </div>
                {items.length > 1 && (
                  <button type="button" onClick={() => setItems(p => p.filter((_, j) => j !== i))}
                    style={{ alignSelf: 'flex-end', padding: '6px 10px', background: 'none', border: '1px solid var(--line)', borderRadius: 4, cursor: 'pointer', color: 'var(--danger)', marginBottom: 6 }}>✕</button>
                )}
              </div>
            ))}

            <button type="button" className="va-btn secondary small" onClick={() => setItems(p => [...p, blankItem()])} style={{ marginBottom: 12 }}>+ Add Item</button>

            <div className="va-form-row">
              <div className="va-field"><label>Transport Cost (Rs)</label><input type="number" value={transportCost} min="0" onChange={e => setTransportCost(+e.target.value)} /></div>
              <div className="va-field">
                <label>Amount Paid (Rs)</label>
                <input type="number" value={paid} min="0" onChange={e => setPaid(+e.target.value)} />
                {source !== 'MANDI' && paid > total && (
                  <span style={{ color: '#B5533C', fontSize: 11, fontWeight: 700, marginTop: 4, display: 'block' }}>
                    ⚠️ Amount paid (Rs {paid.toLocaleString()}) exceeds total (Rs {total.toLocaleString()})
                  </span>
                )}
              </div>
              <div className="va-field"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
            </div>

            <div style={{ background: 'var(--line-soft)', padding: '12px 14px', borderRadius: 6, marginBottom: 14, display: 'flex', gap: 24, fontSize: 13, fontWeight: 600 }}>
              <span>Subtotal: <span className="mono">{fmtMoney(subtotal)}</span></span>
              {transportCost > 0 && <span>Transport: <span className="mono">+{fmtMoney(transportCost)}</span></span>}
              <span>Total: <span className="mono" style={{ color: 'var(--forest)', fontSize: 15 }}>{fmtMoney(total)}</span></span>
              <span>Balance: <span className="mono" style={{ color: balance > 0 ? 'var(--clay)' : 'var(--ok)' }}>{fmtMoney(balance)}</span></span>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="va-btn" disabled={saving}>{saving ? 'Saving…' : purchaseId ? '✓ Update Purchase' : '✓ Save Purchase'}</button>
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

      {/* DB Merge Conflict Modal (Cross-voucher same-day duplicates) */}
      {showDbMergeModal && dbMergeData && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px'
        }}>
          <div className="va-panel" style={{ width: '100%', maxWidth: '460px', margin: 0, border: '1px solid var(--danger)' }}>
            <div className="va-panel-head">
              <h3 style={{ color: 'var(--clay)' }}>⚠️ Price Conflict Warning</h3>
              <button className="va-btn secondary small" onClick={() => { setShowDbMergeModal(false); setDbMergeData(null); }}>✕</button>
            </div>
            <div style={{ padding: '16px', fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.6 }}>
              <p style={{ margin: 0 }}>
                This product (<strong>{dbMergeData.itemName}</strong>) has already been purchased today.
              </p>
              <p style={{ margin: '10px 0 0 0' }}>
                The existing Buy Rate is <strong className="mono">Rs {dbMergeData.dbRate}</strong>, but the new Buy Rate is <strong className="mono">Rs {dbMergeData.formRate}</strong>.
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
                onClick={() => handleResolveDbMerge(dbMergeData.dbRate)}
              >
                Keep Existing Buy Rate (Rs {dbMergeData.dbRate})
              </button>
              <button 
                type="button" 
                className="va-btn" 
                style={{ width: '100%', background: 'var(--clay)', display: 'block' }}
                onClick={() => handleResolveDbMerge(dbMergeData.formRate)}
              >
                Replace with New Buy Rate (Rs {dbMergeData.formRate})
              </button>
              <button 
                type="button" 
                className="va-btn secondary" 
                style={{ width: '100%', display: 'block' }}
                onClick={() => { setShowDbMergeModal(false); setDbMergeData(null); }}
              >
                Cancel and edit the Buy Rate before saving
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
            <button className="va-btn secondary small" onClick={load}>↻ Refresh</button>
          </div>
        </div>
        {loading ? <div className="va-loading">Loading…</div> : filteredPurchases.length === 0 ? (
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
                <div key={p.id} className="va-mobile-card">
                  <div className="card-header">
                    <span className="card-title" style={{ color: '#FFFFFF' }}>{p.supplier?.name}</span>
                    <span className="card-subtitle">{fmtDate(p.date)}</span>
                  </div>
                  
                  <div className="card-divider" />
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div className="card-info-row">
                      <span className="card-label">Items</span>
                      <span className="card-value" style={{ maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {p.items?.map(i => `${i.itemName} ${i.qty}${i.unit}`).join(', ')}
                      </span>
                    </div>
                    {p.transportCost > 0 && (
                      <div className="card-info-row">
                        <span className="card-label">Transport</span>
                        <span className="card-value">{fmtMoney(p.transportCost)}</span>
                      </div>
                    )}
                    <div className="card-info-row">
                      <span className="card-label">Total</span>
                      <span className="card-value amount">{fmtMoney(p.total)}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Balance</span>
                      <span className={`card-value ${p.balance > 0 ? 'danger' : ''}`}>{fmtMoney(p.balance)}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Status</span>
                      <span><Badge status={p.status} small isMandi={p.supplier?.name === 'Mandi'} /></span>
                    </div>
                  </div>

                  <div className="card-divider" />
                  
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%', flexWrap: 'wrap' }}>
                     <button className="card-btn" style={{ flex: '1 1 45%' }} onClick={() => handleEditClick(p)}>Edit</button>
                     <button className="card-btn primary" style={{ flex: '1 1 45%' }} onClick={() => handlePrintClick(p)}>Print</button>
                     <button className="card-btn" style={{ flex: '1 1 100%', background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)' }} onClick={() => handleDownloadClick(p)}>💾 Download PDF</button>
                   </div>
                </div>
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
