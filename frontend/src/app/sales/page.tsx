'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { MobileInvoiceCard } from '@/components/sales/MobileInvoiceCard';
import { MobileCard, MobileCardRow, MobileCardBadge } from '@/components/ui/MobileCard';
import { fmtMoney, fmtDate, fmtDateTime, todayInputDate } from '@/utils/formatters';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_SHORT, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonKPI, SkeletonTable } from '@/components/ui/Skeleton';
import { ProductAutocomplete } from '@/components/ui/ProductAutocomplete';
import { ProductVisual } from '@/components/ui/ProductVisual';
import { loadBrandConfig, loadBrandConfigWithLogo, generateInvoiceHTML, openPrintWindow, writeAndPrint, openDownloadWindow, writeAndDownload, generateTemplateImageBase64, generateTemplateJpgBase64, downloadImage, shareDocumentAsImageOnWhatsApp } from '@/utils/documentTemplates';
import Icon from '@mdi/react';
import { mdiReceipt } from '@mdi/js';
import dynamic from 'next/dynamic';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import { salesService } from '@/services/salesService';

const WhatsAppShareModal = dynamic(() => import('@/components/modals/WhatsAppShareModal').then(m => m.WhatsAppShareModal), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────

interface Client {
  id: string; name: string; ownerName?: string | null;
  phone?: string | null; whatsapp?: string | null;
  address?: string | null; deliveryLocation?: string | null; type: string;
  creditLimit: number; paymentTerms: number; openingBalance: number;
  currentBalance: number; totalSales: number; totalCollected: number;
  salesCount: number; lastOrderDate: string | null;
  rating: string;
}


interface PriceItem {
  productId: string; itemName: string; unit: string; sellRate: number;
  availableStock?: number; currentStock?: number;
  product?: { id: string; name: string; urduName?: string | null; emoji?: string | null; imageUrl?: string | null; category: string };
}

interface OrderItem {
  productId: string; itemName: string; unit: string; rate: number | string; qty: number | string; amount: number;
}

interface SaleItem {
  id: string; productId?: string | null; itemName: string; qty: number; unit: string; rate: number; amount: number;
  product?: { id: string; name: string; urduName?: string | null; emoji?: string | null; imageUrl?: string | null } | null;
}

interface DeliveryInfo { id: string; status: string; zone?: string | null; deliveredAt?: string | null; }

interface Sale {
  id: string; invoiceNo: string; date: string;
  isLocked?: boolean;
  subtotal: number; discount: number; deliveryCharge: number;
  previousBalance: number;
  previousBalanceDate?: string | null;
  total: number; paid: number; balance: number;
  paymentMode: string; status: string; deliveryStatus: string;
  notes?: string | null;
  client?: { id: string; clientId?: string | null; name: string; phone?: string | null; whatsapp?: string | null; address?: string | null; deliveryLocation?: string | null; type: string };
  items: SaleItem[];
  deliveries?: DeliveryInfo[];
  employeeId?: string | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  employee?: { id: string; name: string; phone?: string | null } | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLIENT_TYPES  = ['RETAIL', 'WHOLESALE', 'HOTEL', 'RESTAURANT', 'HOSTEL', 'CATERER', 'HOUSEHOLD', 'OTHER'];
const UNITS          = ['KG', 'G', 'DOZEN', 'PIECE', 'BOX', 'CRATE', 'BUNDLE', 'LITRE'];
const PAYMENT_MODES  = ['CASH', 'CREDIT', 'CHEQUE', 'ONLINE'];
const MODE_COLOR: Record<string, string> = { CASH: '#3E7A4E', CREDIT: '#B5533C', CHEQUE: '#7B5EA7', ONLINE: '#2563EB' };
const MODE_EMOJI: Record<string, string> = { CASH: '💵', CREDIT: '📒', CHEQUE: '🏦', ONLINE: '📱' };
const TYPE_EMOJI:   Record<string, string> = { RETAIL: '🛒', WHOLESALE: '🏭', HOTEL: '🏨', RESTAURANT: '🍽️', HOSTEL: '🏠', CATERER: '🍱', HOUSEHOLD: '👨‍👩‍👧', OTHER: '📦' };
const RATING_COLOR: Record<string, string>  = { GREEN: 'var(--ok)', YELLOW: 'var(--mustard)', ORANGE: '#E67E22', RED: 'var(--danger)', NEW: 'var(--muted)' };
const RATING_EMOJI: Record<string, string>  = { GREEN: '🟢', YELLOW: '🟡', ORANGE: '🟠', RED: '🔴', NEW: '⚪' };

const blankItem = (): OrderItem => ({ productId: '', itemName: '', unit: 'KG', rate: 0, qty: 1, amount: 0 });

// ─── Helper ───────────────────────────────────────────────────────────────────

function Badge({ status, small }: { status: string; small?: boolean }) {
  const cls = ['PAID', 'DELIVERED'].includes(status)          ? 'paid'
            : ['PARTIAL', 'OUT_FOR_DELIVERY'].includes(status) ? 'partial'
            : 'pending';
  return <span className={`va-badge ${cls}`} style={small ? { fontSize: 10 } : {}}>{status.replace(/_/g,' ')}</span>;
}

function ModeBadge({ mode, light }: { mode: string; light?: boolean }) {
  const color = light ? '#E2EFEB' : MODE_COLOR[mode];
  const bg = light ? 'rgba(255, 255, 255, 0.15)' : MODE_COLOR[mode] + '18';
  const border = light ? 'rgba(255, 255, 255, 0.3)' : MODE_COLOR[mode] + '40';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: bg, color: color, border: `1px solid ${border}` }}>
      {MODE_EMOJI[mode]} {mode}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type View = 'list' | 'new' | 'detail';
type Step = 1 | 2 | 3;

export default function SalesPage() {
  const [pState, setPState] = usePreservedState('sales', {
    view: 'list' as View,
    detailSaleId: '',
    srchInv: '',
    filterSt: 'all',
    filterMode: 'all',
    filterDate: todayInputDate(),
  });

  const view = pState.view;
  const setView = (v: View) => setPState({ view: v });

  const detailSaleId = pState.detailSaleId;
  const setDetailSaleId = (id: string) => setPState({ detailSaleId: id });

  const srchInv = pState.srchInv;
  const setSrchInv = (s: string) => setPState({ srchInv: s });

  const filterSt = pState.filterSt;
  const setFilterSt = (st: string) => setPState({ filterSt: st });

  const filterMode = pState.filterMode;
  const setFilterMode = (fm: string) => setPState({ filterMode: fm });

  const filterDate = pState.filterDate;
  const setFilterDate = (fd: string) => setPState({ filterDate: fd });

  const [step,     setStep]    = useState<Step>(1);
  const [toast,    setToast]   = useState('');

  // ── List state ──────────────────────────────────────────────────────────────
  const [sales,      setSales]      = useState<Sale[]>(() => {
    const targetDate = filterDate || todayInputDate();
    const p = new URLSearchParams({ limit: '100', from: targetDate, to: targetDate + 'T23:59:59' });
    return getCachedData<Sale[]>(`/api/sales?${p}`) || [];
  });
  const [loading,    setLoading]    = useState(() => {
    const targetDate = filterDate || todayInputDate();
    const p = new URLSearchParams({ limit: '100', from: targetDate, to: targetDate + 'T23:59:59' });
    return !getCachedData<Sale[]>(`/api/sales?${p}`);
  });
  const [todayCollectionsAmt, setTodayCollectionsAmt] = useState(() => {
    const targetDate = filterDate || todayInputDate();
    const collKey = `/api/collections?from=${targetDate}&to=${targetDate}T23:59:59&limit=100`;
    const cachedColls = getCachedData<any[]>(collKey);
    if (cachedColls && Array.isArray(cachedColls)) {
      return cachedColls.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
    }
    return 0;
  });
  const [debouncedSrchInv, setDebouncedSrchInv] = useState('');

  // ── New invoice state ────────────────────────────────────────────────────────
  const [clients,     setClients]     = useState<Client[]>([]);
  const [clientsLoad, setClientsLoad] = useState(false);
  const [clientSrch,  setClientSrch]  = useState('');
  const [debouncedClientSrch, setDebouncedClientSrch] = useState('');
  const [selClient,   setSelClient]   = useState<Client | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<any[]>(() => {
    const cached = getCachedData<any>('/api/products');
    return Array.isArray(cached) ? cached : (cached?.data || []);
  });
  const [priceItems,  setPriceItems]  = useState<PriceItem[]>([]);
  const [items,       setItems]       = useState<OrderItem[]>([blankItem()]);
  const [discount,    setDiscount]    = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [paid,        setPaid]        = useState(0);
  const [payMode,     setPayMode]     = useState('CREDIT');
  const [invNotes,    setInvNotes]    = useState('');
  const [invDate,     setInvDate]     = useState(() => todayInputDate());
  const [saving,         setSaving]         = useState(false);
  const [creditWarn,     setCreditWarn]     = useState(false);
  const [whatsappSharing, setWhatsappSharing] = useState(false);
  const [waShareModal, setWaShareModal] = useState<{ jpgBase64: string; whatsappUrl: string; filename: string; displayPhone?: string } | null>(null);

  // ── Same-Day Edit Mode & Audit Trail states ──
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [activeSalePrompt, setActiveSalePrompt] = useState<Sale | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const isInvoiceEditable = (s: Sale | null) => {
    if (!s) return false;
    if (s.status === 'CANCELLED') return false;
    if (s.isLocked) return false;
    return true;
  };

  const startEditInvoice = (sale: Sale) => {
    setEditingSale(sale);
    setSelClient(sale.client as any);
    setItems(sale.items.map(i => ({
      productId: i.productId || i.product?.id || '',
      itemName: i.itemName,
      unit: i.unit,
      rate: i.rate,
      qty: i.qty,
      amount: i.amount,
    })));
    setDiscount(sale.discount || 0);
    setDeliveryFee(sale.deliveryCharge || 0);
    setPaid(sale.paid || 0);
    setPayMode(sale.paymentMode || 'CREDIT');
    setInvNotes(sale.notes || '');
    setSelEmpId(sale.employeeId || '');
    setDelivDate(sale.deliveryDate ? sale.deliveryDate.slice(0, 10) : '');
    setDelivTime(sale.deliveryTime || 'PHASE 1 (11:00 AM - 02:00 PM)');
    setActiveSalePrompt(null);
    setStep(2);
    setView('new');
  };

  const cancelInvoiceDraft = () => {
    setEditingSale(null);
    setActiveSalePrompt(null);
    setSelClient(null);
    setItems([blankItem()]);
    setDiscount(0);
    setDeliveryFee(0);
    setPaid(0);
    setInvNotes('');
    setStep(1);
    setView('list');
  };

  const openAuditTrail = async (saleId: string) => {
    setShowAuditModal(true);
    setLoadingAudit(true);
    try {
      const logs = await salesService.getAuditTrail(saleId);
      setAuditLogs(logs);
    } catch (err) {
      console.error('Failed to load audit trail:', err);
      showToast('❌ Failed to load audit trail');
    } finally {
      setLoadingAudit(false);
    }
  };

  // ── Employee & Delivery states ──
  const [employees, setEmployees] = useState<any[]>([]);
  const [selEmpId, setSelEmpId] = useState('');
  const [delivDate, setDelivDate] = useState('');
  const [delivTime, setDelivTime] = useState('PHASE 1 (11:00 AM - 02:00 PM)');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSrchInv(srchInv);
    }, 350);
    return () => clearTimeout(handler);
  }, [srchInv]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedClientSrch(clientSrch);
    }, 350);
    return () => clearTimeout(handler);
  }, [clientSrch]);

  const loadEmployees = useCallback(async () => {
    try {
      const data = await fetchWithCache<any[]>('/api/employees?activeOnly=true', { ttl: TTL_MEDIUM });
      if (data) setEmployees(data);
    } catch (err) {
      console.error('loadEmployees error:', err);
    }
  }, []);

  // ── Quick Create Client modal state ──────────────────────────────────────────
  const [showAddClient,  setShowAddClient]  = useState(false);
  const [newClientForm,  setNewClientForm]  = useState({ name: '', ownerName: '', phone: '', whatsapp: '', address: '', type: 'RETAIL', creditLimit: 0, paymentTerms: 0 });
  const [savingClient,   setSavingClient]   = useState(false);

  // ── Detail state ─────────────────────────────────────────────────────────────
  const [detailSale, setDetailSale] = useState<Sale | null>(null);
  const [detailLoad, setDetailLoad] = useState(false);
  const [addPayAmt,  setAddPayAmt]  = useState(0);
  const [addPayBusy, setAddPayBusy] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadSales = useCallback(async (isBackground = false) => {
    const p = new URLSearchParams({ limit: '100' });
    if (debouncedSrchInv)      p.set('search', debouncedSrchInv);
    if (filterSt !== 'all')   p.set('status', filterSt);
    if (filterMode !== 'all') p.set('mode', filterMode);
    if (filterDate) {
      p.set('from', filterDate);
      p.set('to', filterDate + 'T23:59:59');
    }
    const targetDate = filterDate || new Date().toISOString().slice(0, 10);
    
    const salesKey = `/api/sales?${p}`;
    const collKey = `/api/collections?from=${targetDate}&to=${targetDate}T23:59:59&limit=100`;

    if (!isBackground && !getCachedData(salesKey)) setLoading(true);
    try {
      const [salesData, collData] = await Promise.all([
        fetchWithCache<any>(salesKey, { ttl: TTL_SHORT, forceRefresh: isBackground }),
        fetchWithCache<any>(collKey, { ttl: TTL_SHORT, forceRefresh: isBackground }),
      ]);

      if (salesData) setSales(salesData.data ?? (Array.isArray(salesData) ? salesData : []));

      const rawColl = collData?.data ?? collData;
      if (rawColl && Array.isArray(rawColl)) {
        const totalColl = rawColl.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
        setTodayCollectionsAmt(totalColl);
      } else {
        setTodayCollectionsAmt(0);
      }
    } catch (err) {
      console.error('loadSales error:', err);
    } finally {
      setLoading(false);
    }
  }, [debouncedSrchInv, filterSt, filterMode, filterDate]);

  // ── Load clients (with error guard) ─────────────────────────────────────────
  const loadClients = useCallback(async () => {
    setClientsLoad(true);
    try {
      const p = new URLSearchParams({ status: 'ACTIVE', minimal: 'true' });
      if (debouncedClientSrch.trim()) p.set('search', debouncedClientSrch.trim());
      const data = await fetchWithCache<Client[]>(`/api/clients?${p}`, { ttl: TTL_MEDIUM });
      if (data) setClients(data);
    } catch (err) {
      console.error('loadClients error:', err);
    }
    setClientsLoad(false);
  }, [debouncedClientSrch]);

  // ── Load today's price list & master catalog products ─────
  const loadPrices = useCallback(async (targetDate?: string, forceRefresh = false) => {
    try {
      const dateStr = targetDate || invDate || todayInputDate();
      const [priceData, prodData] = await Promise.all([
        fetchWithCache<any>(`/api/pricelist?date=${dateStr}`, { ttl: TTL_MEDIUM, forceRefresh }),
        fetchWithCache<any>('/api/products', { ttl: forceRefresh ? 0 : TTL_MEDIUM, forceRefresh }),
      ]);

      if (prodData) {
        const pList = Array.isArray(prodData) ? prodData : (prodData?.data ?? []);
        if (pList.length > 0) setCatalogProducts(pList);
      }

      const items = priceData?.items || priceData?.data?.items || (Array.isArray(priceData) ? priceData : []);
      if (items.length > 0) {
        setPriceItems(items);
      }
    } catch (err) {
      console.error('loadPrices error:', err);
    }
  }, [invDate]);

  // ── Single Source of Truth Product Visual Resolver ──────────────────────────
  const resolveItemVisuals = useCallback((item: { productId?: string | null; itemName?: string; product?: any }, productsOverride?: any[]) => {
    const pList = productsOverride && productsOverride.length > 0 ? productsOverride : catalogProducts;
    const pId = item.productId || item.product?.id;
    const rawName = (item.itemName || (item as any)?.name || '').toString().toLowerCase().trim();
    const prodById = pId ? pList.find(p => p.id === pId) : null;
    const prodByName = rawName ? pList.find(p => (p.name || '').toLowerCase().trim() === rawName) : null;
    const pItem = priceItems.find(p => (pId && p.productId === pId) || (rawName && (p.itemName || '').toLowerCase().trim() === rawName));

    const resolved = prodById || item.product || pItem?.product || prodByName;

    let imgUrl = resolved?.imageUrl || (item as any).imageUrl || null;
    if (imgUrl && resolved?.updatedAt && !imgUrl.includes('?v=')) {
      const ts = new Date(resolved.updatedAt).getTime();
      imgUrl = `${imgUrl}?v=${ts}`;
    }

    return {
      productId: pId || resolved?.id || null,
      urduName: resolved?.urduName || (item as any).urduName || '',
      imageUrl: imgUrl,
      emoji: resolved?.emoji || (item as any).emoji || null,
    };
  }, [catalogProducts, priceItems]);

  useEffect(() => {
    loadSales();
    loadPrices();
  }, [loadSales, loadPrices]);

  useEffect(() => {
    const handleRevalidate = () => {
      loadSales(true);
      loadPrices(undefined, true);
      if (view === 'new') {
        loadClients();
        loadEmployees();
      }
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [loadSales, loadClients, loadPrices, loadEmployees, view]);

  // ── Start new invoice — switch view immediately, load data in background ─────
  const startNew = () => {
    setStep(1);
    setSelClient(null);
    setClientSrch('');
    
    const cacheParams = new URLSearchParams({ status: 'ACTIVE', minimal: 'true' });
    const cachedClients = getCachedData<Client[]>(`/api/clients?${cacheParams}`);
    if (cachedClients) {
      setClients(cachedClients);
    } else {
      setClients([]);
    }

    const today = todayInputDate();
    const cachedPrices = getCachedData<any>(`/api/pricelist?date=${today}`) || getCachedData<any>('/api/pricelist/active');
    if (cachedPrices?.items && cachedPrices.items.length > 0) {
      setPriceItems(cachedPrices.items);
    } else if (cachedPrices?.data?.items && cachedPrices.data.items.length > 0) {
      setPriceItems(cachedPrices.data.items);
    }

    setItems([blankItem()]);
    setDiscount(0);
    setDeliveryFee(0);
    setPaid(0);
    setPayMode('CREDIT');
    setInvNotes('');
    setInvDate(todayInputDate());
    setCreditWarn(false);
    setShowAddClient(false);
    setSelEmpId('');
    setDelivDate(todayInputDate());
    setDelivTime('09:00 AM');
    setView('new');          // ← switch immediately so no await blocks the UI
    loadClients();           // load data async in background
    loadPrices(today);
    loadEmployees();
  };

  // Synchronize detailSale with preserved detailSaleId or fallback to list view
  useEffect(() => {
    if (view === 'detail') {
      if (detailSaleId && (!detailSale || detailSale.id !== detailSaleId)) {
        const cached = getCachedData<Sale>(`/api/sales/${detailSaleId}`);
        if (cached) {
          setDetailSale(cached);
          setDetailLoad(false);
        } else {
          setDetailLoad(true);
          fetchWithCache<Sale>(`/api/sales/${detailSaleId}`, { ttl: TTL_SHORT })
            .then(data => {
              if (data) setDetailSale(data);
              else setPState({ view: 'list', detailSaleId: '' });
            })
            .catch(() => setPState({ view: 'list', detailSaleId: '' }))
            .finally(() => setDetailLoad(false));
        }
      } else if (!detailSaleId && !detailSale && !detailLoad) {
        setPState({ view: 'list', detailSaleId: '' });
      }
    }
  }, [view, detailSaleId, detailSale, detailLoad, setPState]);

  // Re-load clients whenever search term changes while on the new-invoice view
  useEffect(() => {
    if (view === 'new') loadClients();
  }, [debouncedClientSrch, view, loadClients]);

  // ── Quick Create Client ───────────────────────────────────────────────────────
  const handleQuickCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientForm.name.trim()) return showToast('Business name is required');
    setSavingClient(true);
    try {
      const res  = await apiFetch('/api/clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newClientForm),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.ok && data.success) {
        showToast(`✅ Client "${data.data.name}" created`);
        setShowAddClient(false);
        setNewClientForm({ name: '', ownerName: '', phone: '', whatsapp: '', address: '', type: 'RETAIL', creditLimit: 0, paymentTerms: 0 });
        // Reload clients and auto-select the newly created one
        await loadClients();
        // Auto-select the new client with a computed balance of 0
        const newClient: Client = {
          ...data.data,
          currentBalance: data.data.openingBalance ?? 0,
          totalSales: 0, salesCount: 0, lastOrderDate: null, totalCollected: 0,
        };
        selectClient(newClient);
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to create client'));
      }
    } catch (err: any) {
      showToast('❌ ' + (err.message ?? 'Network error'));
    }
    setSavingClient(false);
  };

  // ── Select client → check active same-day invoice ─────────────────────────────
  const selectClient = async (c: Client) => {
    setSelClient(c);
    if (c.paymentTerms === 0) setPayMode('CASH');
    else setPayMode('CREDIT');
    setPaid(0);

    try {
      const active = await salesService.getActiveSale(c.id);
      if (active) {
        setActiveSalePrompt(active as any);
      } else {
        setActiveSalePrompt(null);
      }
    } catch (err) {
      console.error('Error checking active sale:', err);
      setActiveSalePrompt(null);
    }

    setStep(2);
  };

  // ── Item helpers ──────────────────────────────────────────────────────────────
  const updateItem = (i: number, key: keyof OrderItem, val: string | number) => {
    setItems(prev => {
      const next = [...prev];
      (next[i] as any)[key] = val;
      // auto-fill from price list when name changes
      if (key === 'itemName') {
        const match = priceItems.find(p =>
          p.itemName.toLowerCase() === (val as string).toLowerCase() ||
          p.product?.name.toLowerCase() === (val as string).toLowerCase()
        );
        if (match) {
          next[i].rate      = match.sellRate;
          next[i].unit      = match.unit;
          next[i].productId = match.productId;
        }
      }
      const numQty = parseFloat(String(next[i].qty)) || 0;
      const numRate = parseFloat(String(next[i].rate)) || 0;
      next[i].amount = numQty * numRate;
      return next;
    });
  };

  const selectProductForItem = (i: number, pItem: PriceItem) => {
    setItems(prev => {
      const next = [...prev];
      next[i].itemName  = pItem.itemName;
      next[i].productId = pItem.productId;
      next[i].unit      = pItem.unit;
      next[i].rate      = pItem.sellRate;
      const numQty = parseFloat(String(next[i].qty)) || 0;
      next[i].amount    = numQty * Number(pItem.sellRate);
      return next;
    });
  };

  // ── Computed totals ───────────────────────────────────────────────────────────
  const rawSubtotal = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const subtotal    = Math.round(rawSubtotal);
  const rawTotal    = subtotal - discount + deliveryFee;
  const total       = Math.max(0, Math.round(rawTotal));
  const balance     = Math.max(0, Math.round(total - paid));
  const grandTotal  = Math.round((selClient?.currentBalance ?? 0) + balance); // incl previous balance

  // Credit check
  useEffect(() => {
    if (selClient?.creditLimit && selClient.creditLimit > 0) {
      setCreditWarn((selClient.currentBalance + balance) > selClient.creditLimit);
    } else setCreditWarn(false);
  }, [balance, selClient]);

  // ── Submit invoice with Idempotent Lock ───────────────────────────────────────
  const { isSubmitting: isSubmittingInvoice, submit: executeSubmitInvoice } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      if (!selClient) {
        showToast('❌ Select a client first');
        return;
      }
      if (!selEmpId) {
        showToast('❌ Please select a Delivery Staff member');
        return;
      }

      const sanitizedItems = items
        .map(i => {
          const numQty = parseFloat(String(i.qty)) || 0;
          const numRate = parseFloat(String(i.rate)) || 0;
          return {
            productId: i.productId || undefined,
            itemName: i.itemName,
            unit: i.unit || 'KG',
            qty: numQty,
            rate: numRate,
            amount: numQty * numRate,
          };
        })
        .filter(i => i.itemName && i.qty > 0);

      if (!sanitizedItems.length) {
        showToast('❌ Add at least one item');
        return;
      }

      // Validate inventory stock availability before checkout (Delta-only when editing)
      for (const item of sanitizedItems) {
        const pItem = priceItems.find(p => (item.productId && p.productId === item.productId) || p.itemName.toLowerCase() === item.itemName.toLowerCase());
        
        let oldQty = 0;
        if (editingSale && editingSale.items) {
          const oldItem = editingSale.items.find(oi =>
            (item.productId && (oi.productId === item.productId || oi.product?.id === item.productId)) ||
            (oi.itemName && oi.itemName.toLowerCase() === item.itemName.toLowerCase())
          );
          if (oldItem) {
            oldQty = Number(oldItem.qty) - Number((oldItem as any).returnedQty || 0);
          }
        }

        const delta = item.qty - oldQty;

        // Only positive delta (additional quantity beyond what was already deducted) requires available stock check
        if (delta > 0 && pItem && pItem.availableStock !== undefined) {
          if (delta > pItem.availableStock) {
            if (editingSale && oldQty > 0) {
              showToast(`❌ Insufficient inventory stock for ${item.itemName}. Available: ${pItem.availableStock} ${item.unit}, Additional Required: ${delta} ${item.unit} (Current on invoice: ${oldQty} ${item.unit})`);
            } else {
              showToast(`❌ Insufficient inventory stock for ${item.itemName}. Available: ${pItem.availableStock} ${item.unit}, Requested: ${item.qty} ${item.unit}`);
            }
            return;
          }
        }
      }

      const calcSubtotal = sanitizedItems.reduce((s, i) => s + i.amount, 0);
      const calcTotal = Math.max(0, Math.round(calcSubtotal - Number(discount) + Number(deliveryFee)));
      if (paid > calcTotal) {
        showToast(`❌ Amount paid (Rs ${paid.toLocaleString()}) cannot exceed invoice total (Rs ${calcTotal.toLocaleString()})`);
        return;
      }

      if (editingSale) {
        const res = await apiFetch(`/api/sales/${editingSale.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            items: sanitizedItems,
            discount,
            deliveryCharge: deliveryFee,
            notes: invNotes,
            employeeId: selEmpId || undefined,
            deliveryDate: delivDate || undefined,
            deliveryTime: delivTime || undefined,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          invalidateCache('/api/sales');
          invalidateCache('/api/clients');
          invalidateCache('/api/inventory');
          invalidateCache('/api/collections');
          invalidateCache('/api/reports');
          window.dispatchEvent(new Event('app-revalidate'));
          showToast(`✅ Invoice #${data.data.invoiceNo} updated successfully`);
          setEditingSale(null);
          await loadSales(true);
          openDetail(data.data);
        } else {
          showToast('❌ ' + (data.error ?? 'Failed to edit invoice'));
        }
      } else {
        const res = await apiFetch('/api/sales', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            clientId: selClient.id,
            items: sanitizedItems,
            discount, deliveryCharge: deliveryFee,
            paid, paymentMode: payMode,
            notes: invNotes,
            employeeId: selEmpId || undefined,
            deliveryDate: delivDate || undefined,
            deliveryTime: delivTime || undefined,
            date: invDate || todayInputDate(),
            forceNew: true,
          }),
        });
        const data = await res.json();
        // Handle idempotency replay — backend returned the already-created invoice
        if (res.ok && data.success) {
          invalidateCache('/api/sales');
          invalidateCache('/api/clients');
          invalidateCache('/api/inventory');
          invalidateCache('/api/collections');
          invalidateCache('/api/reports');
          window.dispatchEvent(new Event('app-revalidate'));
          showToast(`✅ Invoice ${data.data.invoiceNo} ${data.replayed ? 'retrieved (already created)' : 'created'}`);
          await loadSales(true);
          openDetail(data.data);
        } else if (res.status === 409 && data.inProgress) {
          // Invoice is currently being generated — do NOT show error, do NOT allow retry
          // The useIdempotentSubmit inFlightRef is already blocking further clicks.
          // Show a clear waiting message so the admin does not click again.
          showToast('⏳ Invoice is being generated — please wait, do not click again.');
        } else {
          showToast('❌ ' + (data.error ?? 'Failed'));
        }
      }
    },
    onError: (err: any) => {
      showToast(`❌ ${err.message || 'Network error'}`);
    },
  });

  const handleSubmit = () => executeSubmitInvoice();

  // ── Open detail ───────────────────────────────────────────────────────────────
  const openDetail = async (s: Sale) => {
    setDetailSale(getCachedData(`/api/sales/${s.id}`));
    setAddPayAmt(0);
    setDetailLoad(true);
    setView('detail');
    try {
      const data = await fetchWithCache<Sale>(`/api/sales/${s.id}`, { ttl: TTL_SHORT });
      if (data) setDetailSale(data);
    } catch {
      // Keep cached sale if offline/error
    } finally {
      setDetailLoad(false);
    }
  };

  // ── Record additional payment ────────────────────────────────────────────────
  const recordPayment = async () => {
    if (!detailSale || addPayAmt <= 0) return;
    if (addPayAmt > detailSale.balance) {
      return showToast(`❌ Payment amount (Rs ${addPayAmt.toLocaleString()}) cannot exceed remaining balance (Rs ${detailSale.balance.toLocaleString()})`);
    }
    setAddPayBusy(true);
    const res  = await apiFetch(`/api/sales/${detailSale.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additionalPayment: addPayAmt }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      invalidateCache('/api/sales');
      invalidateCache('/api/clients');
      invalidateCache('/api/collections');
      invalidateCache('/api/reports');
      window.dispatchEvent(new Event('app-revalidate'));
      showToast('✅ Payment recorded');
      setAddPayAmt(0);
      await openDetail(detailSale);
      await loadSales(true);
    } else showToast('❌ ' + (data.error ?? 'Failed'));
    setAddPayBusy(false);
  };

  // ── Helper to ensure fresh Master Catalog products on invoice export ──────
  const getLiveCatalogProducts = async () => {
    if (catalogProducts && catalogProducts.length > 0) {
      return catalogProducts;
    }
    try {
      const prodRes = await fetchWithCache<any>('/api/products', { ttl: 30000 });
      const pList = prodRes?.data || (Array.isArray(prodRes) ? prodRes : []);
      if (pList && pList.length > 0) {
        setCatalogProducts(pList);
        return pList;
      }
    } catch (e) {
      console.warn('Failed to refresh live catalog:', e);
    }
    return catalogProducts;
  };

  // ── Print invoice ─────────────────────────────────────────────────────────────
  const printInvoice = async (s: Sale) => {
    // Open window synchronously first — avoids browser popup blocker
    const w = openPrintWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const [brand, liveCatalog] = await Promise.all([
      loadBrandConfigWithLogo(),
      getLiveCatalogProducts(),
    ]);
    const html = generateInvoiceHTML(
      {
        invoiceNo:           s.invoiceNo,
        date:                s.date,
        paymentMode:         s.paymentMode,
        status:              s.status,
        clientName:          s.client?.name ?? '—',
        clientId:            s.client?.clientId,
        clientPhone:         s.client?.phone,
        clientWhatsapp:      s.client?.whatsapp,
        clientType:          s.client?.type,
        clientAddress:       s.client?.address,
        deliveryLocation:    s.client?.deliveryLocation,
        employeeName:        s.employee?.name,
        employeePhone:       s.employee?.phone,
        deliveryDate:        s.deliveryDate,
        deliveryTime:        s.deliveryTime,
        items: s.items.map(i => {
          const vis = resolveItemVisuals(i, liveCatalog);
          return {
            itemName: i.itemName,
            qty:      i.qty,
            unit:     i.unit,
            rate:     i.rate,
            amount:   i.amount,
            urduName: vis.urduName,
            imageUrl: vis.imageUrl,
            emoji:    vis.emoji,
            productId: vis.productId,
            returnedQty: (i as any).returnedQty,
            returnReason: (i as any).returnReason,
          };
        }),
        previousBalance:     s.previousBalance,
        previousBalanceDate: s.previousBalanceDate,
        total:               s.total,
        paid:                s.paid,
        balance:             s.balance,
        notes:               s.notes,
      },
      brand,
      window.location.origin,
    );
    writeAndPrint(w, html, `Invoice #${s.invoiceNo}`);
  };

  // ── WhatsApp share (Image-based) ─────────────────────────────────────────────
  const shareWhatsApp = async (s: Sale) => {
    if (whatsappSharing) return;
    setWhatsappSharing(true);
    showToast('⏳ Generating invoice image...');
    try {
      const [brand, liveCatalog] = await Promise.all([
        loadBrandConfigWithLogo(),
        getLiveCatalogProducts(),
      ]);
      const html = generateInvoiceHTML(
        {
          invoiceNo:           s.invoiceNo,
          date:                s.date,
          paymentMode:         s.paymentMode,
          status:              s.status,
          clientName:          s.client?.name ?? '—',
          clientId:            s.client?.clientId,
          clientPhone:         s.client?.phone,
          clientWhatsapp:      s.client?.whatsapp,
          clientType:          s.client?.type,
          clientAddress:       s.client?.address,
          deliveryLocation:    s.client?.deliveryLocation,
          employeeName:        s.employee?.name,
          employeePhone:       s.employee?.phone,
          deliveryDate:        s.deliveryDate,
          deliveryTime:        s.deliveryTime,
          items: s.items.map(i => {
            const vis = resolveItemVisuals(i, liveCatalog);
            return {
              itemName: i.itemName,
              qty:      i.qty,
              unit:     i.unit,
              rate:     i.rate,
              amount:   i.amount,
              urduName: vis.urduName,
              imageUrl: vis.imageUrl,
              emoji:    vis.emoji,
              productId: vis.productId,
              returnedQty: (i as any).returnedQty,
              returnReason: (i as any).returnReason,
            };
          }),
          previousBalance:     s.previousBalance,
          previousBalanceDate: s.previousBalanceDate,
          total:               s.total,
          paid:                s.paid,
          balance:             s.balance,
          notes:               s.notes,
        },
        brand,
        window.location.origin,
      );

      const result = await shareDocumentAsImageOnWhatsApp(
        {
          html,
          filename: `Invoice_${s.invoiceNo}.jpg`,
          phone:    s.client?.whatsapp ?? s.client?.phone ?? '',
        },
        (msg) => { if (msg) showToast(msg); },
      );

      if (result.method === 'modal' && result.jpgBase64) {
        setWaShareModal({
          jpgBase64:    result.jpgBase64,
          whatsappUrl:  result.whatsappUrl ?? 'https://wa.me/',
          filename:     `Invoice_${s.invoiceNo}.jpg`,
          displayPhone: s.client?.whatsapp ?? s.client?.phone ?? undefined,
        });
      }
    } catch (err) {
      console.error('shareWhatsApp error:', err);
      showToast('❌ Unable to share. Please try again.');
    } finally {
      setWhatsappSharing(false);
    }
  };

  // ── Download Invoice as PDF ───────────────────────────────────────────────────────
  const downloadInvoice = async (s: Sale) => {
    // Open window synchronously first — avoids browser popup blocker
    const w = openPrintWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const [brand, liveCatalog] = await Promise.all([
      loadBrandConfigWithLogo(),
      getLiveCatalogProducts(),
    ]);
    const html = generateInvoiceHTML(
      {
        invoiceNo:           s.invoiceNo,
        date:                s.date,
        paymentMode:         s.paymentMode,
        status:              s.status,
        clientName:          s.client?.name ?? '—',
        clientId:            s.client?.clientId,
        clientPhone:         s.client?.phone,
        clientWhatsapp:      s.client?.whatsapp,
        clientType:          s.client?.type,
        clientAddress:       s.client?.address,
        deliveryLocation:    s.client?.deliveryLocation,
        employeeName:        s.employee?.name,
        employeePhone:       s.employee?.phone,
        deliveryDate:        s.deliveryDate,
        deliveryTime:        s.deliveryTime,
        items: s.items.map(i => {
          const vis = resolveItemVisuals(i, liveCatalog);
          return {
            itemName: i.itemName,
            qty:      i.qty,
            unit:     i.unit,
            rate:     i.rate,
            amount:   i.amount,
            urduName: vis.urduName,
            imageUrl: vis.imageUrl,
            emoji:    vis.emoji,
            productId: vis.productId,
            returnedQty: (i as any).returnedQty,
            returnReason: (i as any).returnReason,
          };
        }),
        previousBalance:     s.previousBalance,
        previousBalanceDate: s.previousBalanceDate,
        total:               s.total,
        paid:                s.paid,
        balance:             s.balance,
        notes:               s.notes,
      },
      brand,
      window.location.origin,
    );
    writeAndDownload(w, html, `Invoice_${s.invoiceNo}.pdf`);
  };

  // ── Download Invoice as JPG ───────────────────────────────────────────────────────
  const downloadInvoiceJPG = async (s: Sale) => {
    setSaving(true);
    showToast('⏳ Generating image...');
    try {
      const [brand, liveCatalog] = await Promise.all([
        loadBrandConfigWithLogo(),
        getLiveCatalogProducts(),
      ]);
      const html = generateInvoiceHTML(
        {
          invoiceNo:           s.invoiceNo,
          date:                s.date,
          paymentMode:         s.paymentMode,
          status:              s.status,
          clientName:          s.client?.name ?? '—',
          clientId:            s.client?.clientId,
          clientPhone:         s.client?.phone,
          clientWhatsapp:      s.client?.whatsapp,
          clientType:          s.client?.type,
          clientAddress:       s.client?.address,
          deliveryLocation:    s.client?.deliveryLocation,
          employeeName:        s.employee?.name,
          employeePhone:       s.employee?.phone,
          deliveryDate:        s.deliveryDate,
          deliveryTime:        s.deliveryTime,
          items: s.items.map(i => {
            const vis = resolveItemVisuals(i, liveCatalog);
            return {
              itemName: i.itemName,
              qty:      i.qty,
              unit:     i.unit,
              rate:     i.rate,
              amount:   i.amount,
              urduName: vis.urduName,
              imageUrl: vis.imageUrl,
              emoji:    vis.emoji,
              productId: vis.productId,
              returnedQty: (i as any).returnedQty,
              returnReason: (i as any).returnReason,
            };
          }),
          previousBalance:     s.previousBalance,
          previousBalanceDate: s.previousBalanceDate,
          total:               s.total,
          paid:                s.paid,
          balance:             s.balance,
          notes:               s.notes,
        },
        brand,
        window.location.origin,
      );
      
      const imgBase64 = await generateTemplateJpgBase64(html);
      if (!imgBase64) {
        showToast('❌ Unable to generate the image. Please try again.');
        return;
      }
      
      showToast('📦 Preparing download...');
      await downloadImage(imgBase64, `Invoice_${s.invoiceNo}.jpg`, showToast);
    } catch (err) {
      console.error(err);
      showToast('❌ Unable to generate the image. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── KPIs for list view (synchronized with selected date) ───────────────────
  const selectedSales = sales.filter(s => s.status !== 'CANCELLED');
  const selectedTotal = selectedSales.reduce((s, x) => s + x.total, 0);
  const todayCash     = todayCollectionsAmt;
  const totalBal      = selectedSales.reduce((s, x) => s + x.balance, 0);
  const pendingDel    = selectedSales.filter(s => s.deliveryStatus === 'PENDING').length;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 18px', background: toast.startsWith('❌') ? '#A83E3E' : '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13, boxShadow: '0 6px 24px rgba(0,0,0,.2)' }}>
          {toast}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* VIEW: INVOICE LIST                               */}
      {/* ══════════════════════════════════════════════════ */}
      {view === 'list' && (
        <>
          {/* Header */}
          <div className="va-panel" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
                  <Icon path={mdiReceipt} size={1} color="var(--primary)" />
                  <h2 style={{ margin: 0 }}>Sales &amp; Billing</h2>
                </div>
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>Daily invoicing, client billing, and payment tracking</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="va-btn" onClick={startNew}>+ New Invoice</button>
              </div>
            </div>
          </div>

          {/* KPI Strip */}
          <div className="va-cards">
            <div className="va-card"><div className="label">Total Sales</div><div className="value" style={{ color: 'var(--forest)' }}>{fmtMoney(selectedTotal)}</div><div className="foot">{selectedSales.length} invoice{selectedSales.length !== 1 ? 's' : ''} for selected date</div></div>
            <div className="va-card"><div className="label">Cash Collected</div><div className="value" style={{ color: 'var(--ok)' }}>{fmtMoney(todayCash)}</div><div className="foot">collections for day</div></div>
            <div className="va-card"><div className="label">Outstanding Amount</div><div className="value" style={{ color: totalBal > 0 ? 'var(--clay)' : undefined }}>{fmtMoney(totalBal)}</div><div className="foot">invoice balance due</div></div>
            <div className="va-card"><div className="label">Pending Deliveries</div><div className="value" style={{ color: pendingDel > 0 ? 'var(--danger)' : undefined }}>{pendingDel}</div><div className="foot">awaiting dispatch</div></div>
          </div>

          {/* Filters */}
          <div className="va-panel" style={{ padding: '10px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={srchInv} onChange={e => setSrchInv(e.target.value)} placeholder="🔍 Invoice # or client name…"
                style={{ flex: 2, minWidth: 180, padding: '7px 12px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} />
              <select value={filterSt} onChange={e => setFilterSt(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Active</option>
                {['PENDING','PARTIAL','PAID','CANCELLED'].map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }}>
                <option value="all">All Modes</option>
                {PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontSize: 13 }}>
                <span>📅</span>
                <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                  style={{ border: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, color: 'var(--ink)' }} />
              </div>
              <button className="va-btn secondary small" onClick={() => loadSales()}>↻ Refresh</button>
            </div>
          </div>

          {/* Sales Table */}
          <div className="va-panel">
            {loading && sales.length === 0 ? (
              <div style={{ padding: 16 }}><SkeletonTable rows={6} cols={6} /></div>
            ) : sales.length === 0 ? (
              <div className="va-empty"><div className="big">No invoices found</div><div>Create your first invoice with + New Invoice</div></div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="hidden md:block">
                  <table className="va-table">
                    <thead>
                      <tr>
                        <th>Invoice</th><th>Client</th><th>Date</th><th>Items</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                        <th style={{ textAlign: 'right' }}>Paid</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th>Mode</th><th>Payment</th><th>Delivery</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.map(s => (
                        <tr key={s.id} style={{ background: s.status === 'PAID' ? undefined : s.balance > 0 ? '#FFF9F5' : undefined }}>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--forest)' }}>{s.invoiceNo}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{s.client?.name} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--muted)', background: '#e9ecef', padding: '1px 4px', borderRadius: 4, marginLeft: 4 }}>{s.client?.clientId || 'WH-0000'}</span></div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.client?.type}</div>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDateTime(s.date)}</td>
                          <td style={{ fontSize: 12, color: 'var(--muted)' }}>{s.items.length} items</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(s.total)}</td>
                          <td className="mono" style={{ textAlign: 'right', color: 'var(--ok)' }}>{s.paid > 0 ? fmtMoney(s.paid) : '—'}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: s.balance > 0 ? 'var(--clay)' : 'var(--muted)' }}>
                            {s.balance > 0 ? fmtMoney(s.balance) : '—'}
                          </td>
                          <td><ModeBadge mode={s.paymentMode} /></td>
                          <td><Badge status={s.status} /></td>
                          <td><Badge status={s.deliveryStatus} small /></td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="va-btn secondary small" onClick={() => openDetail(s)}>🧾 View</button>
                              {isInvoiceEditable(s) && (
                                <button className="va-btn secondary small" onClick={() => startEditInvoice(s)} style={{ background: '#1A3C28', color: '#fff', border: 'none' }}>✏️ Edit</button>
                              )}
                              <button className="va-btn secondary small" onClick={() => shareWhatsApp(s)} disabled={whatsappSharing} style={{ background: whatsappSharing ? '#94d3a2' : '#25D366', color: '#fff', border: 'none', opacity: whatsappSharing ? 0.7 : 1 }}>📲</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ fontWeight: 700 }}>Totals ({sales.length} invoices)</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(sales.reduce((s, x) => s + x.total, 0))}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(sales.reduce((s, x) => s + x.paid, 0))}</td>
                        <td className="mono" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--clay)' }}>{fmtMoney(sales.reduce((s, x) => s + x.balance, 0))}</td>
                        <td colSpan={4}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile Card List View */}
                <div className="flex md:hidden" style={{ flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {sales.map(s => (
                    <MobileInvoiceCard
                      key={s.id}
                      sale={s}
                      onView={() => openDetail(s)}
                      onEdit={() => startEditInvoice(s)}
                      isEditable={isInvoiceEditable(s)}
                    />
                  ))}


              {/* Total Aggregate Card */}
              <div style={{
                marginTop: '10px',
                padding: '16px',
                background: 'rgba(0,0,0,0.03)',
                borderRadius: '12px',
                border: '1px solid var(--line)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--muted)', fontWeight: 500 }}>
                  <span>Total Invoiced</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtMoney(sales.reduce((s, x) => s + x.total, 0))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: 'var(--muted)', fontWeight: 500 }}>
                  <span>Total Paid</span>
                  <span className="mono" style={{ fontWeight: 700, color: 'var(--ok)' }}>{fmtMoney(sales.reduce((s, x) => s + x.paid, 0))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '4px' }}>
                  <span>Total Receivables</span>
                  <span className="mono" style={{ color: 'var(--clay)' }}>{fmtMoney(sales.reduce((s, x) => s + x.balance, 0))}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
        </>
      )}



      {/* ══════════════════════════════════════════════════ */}
      {/* VIEW: NEW INVOICE (3-STEP WIZARD)                */}
      {/* ══════════════════════════════════════════════════ */}
      {view === 'new' && (
        <>
          {/* Wizard header */}
          <div className="va-panel" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Top Row: Cancel + Title */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <button className="va-btn secondary small" onClick={cancelInvoiceDraft}>← Cancel</button>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                  {editingSale ? `✏️ Editing Invoice #${editingSale.invoiceNo}` : '+ New Invoice'}
                </h3>
              </div>

              {/* Stepper Progress Indicator */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                width: '100%', 
                paddingTop: 10, 
                borderTop: '1px solid var(--line-soft)' 
              }}>
                {([1, 2, 3] as Step[]).map((s) => (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: s < 3 ? '1 1 0%' : '0 0 auto' }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 12, flexShrink: 0,
                      background: step >= s ? 'var(--forest)' : '#E2E8F0',
                      color: step >= s ? '#fff' : '#64748B',
                    }}>{s}</div>
                    
                    <span style={{ 
                      fontSize: 11, 
                      color: step === s ? 'var(--forest)' : '#64748B', 
                      fontWeight: step === s ? 700 : 500,
                      whiteSpace: 'nowrap'
                    }}>
                      {s === 1 ? 'Select Client' : s === 2 ? 'Add Items' : 'Review & Pay'}
                    </span>
                    
                    {s < 3 && (
                      <div style={{ 
                        flex: 1, 
                        height: 2, 
                        background: step > s ? 'var(--forest)' : '#E2E8F0', 
                        margin: '0 4px',
                        minWidth: 8
                      }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── STEP 1: SELECT CLIENT ── */}
          {step === 1 && (
            <div className="va-panel">
              <div className="va-panel-head">
                <h3>Step 1 — Select Client</h3>
              </div>

              {/* Search bar */}
              <div style={{ marginBottom: 12 }}>
                <input value={clientSrch} onChange={e => setClientSrch(e.target.value)}
                  placeholder="🔍 Search existing client by name, phone, address…"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 14 }} />
              </div>

              {/* Client verification notice */}
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, padding: '8px 12px', background: 'var(--line-soft)', borderRadius: 6 }}>
                ℹ️ Every invoice must be linked to an existing client. Select an active client from the list below.
              </div>

              {clientsLoad ? (
                <div className="va-loading">Searching clients…</div>
              ) : clients.length === 0 ? (
                <div className="va-empty">
                  <div className="big">
                    {clientSrch ? `No clients found for "${clientSrch}"` : 'No active clients found'}
                  </div>
                  <div style={{ marginTop: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
                    ⚠️ Client does not exist. Please create the client profile first in the Clients module.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <a href="/clients" className="va-btn primary small" style={{ display: 'inline-block', textDecoration: 'none' }}>Go to Clients Module →</a>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {clients.map(c => (
                    <div key={c.id} onClick={() => selectClient(c)}
                      style={{ padding: '14px 16px', border: '2px solid var(--line)', borderRadius: 10, cursor: 'pointer', transition: 'border-color .15s, box-shadow .15s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--forest)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(31,61,43,.12)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, background: 'var(--line-soft)', color: 'var(--muted)', fontWeight: 600 }}>{TYPE_EMOJI[c.type]} {c.type}</span>
                      </div>
                      {c.ownerName && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.ownerName}</div>}
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{c.phone ?? '—'}</div>
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: c.currentBalance > 0 ? 'var(--clay)' : c.currentBalance < 0 ? 'var(--ok)' : 'var(--muted)', fontWeight: c.currentBalance !== 0 ? 700 : 400 }}>
                          Balance: {fmtMoney(c.currentBalance)}
                        </span>
                        {c.creditLimit > 0 && <span style={{ color: 'var(--muted)' }}>Limit: {fmtMoney(c.creditLimit)}</span>}
                      </div>
                      {c.lastOrderDate && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Last order: {fmtDate(c.lastOrderDate)}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}


          {/* ── STEP 2: ADD ITEMS ── */}
          {step === 2 && selClient && (
            <>
              {/* Active Same-Day Invoice Detection Banner */}
              {activeSalePrompt && !editingSale && (
                <div style={{
                  background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
                  color: '#fff',
                  padding: '16px 20px',
                  borderRadius: '12px',
                  marginBottom: '16px',
                  boxShadow: '0 4px 16px rgba(26,60,40,0.2)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '15px' }}>
                        💡 Active Editable Invoice #{activeSalePrompt.invoiceNo} Exists Today
                      </div>
                      <div style={{ fontSize: '12px', opacity: 0.9, marginTop: '4px' }}>
                        {selClient.name} already has an invoice for today's business day (Total: Rs {activeSalePrompt.total.toLocaleString()}, Items: {activeSalePrompt.items?.length || 0}).
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="va-btn"
                        onClick={() => startEditInvoice(activeSalePrompt)}
                        style={{ background: '#25D366', color: '#fff', border: 'none', fontWeight: 700, padding: '8px 16px' }}
                      >
                        ✏️ Edit Existing Invoice #{activeSalePrompt.invoiceNo}
                      </button>
                      <button
                        className="va-btn secondary small"
                        onClick={() => setActiveSalePrompt(null)}
                        style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}
                      >
                        + Create New Invoice
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Edit Mode Active Banner */}
              {editingSale && (
                <div style={{
                  background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)',
                  color: '#fff',
                  padding: '12px 18px',
                  borderRadius: '10px',
                  marginBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxShadow: '0 4px 12px rgba(26,60,40,0.2)',
                }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '14px' }}>
                      ✏️ Edit Mode: Invoice #{editingSale.invoiceNo}
                    </div>
                    <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '2px' }}>
                      Updating same-day active invoice for {selClient.name}. Inventory and customer ledger will recalculate automatically upon saving.
                    </div>
                  </div>
                  <button
                    className="va-btn secondary small"
                    onClick={cancelInvoiceDraft}
                    style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none' }}
                  >
                    Cancel Edit
                  </button>
                </div>
              )}
              {/* Client info card */}
              <div className="va-panel" style={{ borderLeft: '4px solid var(--forest)', padding: '14px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{selClient.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{selClient.type} · {selClient.phone ?? '—'}</div>
                    {selClient.deliveryLocation && <div style={{ fontSize: 12, color: 'var(--muted)' }}>📍 {selClient.deliveryLocation}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
                    <div>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Risk Status</div>
                      <div style={{ fontWeight: 700, color: RATING_COLOR[selClient.rating] || 'var(--ink)' }}>
                        {RATING_EMOJI[selClient.rating] || '⚪'} {selClient.rating || 'NEW'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Outstanding</div>
                      <div style={{ fontWeight: 700, color: selClient.currentBalance > 0 ? 'var(--clay)' : 'var(--ok)' }}>{fmtMoney(selClient.currentBalance)}</div>
                    </div>
                    {selClient.creditLimit > 0 && (
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Credit Limit</div>
                        <div style={{ fontWeight: 700 }}>{fmtMoney(selClient.creditLimit)}</div>
                      </div>
                    )}
                    {selClient.salesCount > 0 && (
                      <div>
                        <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Last Order</div>
                        <div style={{ fontWeight: 700 }}>{selClient.lastOrderDate ? fmtDate(selClient.lastOrderDate) : '—'}</div>
                      </div>
                    )}
                  </div>
                  <button className="va-btn secondary small" onClick={() => setStep(1)}>← Change</button>
                </div>
              </div>

              {/* Invoice date */}
              <div className="va-panel" style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13 }}>
                  <label style={{ fontWeight: 600 }}>Invoice Date:</label>
                  <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)}
                    style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 13 }} />
                </div>
              </div>

              {/* Items table */}
              <div className="va-panel">
                <div className="va-panel-head">
                  <h3>Order Items</h3>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Rates auto-filled from today's price list</span>
                </div>

                {items.map((item, i) => (
                  <div key={i} className="va-item-row">
                    <div className="va-field" style={{ flex: 3 }}>
                      <label className={i > 0 ? 'show-mobile' : ''}>Product</label>
                        <ProductAutocomplete
                          value={item.itemName}
                          onChange={val => updateItem(i, 'itemName', val)}
                          onSelect={pItem => selectProductForItem(i, pItem)}
                          priceItems={priceItems}
                          placeholder="Product name"
                          required
                        />
                        {(() => {
                          const pItem = priceItems.find(p => (item.productId && p.productId === item.productId) || p.itemName.toLowerCase() === item.itemName.trim().toLowerCase());
                          const avail = pItem?.availableStock ?? pItem?.currentStock;
                          if (avail === undefined || !item.itemName.trim()) return null;

                          let oldQty = 0;
                          if (editingSale && editingSale.items) {
                            const oldItem = editingSale.items.find(oi =>
                              (item.productId && (oi.productId === item.productId || oi.product?.id === item.productId)) ||
                              (oi.itemName && oi.itemName.toLowerCase() === item.itemName.trim().toLowerCase())
                            );
                            if (oldItem) oldQty = Number(oldItem.qty) - Number((oldItem as any).returnedQty || 0);
                          }

                          return (
                            <div style={{ fontSize: 11, marginTop: 4, fontWeight: 700, color: (avail > 0 || oldQty > 0) ? '#166534' : '#DC2626', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                              <span>{avail > 0 ? '📦 Available Stock:' : (oldQty > 0 ? '📦 In Warehouse:' : '⚠️ Out of Stock:')}</span>
                              <span className="mono">{avail} {item.unit}</span>
                              {oldQty > 0 && (
                                <span style={{ color: '#1E40AF', background: '#DBEAFE', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                                  ({oldQty} {item.unit} already on invoice)
                                </span>
                              )}
                            </div>
                          );
                        })()}
                    </div>
                    <div className="va-field" style={{ flex: 1 }}>
                      <label className={i > 0 ? 'show-mobile' : ''}>Qty</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.qty === 0 ? '' : item.qty}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            updateItem(i, 'qty', val);
                          }
                        }}
                        placeholder="0"
                        required
                        className="mono"
                        style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                      />
                    </div>
                    <div className="va-field" style={{ flex: 1 }}>
                      <label className={i > 0 ? 'show-mobile' : ''}>Unit</label>
                      <select
                        value={item.unit}
                        onChange={e => updateItem(i, 'unit', e.target.value)}
                        style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                      >
                        {UNITS.map(u => <option key={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="va-field" style={{ flex: 1.2 }}>
                      <label className={i > 0 ? 'show-mobile' : ''}>Rate (Rs)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.rate === 0 ? '' : item.rate}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '' || /^\d*\.?\d*$/.test(val)) {
                            updateItem(i, 'rate', val);
                          }
                        }}
                        placeholder="0"
                        required
                        className="mono"
                        style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                      />
                    </div>
                    <div className="va-field" style={{ flex: 1.2 }}>
                      <label className={i > 0 ? 'show-mobile' : ''}>Amount</label>
                      <div className="mono" style={{ padding: '8px 10px', background: 'var(--paper-soft)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', fontWeight: 700, color: 'var(--forest)', fontSize: 13 }}>
                        {fmtMoney(item.amount)}
                      </div>
                    </div>
                    {items.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setItems(p => p.filter((_, j) => j !== i))}
                          style={{
                            padding: '8px 10px',
                            background: 'none',
                            border: '1px solid var(--line)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            color: 'var(--danger)',
                            marginBottom: 6,
                            minHeight: 44,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title="Remove item"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="va-btn secondary small"
                  onClick={() => setItems(p => [...p, blankItem()])}
                  style={{ marginTop: 12, marginBottom: 12 }}
                >
                  + Add Row
                </button>

                {/* Running subtotal */}
                <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--line-soft)', borderRadius: 8, display: 'flex', gap: 24, fontSize: 13, fontWeight: 600 }}>
                  <span>{items.filter(i => i.itemName).length} items</span>
                  <span>Subtotal: <span className="mono" style={{ color: 'var(--forest)', fontSize: 15 }}>{fmtMoney(subtotal)}</span></span>
                </div>

                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" className="va-btn secondary" onClick={() => setStep(1)}>← Back</button>
                  <button
                    type="button"
                    className="va-btn"
                    onClick={() => setStep(3)}
                    disabled={!items.some(i => i.itemName && (parseFloat(String(i.qty)) || 0) > 0)}
                  >
                    Review &amp; Pay →
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── STEP 3: REVIEW & PAY ── */}
          {step === 3 && selClient && (
            <>
              {/* Summary panel */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
                {/* Left: items summary */}
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Order Summary</h3><button className="va-btn secondary small" onClick={() => setStep(2)}>← Edit Items</button></div>
                  <table className="va-table">
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                    <tbody>
                      {items.filter(i => i.itemName && (parseFloat(String(i.qty)) || 0) > 0).map((item, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{item.itemName}</td>
                          <td className="mono">{item.qty}</td>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{item.unit}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Right: billing */}
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Billing</h3></div>

                  {/* Client balance */}
                  {selClient.currentBalance !== 0 && (
                    <div style={{ padding: '10px 14px', background: selClient.currentBalance > 0 ? '#FFF5F0' : '#F0FAF3', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>Previous Balance</span>
                      <span className="mono" style={{ fontWeight: 700, color: selClient.currentBalance > 0 ? 'var(--clay)' : 'var(--ok)' }}>
                        {fmtMoney(selClient.currentBalance)}
                      </span>
                    </div>
                  )}

                  {/* Billing fields */}
                  <div className="va-field"><label>Discount (Rs)</label>
                    <input type="number" value={discount} min="0" onChange={e => setDiscount(+e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6 }} />
                  </div>
                  <div className="va-field" style={{ marginTop: 10 }}><label>Delivery Charge (Rs)</label>
                    <input type="number" value={deliveryFee} min="0" onChange={e => setDeliveryFee(+e.target.value)}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6 }} />
                  </div>

                  {/* Totals box */}
                  <div style={{ margin: '14px 0', padding: '12px 14px', background: 'var(--line-soft)', borderRadius: 8, fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>Committed Dues (سابقہ بقایا جات)</span>
                      <span className="mono" style={{ fontWeight: 700, color: selClient.currentBalance > 0 ? 'var(--clay)' : 'var(--muted)' }}>{fmtMoney(selClient.currentBalance)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>New Invoice Draft (نیا بل)</span>
                      <span className="mono" style={{ fontWeight: 700 }}>{fmtMoney(total)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, borderTop: '2px dashed var(--line)', paddingTop: 8, fontWeight: 700, fontSize: 14 }}>
                      <span style={{ color: 'var(--forest)' }}>Estimated Total After Generation (کل واجب الادا)</span>
                      <span className="mono" style={{ color: 'var(--forest)', fontSize: 16 }}>{fmtMoney(selClient.currentBalance + total)}</span>
                    </div>
                  </div>



                  {/* Credit warning */}
                  {creditWarn && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFF5F0', border: '1px solid var(--danger)', borderRadius: 8, fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                      ⚠️ Credit limit exceeded! ({fmtMoney(selClient.currentBalance + balance)} / {fmtMoney(selClient.creditLimit)})
                    </div>
                  )}

                  {selClient.rating === 'RED' && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFF1F0', border: '1px solid #FFCCC7', borderRadius: 8, fontSize: 12, color: '#A8071A', fontWeight: 600 }}>
                      ❌ RISK WARNING: Customer is in RED Risk Category. No additional credit deliveries allowed without management approval.
                    </div>
                  )}

                  {selClient.rating === 'ORANGE' && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: '#FFF7E6', border: '1px solid #FFE7BA', borderRadius: 8, fontSize: 12, color: '#D46B08', fontWeight: 600 }}>
                      ⚠️ RISK WARNING: Customer is in ORANGE Risk Category. Exposure limits are high, review before dispatching.
                    </div>
                  )}

                  <div className="va-field" style={{ marginTop: 10 }}>
                    <label style={{ fontWeight: 600 }}>Delivery Staff (Required) *</label>
                    <select 
                      value={selEmpId} 
                      onChange={e => setSelEmpId(e.target.value)}
                      required
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', fontWeight: 500 }}
                    >
                      <option value="">— Select Delivery Staff Member —</option>
                      {employees.filter(emp => emp.role === 'DELIVERY_STAFF' || emp.role === 'Delivery Staff').map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.name} {emp.phone ? `(${emp.phone})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  <div className="va-form-row" style={{ marginTop: 10 }}>
                    <div className="va-field">
                      <label>Delivery Date</label>
                      <input type="date" value={delivDate} onChange={e => setDelivDate(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6 }} />
                    </div>
                    <div className="va-field">
                      <label>Delivery Time Slot</label>
                      <select value={delivTime} onChange={e => setDelivTime(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)' }}>
                        <option value="PHASE 1 (11:00 AM - 02:00 PM)">PHASE 1 (11:00 AM - 02:00 PM)</option>
                        <option value="PHASE 2 (05:00 PM - 09:00 PM)">PHASE 2 (05:00 PM - 09:00 PM)</option>
                      </select>
                    </div>
                  </div>

                  <div className="va-field" style={{ marginTop: 10 }}><label>Notes (optional)</label>
                    <input value={invNotes} onChange={e => setInvNotes(e.target.value)} placeholder="Special instructions…"
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 6 }} />
                  </div>

                  <form onSubmit={e => { e.preventDefault(); handleSubmit(); }} style={{ marginTop: 14 }}>
                    <button
                      type="submit"
                      className="va-btn"
                      style={{ width: '100%', fontSize: 15, padding: '12px', background: editingSale ? 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)' : undefined }}
                      disabled={isSubmittingInvoice || saving}
                      aria-busy={isSubmittingInvoice || saving}
                    >
                      {isSubmittingInvoice || saving
                        ? 'Generating…'
                        : editingSale
                          ? `✓ Save Changes to Invoice #${editingSale.invoiceNo}`
                          : '✓ Generate Invoice'}
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* VIEW: INVOICE DETAIL / PRINT                     */}
      {/* ══════════════════════════════════════════════════ */}
      {view === 'detail' && (
        <>
          {/* Action bar */}
          <div className="va-panel" style={{ padding: '12px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="va-btn secondary small" onClick={() => { setView('list'); setDetailSale(null); }}>← Back</button>
                {detailSale && <h3 style={{ margin: 0 }}>Invoice #{detailSale.invoiceNo}</h3>}
              </div>
              {detailSale && (
                <div className="hidden md:flex" style={{ gap: 8 }}>
                  {isInvoiceEditable(detailSale) && (
                    <button className="va-btn primary small" onClick={() => startEditInvoice(detailSale)} style={{ background: '#1A3C28', color: '#fff', border: 'none' }}>✏️ Edit Invoice</button>
                  )}
                  <button className="va-btn secondary small" onClick={() => openAuditTrail(detailSale.id)}>📋 Audit Trail</button>
                  <button className="va-btn secondary small" onClick={() => printInvoice(detailSale)}>🖨️ Print</button>
                  <button className="va-btn secondary small" onClick={() => downloadInvoice(detailSale)}>💾 Download PDF</button>
                  <button className="va-btn secondary small" onClick={() => downloadInvoiceJPG(detailSale)}>🖼️ Download JPG</button>
                  <button className="va-btn secondary small" onClick={() => shareWhatsApp(detailSale)} disabled={whatsappSharing} style={{ background: whatsappSharing ? '#94d3a2' : '#25D366', color: '#fff', border: 'none', opacity: whatsappSharing ? 0.7 : 1 }}>{whatsappSharing ? '⏳ Generating...' : '📲 WhatsApp'}</button>
                </div>
              )}
            </div>
          </div>

          {detailLoad ? <div className="va-loading">Loading invoice…</div> : detailSale ? (
            <>
              {/* Desktop View */}
              <div className="hide-mobile hidden md:block">
                {/* Invoice meta */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Client info */}
                  <div className="va-panel" style={{ margin: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Client</div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{detailSale.client?.name} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', background: '#e9ecef', padding: '1px 4px', borderRadius: 4, marginLeft: 6 }}>{detailSale.client?.clientId || 'WH-0000'}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.7 }}>
                      {detailSale.client?.type}<br />
                      {detailSale.client?.phone && <>{detailSale.client.phone}<br /></>}
                      {detailSale.client?.deliveryLocation ?? detailSale.client?.address}
                    </div>
                  </div>
                  {/* Invoice meta */}
                  <div className="va-panel" style={{ margin: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 8 }}>Invoice Details</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                      {[
                        ['Date', fmtDateTime(detailSale.date)],
                        ['Payment Mode', ''],
                        ['Status', ''],
                        ['Delivery', ''],
                        ['Delivery Staff', detailSale.employee?.name || '—'],
                        ['Delivery Schedule', detailSale.deliveryDate ? `${fmtDate(detailSale.deliveryDate)} (${detailSale.deliveryTime || 'Anytime'})` : '—'],
                      ].map(([k]) => (
                        <div key={k as string}>
                          <div style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{k}</div>
                          <div style={{ fontWeight: 600, marginTop: 2 }}>
                            {k === 'Date' ? fmtDateTime(detailSale.date) :
                             k === 'Payment Mode' ? <ModeBadge mode={detailSale.paymentMode} /> :
                             k === 'Status' ? <Badge status={detailSale.status} /> :
                             k === 'Delivery' ? <Badge status={detailSale.deliveryStatus} /> :
                             k === 'Delivery Staff' ? (
                               <span>
                                 {detailSale.employee?.name} {detailSale.employee?.phone ? `(📞 ${detailSale.employee.phone})` : ''}
                               </span>
                             ) :
                             <span>{detailSale.deliveryDate ? `${fmtDate(detailSale.deliveryDate)} (${detailSale.deliveryTime || 'Anytime'})` : '—'}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="va-panel">
                  <div className="va-panel-head"><h3>Items ({detailSale.items.length})</h3></div>
                  <table className="va-table">
                    <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Unit</th><th style={{ textAlign: 'right' }}>Rate (Rs)</th><th style={{ textAlign: 'right' }}>Amount (Rs)</th></tr></thead>
                    <tbody>
                      {detailSale.items.map((item, i) => (
                        <tr key={item.id}>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{item.itemName}</div>
                            {item.product?.urduName && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{item.product.urduName}</div>}
                          </td>
                          <td className="mono">{item.qty}</td>
                          <td style={{ color: 'var(--muted)' }}>{item.unit}</td>
                          <td className="mono" style={{ textAlign: 'right' }}>{fmtMoney(item.rate)}</td>
                          <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{fmtMoney(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Billing summary + payment input */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
                  {/* Summary */}
                  <div className="va-panel" style={{ margin: 0 }}>
                    <div className="va-panel-head"><h3>Billing Summary</h3></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
                        <span>Previous Dues {detailSale.previousBalance > 0 && detailSale.previousBalanceDate ? `(as of ${fmtDate(detailSale.previousBalanceDate)})` : ''}</span>
                        <span className="mono">{fmtMoney(detailSale.previousBalance > 0 ? detailSale.previousBalance : 0)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
                        <span>Current Order</span><span className="mono">{fmtMoney(detailSale.total)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
                        <span>Total Due</span><span className="mono">{fmtMoney((detailSale.previousBalance > 0 ? detailSale.previousBalance : 0) + detailSale.total)}</span>
                      </div>
                      {detailSale.paid > 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ok)' }}>
                          <span>Payment Received</span><span className="mono">− {fmtMoney(detailSale.paid)}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Payment Received</span><span className="mono">{fmtMoney(0)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, padding: '10px 14px', borderRadius: 8, background: (detailSale.previousBalance + detailSale.total - detailSale.paid) > 0 ? '#FFF5F0' : '#F0FAF3', color: (detailSale.previousBalance + detailSale.total - detailSale.paid) > 0 ? 'var(--clay)' : 'var(--ok)' }}>
                        <span>Remaining Balance</span><span className="mono">{fmtMoney(detailSale.previousBalance + detailSale.total - detailSale.paid)}</span>
                      </div>
                    </div>
                    {detailSale.notes && (
                      <div style={{ marginTop: 12, padding: '10px', background: '#FFFBF0', borderRadius: 6, fontSize: 12, borderLeft: '3px solid var(--mustard)' }}>
                        <strong>Note:</strong> {detailSale.notes}
                      </div>
                    )}
                  </div>

                  {/* Delivery details (Record Payment removed per user request) */}
                  <div className="va-panel" style={{ margin: 0 }}>
                    <div className="va-panel-head"><h3>Delivery Details</h3></div>
                    {detailSale.deliveries && detailSale.deliveries.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {detailSale.deliveries.map(d => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, paddingBottom: 8, borderBottom: '1px solid var(--line-soft)' }}>
                            <div>
                              <span style={{ fontWeight: 700, color: 'var(--forest)' }}>📍 {d.zone ?? 'Mandi Route'}</span>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                                Track full status or assign drivers in Delivery module
                              </div>
                            </div>
                            <Badge status={d.status} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                        ℹ️ No delivery tracking records for this invoice.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mobile View: Standardized MobileCard */}
              <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                <MobileCard
                  title={detailSale.client?.name ?? 'Anonymous Client'}
                  headerBadge={detailSale.client?.clientId || 'WH-0000'}
                  footer={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                      <button
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          background: 'linear-gradient(135deg, #16A34A 0%, #15803D 100%)',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          borderRadius: '10px',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '14px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 12px rgba(22, 163, 74, 0.25)'
                        }}
                        onClick={() => shareWhatsApp(detailSale)}
                        disabled={whatsappSharing}
                      >
                        {whatsappSharing ? '⏳ Generating...' : '📲 Send WhatsApp'}
                      </button>
                      <button
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          background: '#F8FAFC',
                          color: '#0F172A',
                          fontWeight: 600,
                          borderRadius: '10px',
                          border: '1px solid #CBD5E1',
                          cursor: 'pointer',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                        onClick={() => printInvoice(detailSale)}
                      >
                        👁️ View Invoice / Print
                      </button>
                      <button
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          background: '#F8FAFC',
                          color: '#0F172A',
                          fontWeight: 600,
                          borderRadius: '10px',
                          border: '1px solid #CBD5E1',
                          cursor: 'pointer',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                        onClick={() => downloadInvoice(detailSale)}
                      >
                        💾 Download PDF
                      </button>
                      <button
                        style={{
                          width: '100%',
                          padding: '10px 14px',
                          background: '#F8FAFC',
                          color: '#0F172A',
                          fontWeight: 600,
                          borderRadius: '10px',
                          border: '1px solid #CBD5E1',
                          cursor: 'pointer',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                        onClick={() => downloadInvoiceJPG(detailSale)}
                      >
                        🖼️ Download JPG
                      </button>
                    </div>
                  }
                >
                  <MobileCardRow label="Invoice ID" value={detailSale.invoiceNo} isMono />
                  <MobileCardRow label="Date" value={fmtDateTime(detailSale.date)} />
                  <MobileCardRow label="Items Count" value={`${detailSale.items.length} items`} />
                  <MobileCardRow label="Total Amount" value={fmtMoney(detailSale.total)} isMono />
                  <MobileCardRow label="Paid Amount" value={fmtMoney(detailSale.paid)} valueColor="#166534" isMono />
                  <MobileCardRow 
                    label="Balance Due" 
                    value={fmtMoney(detailSale.balance)} 
                    valueColor={detailSale.balance > 0 ? '#991B1B' : '#166534'} 
                    isMono 
                  />
                  <MobileCardRow label="Payment Mode">
                    <MobileCardBadge variant="blue">
                      {detailSale.paymentMode}
                    </MobileCardBadge>
                  </MobileCardRow>
                  <MobileCardRow label="Payment Status">
                    <MobileCardBadge variant={detailSale.balance <= 0 ? 'green' : detailSale.paid > 0 ? 'yellow' : 'red'}>
                      {detailSale.status}
                    </MobileCardBadge>
                  </MobileCardRow>
                  <MobileCardRow label="Delivery Status">
                    <MobileCardBadge variant={detailSale.deliveryStatus === 'DELIVERED' ? 'green' : 'blue'}>
                      {detailSale.deliveryStatus}
                    </MobileCardBadge>
                  </MobileCardRow>
                  {detailSale.employee && (
                    <MobileCardRow label="Delivery Employee" value={detailSale.employee.name} />
                  )}
                  {detailSale.deliveryDate && (
                    <MobileCardRow 
                      label="Delivery Schedule" 
                      value={`${fmtDate(detailSale.deliveryDate)} (${detailSale.deliveryTime || 'Anytime'})`} 
                    />
                  )}
                </MobileCard>
              </div>
            </>
          ) : (
            <div className="va-empty" style={{ padding: 40, textAlign: 'center' }}>
              <div className="big">No invoice selected</div>
              <button
                className="va-btn"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setPState({ view: 'list', detailSaleId: '' });
                  setDetailSale(null);
                }}
              >
                ← Back to Invoice List
              </button>
            </div>
          )}
        </>
      )}

      {/* Hidden offscreen invoice container for image capturing */}
      {detailSale && (
        <div id={`invoice-capture-${detailSale.id}`} style={{
          position: 'fixed',
          top: '-9999px',
          left: '-9999px',
          width: '640px',
          background: '#F8F9F3',
          color: '#1a1a1a',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '36px',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px'
        }}>
          {/* Header with Logo & Big INVOICE Title */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', textAlign: 'center', marginBottom: '8px' }}>
            <img src="/logo.avif" alt="Halal Vegg Supplies" width="175" height="70" loading="lazy" decoding="async" style={{ height: '70px', width: 'auto', objectFit: 'contain' }} />
            <div style={{ fontSize: '36px', fontWeight: '900', color: '#183B25', marginTop: '6px', letterSpacing: '0.04em' }}>INVOICE</div>
          </div>

          {/* Client Details & Invoice Meta */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: '#FFFFFF', border: '1px solid #D5E0CB', borderRadius: '10px', padding: '16px 18px', fontSize: '12px' }}>
            <div>
              <div style={{ color: '#4B5563', marginBottom: '4px' }}>
                Invoice to : <strong style={{ color: '#111827', fontSize: '14px' }}>{detailSale.client?.name ?? '—'}</strong>
              </div>
              <div style={{ color: '#6B7280', lineHeight: '1.5' }}>
                {detailSale.client?.deliveryLocation ?? detailSale.client?.address ?? 'Main Distribution Center'}<br />
                {detailSale.client?.phone ? `📞 ${detailSale.client.phone}` : ''}
              </div>
            </div>
            <div style={{ textAlign: 'right', color: '#4B5563', lineHeight: '1.6' }}>
              <div>Invoice # : <strong style={{ color: '#183B25', fontFamily: 'monospace', fontSize: '13px' }}>{detailSale.invoiceNo}</strong></div>
              <div>Date : <strong style={{ color: '#111827' }}>{new Date(detailSale.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
              <div>Due Date : <strong style={{ color: '#111827' }}>{new Date(detailSale.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
            </div>
          </div>

          {/* Items Table */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '6px' }}>
            <thead>
              <tr style={{ background: '#183B25' }}>
                <th style={{ color: '#ffffff', padding: '10px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'center', borderRadius: '6px 0 0 0', width: '40px' }}>NO</th>
                <th style={{ color: '#ffffff', padding: '10px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'left' }}>ITEM</th>
                <th style={{ color: '#ffffff', padding: '10px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right' }}>PRICE (RS)</th>
                <th style={{ color: '#ffffff', padding: '10px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'center' }}>QTY</th>
                <th style={{ color: '#ffffff', padding: '10px 12px', fontSize: '11px', textTransform: 'uppercase', textAlign: 'right', borderRadius: '0 6px 0 0' }}>TOTAL (RS)</th>
              </tr>
            </thead>
            <tbody>
              {detailSale.items.map((item, i) => (
                <tr key={item.id} style={{ background: i % 2 === 1 ? '#F4F7EE' : '#FFFFFF', borderBottom: '1px solid #E3EBD7' }}>
                  <td style={{ padding: '10px 12px', fontSize: '12px', color: '#4B5563', textAlign: 'center', fontWeight: 'bold' }}>{i + 1}</td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', color: '#111827' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ProductVisual
                        name={item.itemName}
                        emoji={resolveItemVisuals(item).emoji}
                        imageUrl={resolveItemVisuals(item).imageUrl}
                        size={22}
                      />
                      <div>
                        <strong style={{ fontWeight: '600' }}>{item.itemName}</strong>
                        {item.product?.urduName && (
                          <span style={{ color: '#6B7280', fontSize: '12px', marginLeft: '6px', fontFamily: '"Jameel Khushkhat L", "Noto Nastaliq Urdu", serif' }}>
                            ({item.product.urduName})
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', fontFamily: 'monospace', textAlign: 'right', color: '#374151' }}>Rs. {item.rate.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'center', color: '#111827' }}>
                    {item.qty} {item.unit}
                    {(item as any).returnedQty ? <div style={{ fontSize: '10px', color: '#C2410C' }}>↩ {(item as any).returnedQty} Ret</div> : null}
                  </td>
                  <td style={{ padding: '10px 12px', fontSize: '13px', fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'right', color: '#183B25' }}>Rs. {item.amount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Dues & Totals Breakdown */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#374151' }}>
                <span style={{ fontWeight: '600', letterSpacing: '0.03em' }}>PREVIOUS DUE</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>Rs. {(detailSale.previousBalance > 0 ? detailSale.previousBalance : 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#374151' }}>
                <span style={{ fontWeight: '600', letterSpacing: '0.03em' }}>CURRENT ORDER</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>Rs. {detailSale.total.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 6px', borderTop: '1px dashed #B8D8A0', borderBottom: '1px dashed #B8D8A0', fontSize: '13px', fontWeight: 'bold', color: '#183B25' }}>
                <span>TOTAL BILL</span>
                <span style={{ fontFamily: 'monospace' }}>Rs. {(Number(detailSale.previousBalance > 0 ? detailSale.previousBalance : 0) + Number(detailSale.total || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#4B5563' }}>
                <span>SUB TOTAL</span>
                <span style={{ fontFamily: 'monospace' }}>Rs. {(Number(detailSale.previousBalance > 0 ? detailSale.previousBalance : 0) + Number(detailSale.total || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
              </div>
              {detailSale.discount > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#3E7A4E' }}>
                  <span>DISCOUNT</span>
                  <span style={{ fontFamily: 'monospace' }}>Rs. {detailSale.discount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', borderRadius: '8px', background: '#183B25', color: '#ffffff', marginTop: '6px' }}>
                <span style={{ fontWeight: 'bold', fontSize: '15px', letterSpacing: '0.05em' }}>TOTAL</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '18px' }}>Rs. {(Number(detailSale.previousBalance || 0) + Number(detailSale.total || 0) - (detailSale.discount || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          {/* Bottom WhatsApp Contact Banner */}
          <div style={{
            marginTop: '16px', background: '#D4E7C5', border: '1px solid #B8D8A0', borderRadius: '30px',
            padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px'
          }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#183B25', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px' }}>💬</div>
            <div style={{ color: '#183B25', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '600' }}>For Order & Payment Contact</div>
              <div style={{ fontSize: '18px', fontWeight: '900' }}>0306 1110041</div>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Image Share Modal (desktop fallback) */}
      {waShareModal && (
        <WhatsAppShareModal
          imageBase64={waShareModal.jpgBase64}
          filename={waShareModal.filename}
          whatsappUrl={waShareModal.whatsappUrl}
          displayPhone={waShareModal.displayPhone}
          onClose={() => setWaShareModal(null)}
          onToast={showToast}
        />
      )}
      {/* Audit Trail Modal */}
      {showAuditModal && (
        <div onClick={() => setShowAuditModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 540, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, #1A3C28 0%, #2D6A4F 100%)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>📋 Audit Trail & Edit History</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Invoice #{detailSale?.invoiceNo}</div>
              </div>
              <button onClick={() => setShowAuditModal(false)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
              {loadingAudit ? (
                <div className="va-loading">Loading audit logs…</div>
              ) : auditLogs.length === 0 ? (
                <div className="va-empty">No edit history recorded for this invoice yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {auditLogs.map((log: any) => (
                    <div key={log.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 14, background: '#f8fafc' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>
                          {log.action === 'CREATE' ? '✨ Initial Creation' : `✏️ Edited by ${log.user?.name || log.user?.role || 'Admin'}`}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {fmtDateTime(log.createdAt)}
                        </span>
                      </div>

                      {log.newData?.changesSummary && Array.isArray(log.newData.changesSummary) && log.newData.changesSummary.length > 0 && (
                        <div style={{ marginTop: 8, padding: '10px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}>
                          <div style={{ fontWeight: 700, fontSize: 10, color: '#64748b', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Changes Breakdown:</div>
                          {log.newData.changesSummary.map((line: string, idx: number) => (
                            <div key={idx} style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 0', color: line.startsWith('+') ? '#166534' : line.startsWith('-') ? '#991b1b' : '#0f172a' }}>
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                      {log.newData?.reason && (
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, fontStyle: 'italic' }}>
                          Reason: {log.newData.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
