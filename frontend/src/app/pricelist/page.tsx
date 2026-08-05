'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, fmtDateTime, todayInputDate } from '@/utils/formatters';
import { loadBrandConfig, loadBrandConfigWithLogo, generatePriceListHTML, openPrintWindow, writeAndPrint, openDownloadWindow, writeAndDownload, generateTemplateImageBase64, generateTemplateJpgBase64, downloadImage } from '@/utils/documentTemplates';
import { MobileCard, MobileCardRow } from '@/components/ui/MobileCard';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonTable } from '@/components/ui/Skeleton';
import Icon from '@mdi/react';
import { mdiFormatListNumbered } from '@mdi/js';

// ─── Types ────────────────────────────────────────────────────────────────────

enum ProductAvailability {
  AVAILABLE = 'AVAILABLE',
  SEASONAL = 'SEASONAL',
  INACTIVE = 'INACTIVE'
}

interface Product {
  id:           string;
  name:         string;
  urduName?:    string | null;
  category:     string; // vegetable | fruit | other
  defaultUnit:  string;
  availability: ProductAvailability;
  sortOrder:    number;
}

interface PriceItemRow {
  id?:        string;
  productId?: string;
  itemName:   string;
  unit:       string;
  buyRate:    number;
  currentBuyPrice?: number;
  previousBuyPrice?: number;
  currentStock?: number;
  availableStock?: number;
  sellRate:   number;
  notes?:     string;
  // reference/prefilled values to detect changes
  origBuyRate?:  number;
  origSellRate?: number;
  product?: {
    id?:           string;
    name?:         string;
    urduName?:     string | null;
    category?:     string;
    availability?: ProductAvailability;
  };
}

interface PriceList {
  id:         string;
  date:       string;
  isActive:   boolean;
  notes?:     string;
  createdBy?: { name: string };
  items:      PriceItemRow[];
  isDraft?:   boolean;
  _count?:    { items: number };
}

interface HistoryEntry {
  itemName: string;
  product?: { urduName?: string | null; category?: string };
  latest: { sellRate: number; buyRate: number; marginPct: number; date: string; } | null;
  history: {
    date: string;
    buyRate: number;
    sellRate: number;
    margin: number;
    marginPct: number;
    sellChange: number | null;
    buyChange: number | null;
  }[];
}

const UNITS = ['KG', 'G', 'DOZEN', 'PIECE', 'BOX', 'CRATE', 'BUNDLE', 'TRAY'];
const CATEGORIES = ['vegetable', 'fruit', 'other'];
const CLIENT_TYPES = ['RETAIL', 'WHOLESALE', 'HOTEL', 'RESTAURANT', 'HOSTEL', 'CATERER', 'HOUSEHOLD', 'OTHER'];

// ─── Component Helpers ────────────────────────────────────────────────────────

function ChangeChip({ val }: { val: number | null }) {
  if (val === null || val === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>;
  const pos = val > 0;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
      background: pos ? '#FEF3D4' : '#F0FAF3',
      color: pos ? 'var(--mustard)' : 'var(--ok)',
    }}>
      {pos ? '▲' : '▼'} {Math.abs(val).toFixed(1)}%
    </span>
  );
}

function MarginBar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 60);
  const color   = pct < 5 ? 'var(--danger)' : pct < 15 ? 'var(--mustard)' : 'var(--ok)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: 'var(--line)', borderRadius: 4, overflow: 'hidden', minWidth: 40 }}>
        <div style={{ width: `${clamped / 60 * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span className="mono" style={{ fontSize: 11, color, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PriceListPage() {
  const [tab, setTab] = useState<'today' | 'history' | 'lists' | 'catalog'>('today');

  // WhatsApp Broadcast States
  const [showShareOptionsModal, setShowShareOptionsModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewImgUrl, setPreviewImgUrl] = useState<string | null>(null);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastFilter, setBroadcastFilter] = useState<'ALL' | 'CATEGORY' | 'SELECTED'>('ALL');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastGreeting, setBroadcastGreeting] = useState('');
  const [broadcastClients, setBroadcastClients] = useState<any[]>([]);
  const [waSettings, setWaSettings] = useState<any>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [activeBroadcastId, setActiveBroadcastId] = useState<string | null>(null);
  const [broadcastProgress, setBroadcastProgress] = useState<any>(null);

  // Master Catalog State
  const [products, setProducts] = useState<Product[]>([]);
  const [newProdName, setNewProdName] = useState('');
  const [newProdUrdu, setNewProdUrdu] = useState('');
  const [newProdCat, setNewProdCat] = useState('vegetable');
  const [newProdUnit, setNewProdUnit] = useState('KG');
  const [newProdAvail, setNewProdAvail] = useState<ProductAvailability>(ProductAvailability.AVAILABLE);

  // Today's snapshot state
  const [targetDate, setTargetDate] = useState(() => todayInputDate());
  const [currentList, setCurrentList] = useState<PriceList | null>(() => {
    return getCachedData<PriceList>(`/api/pricelist?date=${todayInputDate()}`) || null;
  });
  const [editItems, setEditItems] = useState<PriceItemRow[]>(() => {
    const cached = getCachedData<any>(`/api/pricelist?date=${todayInputDate()}`);
    return cached?.items?.map((i: PriceItemRow) => ({ ...i, origBuyRate: i.buyRate, origSellRate: i.sellRate })) || [];
  });
  const [listNotes, setListNotes] = useState(() => {
    const cached = getCachedData<any>(`/api/pricelist?date=${todayInputDate()}`);
    return cached?.notes ?? '';
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isDraft, setIsDraft] = useState(() => {
    const cached = getCachedData<any>(`/api/pricelist?date=${todayInputDate()}`);
    return !!cached?.isDraft;
  });

  // Lists & History state
  const [lists, setLists] = useState<PriceList[]>(() => {
    return getCachedData<PriceList[]>('/api/pricelist?limit=30') || [];
  });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyDays, setHistoryDays] = useState(30);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  // Date Comparison state
  const [compareDateA, setCompareDateA] = useState('');
  const [compareDateB, setCompareDateB] = useState('');
  const [compareResults, setCompareResults] = useState<any[]>([]);

  // Search/Filters
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');

  // UI state
  const [loading, setLoading] = useState(() => {
    return !getCachedData<PriceList>(`/api/pricelist?date=${todayInputDate()}`);
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ─── Data Loaders ──────────────────────────────────────────────────────────

  const loadProducts = useCallback(async () => {
    try {
      const data = await fetchWithCache<Product[]>('/api/products?availability=ALL', { ttl: TTL_LONG });
      if (data) setProducts(data);
    } catch (err) {
      console.error('loadProducts error:', err);
    }
  }, []);

  const loadDateList = useCallback(async (date: string, isBackground = false) => {
    if (!isBackground && (!currentList || currentList.date !== date)) setLoading(true);
    try {
      const data = await fetchWithCache<any>(`/api/pricelist?date=${date}`, { ttl: TTL_MEDIUM, forceRefresh: isBackground });
      if (data) {
        setCurrentList(data);
        setIsDraft(!!data.isDraft);
        const items = data.items ?? [];
        if (!isEditing) {
          setEditItems(items.map((i: PriceItemRow) => ({
            ...i,
            origBuyRate: i.buyRate,
            origSellRate: i.sellRate,
          })));
        }
        setListNotes(data.notes ?? '');
      }
    } catch (err) {
      console.error('loadDateList error:', err);
    } finally {
      setLoading(false);
    }
  }, [isEditing, currentList]);

  const loadLists = useCallback(async () => {
    try {
      const data = await fetchWithCache<PriceList[]>('/api/pricelist?limit=30', { ttl: TTL_MEDIUM });
      if (data) setLists(data);
    } catch (err) {
      console.error('loadLists error:', err);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/pricelist/history?days=${historyDays}`);
      const text = await res.text();
      const data = text ? JSON.parse(text) : { success: false };
      if (data.success) setHistory(data.data ?? []);
    } catch (err) {
      console.error('loadHistory error:', err);
    }
    setLoading(false);
  }, [historyDays]);

  const loadWaSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/broadcasts/settings');
      const d = await res.json();
      if (d.success && d.data) {
        setWaSettings(d.data);
        setBroadcastGreeting(d.data.defaultGreeting || '');
      }
    } catch (err) {
      console.error(err);
    }
  }, []);

  const loadBroadcastClients = useCallback(async () => {
    try {
      const res = await apiFetch('/api/clients?minimal=true');
      const d = await res.json();
      if (d.success) setBroadcastClients(d.data ?? []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Initial resources load on mount (no date dependency)
  useEffect(() => {
    Promise.all([
      loadProducts(),
      loadLists(),
      loadWaSettings(),
      loadBroadcastClients(),
    ]);
  }, [loadProducts, loadLists, loadWaSettings, loadBroadcastClients]);

  // Load daily price list when targetDate changes
  useEffect(() => {
    loadDateList(targetDate);
  }, [loadDateList, targetDate]);

  useEffect(() => {
    const handleRevalidate = () => {
      loadDateList(targetDate, true);
      loadProducts();
      loadLists();
      if (tab === 'history') loadHistory();
    };
    window.addEventListener('app-revalidate', handleRevalidate);
    return () => window.removeEventListener('app-revalidate', handleRevalidate);
  }, [loadDateList, targetDate, loadProducts, loadLists, tab, loadHistory]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab, loadHistory]);

  useEffect(() => {
    if (!activeBroadcastId) return;

    const interval = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/broadcasts/${activeBroadcastId}`);
        const d = await res.json();
        if (d.success) {
          setBroadcastProgress(d.data);
          if (d.data.status === 'COMPLETED' || d.data.status === 'FAILED') {
            clearInterval(interval);
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeBroadcastId]);

  // ─── Auto-refresh: reload today's price list when tab regains focus ────────
  // This ensures Buy Rates update instantly after saving a Purchase in another tab, but pauses while user is editing.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && tab === 'today' && !isEditing) {
        loadDateList(targetDate, true); // background update
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [tab, targetDate, loadDateList, isEditing]);

  // ─── Auto-refresh: poll every 30 s while on today tab (background purchases) ─
  useEffect(() => {
    if (tab !== 'today' || isEditing) return;
    const interval = setInterval(() => {
      loadDateList(targetDate, true); // background update
    }, 30_000);
    return () => clearInterval(interval);
  }, [tab, targetDate, loadDateList, isEditing]);

  // ─── Helper: Get Fruit/Veggie Emoji ───────────────────────────────────────
  const getItemEmoji = (name: string): string => {
    const n = (name || '').toLowerCase().trim();

    // 1. Emojis for products (standardized list)
    if (n.includes('lady finger') || n.includes('okra') || n.includes('bhindi') || n === 'ladyfinger') return '🫛';
    if (n.includes('guava') || n.includes('amrood')) return '🍏';
    if (n.includes('papaya') || n.includes('papeeta') || n.includes('papiya')) return '🍈';
    if (n.includes('pomegranate') || n.includes('anar')) return '🍎';
    if (n.includes('turnip') || n.includes('shalgam')) return '🫜';
    if (n.includes('radish') || n.includes('mooli')) return '🫜';
    if (n.includes('beetroot') || n.includes('chukandar')) return '🫜';
    if (n.includes('plum') || n.includes('alobukhara')) return '🍑';

    if (n.includes('beans') || n.includes('phali')) return '🫘';
    if (n.includes('bitter') || n.includes('karela')) return '🥒';
    if (n.includes('bottle') || n.includes('lauki') || n.includes('ghia') || n.includes('gourd')) return '🥒';
    if (n.includes('brinjal') || n.includes('baingan') || n.includes('eggplant')) return '🍆';
    if (n.includes('broccoli')) return '🥦';
    if (n.includes('cabbage') || n.includes('gobhi') || n.includes('gobi')) return '🥬';
    if (n.includes('capsicum') || n.includes('shimla')) return '🫑';
    if (n.includes('carrot') || n.includes('gajar')) return '🥕';
    if (n.includes('cauliflower')) return '🥦';
    if (n.includes('coriander') || n.includes('dhaniya')) return '🌿';
    if (n.includes('corn') || n.includes('makai') || n.includes('bhutta')) return '🌽';
    if (n.includes('cucumber') || n.includes('kheera')) return '🥒';
    if (n.includes('garlic') || n.includes('lehsun')) return '🧄';
    if (n.includes('ginger') || n.includes('adrak')) return '𫚚';
    if (n.includes('green chilli') || n.includes('green chili') || n.includes('hari mirch')) return '🌶️';
    if (n.includes('chilli') || n.includes('chili') || n.includes('mirch')) return '🌶️';
    if (n.includes('iceberg')) return '🥬';
    if (n.includes('lemon') || n.includes('limo') || n.includes('nimbu')) return '🍋';
    if (n.includes('lettuce')) return '🥬';
    if (n.includes('mint') || n.includes('pudina')) return '🌿';
    if (n.includes('mushroom')) return '🍄';
    if (n.includes('onion') || n.includes('piaz') || n.includes('pyaz')) return '🧅';
    if (n.includes('peas') || n.includes('matar')) return '🫛';
    if (n.includes('potato') || n.includes('aloo')) return '🥔';
    if (n.includes('pumpkin') || n.includes('kaddu')) return '🎃';
    if (n.includes('spinach') || n.includes('palak')) return '🥬';
    if (n.includes('sweet potato') || n.includes('shakarkandi')) return '🍠';
    if (n.includes('tomato') || n.includes('tamatar')) return '🍅';
    if (n.includes('apple') || n.includes('seeb')) return '🍎';
    if (n.includes('banana') || n.includes('kela')) return '🍌';
    if (n.includes('grapes') || n.includes('angoor')) return '🍇';
    if (n.includes('mango') || n.includes('aam')) return '🥭';
    if (n.includes('melon') || n.includes('kharbooza')) return '🍈';
    if (n.includes('orange') || n.includes('malta') || n.includes('kinnow')) return '🍊';
    if (n.includes('peach') || n.includes('aaroo')) return '🍑';
    if (n.includes('pear') || n.includes('nashpati')) return '🍐';
    if (n.includes('watermelon') || n.includes('tarbooz')) return '🍉';

    return '🥬';
  };

  // ─── WhatsApp Image Broadcast Actions ──────────────────────────────────────
  
  const generateBroadcastImageBase64 = async (): Promise<string | null> => {
    try {
      const items = editItems.filter(i => i.sellRate > 0);
      if (items.length === 0) return null;
      const brand = await loadBrandConfigWithLogo();
      const dateStr = fmtDate(targetDate);
      const html = generatePriceListHTML(
        {
          dateStr,
          items: items.map(it => ({
            itemName: it.itemName,
            unit:     it.unit,
            sellRate: it.sellRate,
            urduName: it.product?.urduName,
            category: it.product?.category,
          })),
          notes: listNotes || undefined,
        },
        brand,
        window.location.origin,
      );
      return await generateTemplateJpgBase64(html);
    } catch (err) {
      console.error('generateBroadcastImageBase64 error:', err);
      return null;
    }
  };

  const startBroadcast = async () => {
    setIsBroadcasting(true);
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Image generation failed');
        setIsBroadcasting(false);
        return;
      }

      const uploadRes = await apiFetch('/api/broadcasts/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Img,
          filename: `broadcast_${targetDate}.jpg`
        })
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.success || !uploadData.imageUrl) {
        showToast('❌ Failed to upload broadcast image');
        setIsBroadcasting(false);
        return;
      }

      let targetClientIds: string[] = [];
      if (broadcastFilter === 'ALL') {
        targetClientIds = [];
      } else if (broadcastFilter === 'CATEGORY') {
        // Handled in backend, categories passed
      } else if (broadcastFilter === 'SELECTED') {
        targetClientIds = Array.from(selectedClients);
        if (targetClientIds.length === 0) {
          showToast('❌ Please select at least one client');
          setIsBroadcasting(false);
          return;
        }
      }

      const res = await apiFetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceListDate: targetDate,
          filterType: broadcastFilter,
          categories: selectedCategories,
          selectedClientIds: targetClientIds,
          customMessage: broadcastGreeting,
          imageUrl: uploadData.imageUrl
        })
      });

      const d = await res.json();
      if (d.success) {
        showToast('🚀 Broadcast queue initiated successfully');
        setActiveBroadcastId(d.data.id);
        setBroadcastProgress(d.data);
      } else {
        showToast('❌ ' + (d.error ?? 'Broadcast trigger failed'));
      }
    } catch (err: any) {
      showToast('❌ ' + err.message);
    } finally {
      setIsBroadcasting(false);
    }
  };

  const downloadPriceListJpg = async () => {
    showToast('⏳ Generating image...');
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Unable to generate the image. Please try again.');
        return;
      }
      showToast('📦 Preparing download...');
      downloadImage(base64Img, `HalalVeggRates_${targetDate}.jpg`);
      showToast('💾 Image downloaded successfully!');
    } catch (err: any) {
      showToast('❌ Unable to generate the image. Please try again.');
    }
  };

  const shareWhatsAppStatus = async () => {
    showToast('⏳ Generating image...');
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Unable to generate the image. Please try again.');
        return;
      }
      showToast('📦 Preparing download...');
      downloadImage(base64Img, `HalalVeggRatesStatus_${targetDate}.jpg`);
      showToast('📢 Status Image downloaded! You can now upload it as your WhatsApp Status.');
    } catch (err: any) {
      showToast('❌ Unable to generate the image. Please try again.');
    }
  };

  const previewPriceListImage = async () => {
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Image generation failed');
        return;
      }
      setPreviewImgUrl(base64Img);
      setShowPreviewModal(true);
    } catch (err: any) {
      showToast('❌ ' + err.message);
    }
  };

  const handleRetryFailed = async (broadcastId: string) => {
    try {
      const res = await apiFetch(`/api/broadcasts/${broadcastId}/retry`, {
        method: 'POST'
      });
      const d = await res.json();
      if (d.success) {
        showToast(`🔄 Retrying failed deliveries (${d.count} messages)`);
        setActiveBroadcastId(broadcastId);
      } else {
        showToast('❌ ' + (d.error ?? 'Retry trigger failed'));
      }
    } catch (err: any) {
      showToast('❌ ' + err.message);
    }
  };

  // ─── Master Product Catalog Actions ──────────────────────────────────────────

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdName.trim()) return showToast('Product name is required');

    setSaving(true);
    try {
      const res = await apiFetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProdName,
          urduName: newProdUrdu,
          category: newProdCat,
          defaultUnit: newProdUnit,
          availability: newProdAvail
        })
      });
      const data = await res.json();
      if (data.success) {
        invalidateCache('/api/products');
        invalidateCache('/api/pricelist');
        showToast(`✅ ${newProdName} added to master catalog`);
        setNewProdName('');
        setNewProdUrdu('');
        await loadProducts();
        await loadDateList(targetDate, true); // refresh dynamic lists
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to add product'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateProductAvailability = async (id: string, avail: ProductAvailability) => {
    try {
      const res = await apiFetch(`/api/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability: avail })
      });
      const data = await res.json();
      if (data.success) {
        invalidateCache('/api/products');
        invalidateCache('/api/pricelist');
        showToast('✅ Status updated');
        await loadProducts();
        await loadDateList(targetDate, true);
      }
    } catch {
      showToast('❌ Failed to update status');
    }
  };

  // ─── Today's Snapshot Actions ──────────────────────────────────────────────

  const updateRate = (idx: number, field: 'buyRate' | 'sellRate', val: number) => {
    setEditItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
  };

  const handleBulkMarkup = (pct: number) => {
    setEditItems(prev => prev.map(item => {
      const newSell = Math.round(item.buyRate * (1 + pct / 100));
      return { ...item, sellRate: newSell };
    }));
    showToast(`Applied ${pct}% markup to sell rates`);
  };

  const saveDailyPrices = async () => {
    const todayStr = todayInputDate();
    if (targetDate !== todayStr) {
      showToast('❌ Editing past prices is not allowed.');
      return;
    }
    setSaving(true);
    try {
      // Always store daily snapshot
      const res = await apiFetch('/api/pricelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: targetDate,
          notes: listNotes,
          items: editItems.map(item => ({
            productId: item.productId,
            itemName: item.itemName,
            unit: item.unit,
            buyRate: item.buyRate,
            sellRate: item.sellRate,
            notes: item.notes
          }))
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        invalidateCache('/api/pricelist');
        showToast(`✅ Saved pricing snapshot for ${fmtDate(targetDate)}`);
        setIsEditing(false);
        await loadDateList(targetDate, true);
        await loadLists();
      } else {
        // If conflict (exists), allow PATCH updates
        if (res.status === 409 && currentList?.id) {
          const updateRes = await apiFetch(`/api/pricelist/${currentList.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notes: listNotes,
              items: editItems
            })
          });
          const updateData = await updateRes.json();
          if (updateData.success) {
            invalidateCache('/api/pricelist');
            showToast(`✅ Updated pricing snapshot for ${fmtDate(targetDate)}`);
            setIsEditing(false);
            await loadDateList(targetDate, true);
            await loadLists();
          } else {
            showToast('❌ ' + (updateData.error ?? 'Failed to update'));
          }
        } else {
          showToast('❌ ' + (data.error ?? 'Save failed'));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const duplicateYesterday = async () => {
    const todayStr = todayInputDate();
    if (targetDate !== todayStr) {
      showToast('❌ Copying rates is only allowed for today.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch('/api/pricelist/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✅ Duplicated yesterday's prices into today's list`);
        setTargetDate(todayInputDate());
        await loadDateList(todayInputDate());
      } else {
        showToast('❌ ' + (data.error ?? 'Failed to duplicate'));
      }
    } finally {
      setSaving(false);
    }
  };

  // ─── Compare Dates Action ──────────────────────────────────────────────────

  const handleCompare = async () => {
    if (!compareDateA || !compareDateB) return showToast('Please select both dates to compare');
    setLoading(true);
    try {
      const [resA, resB] = await Promise.all([
        apiFetch(`/api/pricelist?date=${compareDateA}`),
        apiFetch(`/api/pricelist?date=${compareDateB}`)
      ]);
      
      const getJson = async (res: Response) => {
        try {
          const text = await res.text();
          return text ? JSON.parse(text) : { success: false };
        } catch (e) {
          console.error('Failed parsing json', e);
          return { success: false };
        }
      };

      const [dataA, dataB] = await Promise.all([getJson(resA), getJson(resB)]);

      const itemsA = dataA.data?.items ?? [];
      const itemsB = dataB.data?.items ?? [];

      const mapA = Object.fromEntries(itemsA.map((i: any) => [i.itemName.toLowerCase(), i]));
      const results: any[] = [];

      itemsB.forEach((itemB: any) => {
        const itemA = mapA[itemB.itemName.toLowerCase()];
        const diffBuy = itemA ? itemB.buyRate - itemA.buyRate : 0;
        const diffSell = itemA ? itemB.sellRate - itemA.sellRate : 0;
        results.push({
          name: itemB.itemName,
          unit: itemB.unit,
          buyA: itemA?.buyRate ?? 0,
          buyB: itemB.buyRate,
          diffBuy,
          sellA: itemA?.sellRate ?? 0,
          sellB: itemB.sellRate,
          diffSell
        });
      });

      setCompareResults(results);
    } finally {
      setLoading(false);
    }
  };

  // ─── PDF Export ─────────────────────────────────────────────────────────────
  const exportPDF = async () => {
    const items = editItems.filter(i => i.sellRate > 0);
    if (items.length === 0) return showToast('No rates to export');
    // Open window synchronously first — avoids browser popup blocker
    const w = openPrintWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const brand = await loadBrandConfigWithLogo();
    const dateStr = fmtDate(targetDate);
    const html = generatePriceListHTML(
      {
        dateStr,
        items: items.map(it => ({
          itemName: it.itemName,
          unit:     it.unit,
          sellRate: it.sellRate,
          urduName: it.product?.urduName,
          category: it.product?.category,
        })),
        notes: listNotes || undefined,
      },
      brand,
      window.location.origin,
    );
    writeAndPrint(w, html, `Daily Price List — ${dateStr}`);
  };

  const downloadPDF = async () => {
    const items = editItems.filter(i => i.sellRate > 0);
    if (items.length === 0) return showToast('No rates to export');
    // Open window synchronously first — avoids browser popup blocker
    const w = openDownloadWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const brand = await loadBrandConfigWithLogo();
    const dateStr = fmtDate(targetDate);
    const html = generatePriceListHTML(
      {
        dateStr,
        items: items.map(it => ({
          itemName: it.itemName,
          unit:     it.unit,
          sellRate: it.sellRate,
          urduName: it.product?.urduName,
          category: it.product?.category,
        })),
        notes: listNotes || undefined,
      },
      brand,
      window.location.origin,
    );
    writeAndDownload(w, html, `Price_List_${dateStr.replace(/\s+/g, '_')}.pdf`);
  };

  // ─── Filters & Search Helper ───────────────────────────────────────────────

  const filteredEditItems = editItems.filter(item => {
    const matchesSearch = item.itemName.toLowerCase().includes(search.toLowerCase());
    const matchesCat = catFilter === 'all' || item.product?.category === catFilter;
    return matchesSearch && matchesCat;
  });

  const filteredHistory = history.filter(h => {
    const matchesSearch = h.itemName.toLowerCase().includes(search.toLowerCase());
    const matchesCat = catFilter === 'all' || h.product?.category === catFilter;
    return matchesSearch && matchesCat;
  });

  const filteredCatalog = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || (p.urduName && p.urduName.includes(search));
    const matchesCat = catFilter === 'all' || p.category === catFilter;
    return matchesSearch && matchesCat;
  });

  return (
    <DashboardLayout>
      {/* Toast Alert */}
      {toast && (
        <div className="va-toast" style={{ position: 'fixed', top: 70, right: 24, zIndex: 9999, padding: '10px 16px', background: '#1F3D2B', color: '#fff', borderRadius: 8, fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {/* ─── Page Title Bar ─── */}
      <div className="va-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, verticalAlign: 'middle' }}>
              <Icon path={mdiFormatListNumbered} size={1} color="var(--primary)" />
              <h2 style={{ margin: 0 }}>Price List &amp; Catalog</h2>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0 0' }}>
              Indefinite snapshot logs for billing, order dispatch, and profitability analysis
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {targetDate === todayInputDate() ? (
              <>
                <button className="va-btn secondary small" onClick={duplicateYesterday} disabled={saving}>Copy Yesterday</button>
                {isEditing ? (
                  <>
                    <button className="va-btn secondary small" onClick={() => setIsEditing(false)}>Cancel</button>
                    <button className="va-btn small" onClick={saveDailyPrices} disabled={saving}>Save Prices</button>
                  </>
                ) : (
                  <button className="va-btn small" onClick={() => setIsEditing(true)}>Edit Daily Prices</button>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, padding: '6px 12px', background: '#F5F5F0', border: '1px solid var(--line)', borderRadius: 6, color: 'var(--muted)', fontWeight: 600 }}>
                🔒 Read Only (Past Date)
              </span>
            )}
            {currentList && !isDraft && (
              <button 
                className="va-btn small" 
                style={{ background: '#25D366', color: '#fff', borderColor: '#25D366', fontWeight: 'bold' }}
                onClick={() => setShowShareOptionsModal(true)}
              >
                📤 Share Today’s Price List
              </button>
            )}
            <button className="va-btn secondary small" onClick={exportPDF}>Export PDF</button>
            <button className="va-btn secondary small" onClick={downloadPDF}>💾 Download PDF</button>
          </div>
        </div>
      </div>

      {/* ─── Inline Navigation Tabs ─── */}
      <div className="va-tabs-inline">
        <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>Daily Rate Entry</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Indefinite Price History</button>
        <button className={tab === 'lists' ? 'active' : ''} onClick={() => setTab('lists')}>Saved Snapshots</button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>Product Master Catalog</button>
      </div>

      {/* ─── Global Filters bar ─── */}
      {tab !== 'lists' && (
        <div className="va-panel" style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search items by name..."
              style={{ flex: 2, minWidth: 200, padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
            />
            <select
              value={catFilter}
              onChange={e => setCatFilter(e.target.value)}
              style={{ flex: 1, minWidth: 130, padding: '6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
            >
              <option value="all">All Categories</option>
              <option value="vegetable">Vegetables</option>
              <option value="fruit">Fruits</option>
              <option value="other">Other</option>
            </select>
            {tab === 'today' && (
              <input
                type="date"
                value={targetDate}
                max={todayInputDate()}
                onChange={e => {
                  const selectedDate = e.target.value;
                  const today = todayInputDate();
                  if (selectedDate > today) return;
                  setIsEditing(false);
                  setTargetDate(selectedDate);
                  loadDateList(selectedDate);
                }}
                style={{ padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }}
              />
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: DAILY PRICE ENTRY                                     */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {tab === 'today' && (
        <div className="va-panel">
          <div className="va-panel-head">
            <h3>{fmtDate(targetDate)} {isDraft ? '(Draft Catalog template)' : '(Saved Snapshot)'}</h3>
            {isEditing && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="va-btn secondary small" onClick={() => handleBulkMarkup(15)}>+15% Markup</button>
                <button className="va-btn secondary small" onClick={() => handleBulkMarkup(25)}>+25% Markup</button>
              </div>
            )}
          </div>

          {loading && filteredEditItems.length === 0 ? (
            <div style={{ padding: 16 }}><SkeletonTable rows={7} cols={6} /></div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hide-mobile">
                <div style={{ overflowX: 'auto' }}>
                  <table className="va-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Unit</th>
                        <th>Category</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Prev Buy Price</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Current Buy Price (Inventory)</th>
                        <th style={{ textAlign: 'right', width: 140 }}>Sell Rate (Customer)</th>
                        <th style={{ textAlign: 'right', width: 100 }}>Profit Margin</th>
                        <th style={{ minWidth: 110 }}>Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEditItems.length === 0 ? (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>No products in active master catalog</td></tr>
                      ) : (
                        filteredEditItems.map((item, idx) => {
                          const realIndex = editItems.indexOf(item);
                          const buyRate = item.currentBuyPrice ?? item.buyRate ?? 0;
                          const prevBuyRate = item.previousBuyPrice ?? 0;
                          const margin = item.sellRate - buyRate;
                          const marginPct = buyRate > 0 ? (margin / buyRate) * 100 : 0;
                          const sellChanged = item.origSellRate !== undefined && item.sellRate !== item.origSellRate;

                          return (
                            <tr key={idx} style={{ background: sellChanged ? '#FFFBE6' : undefined }}>
                              <td>
                                <strong>{item.itemName}</strong>
                                {item.product?.urduName && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>({item.product.urduName})</span>}
                                {item.availableStock !== undefined && (
                                  <div style={{ fontSize: 11, color: item.availableStock > 0 ? 'var(--forest)' : 'var(--danger)' }}>
                                    Stock: {item.availableStock.toFixed(2)} {item.unit}
                                  </div>
                                )}
                              </td>
                              <td style={{ color: 'var(--muted)' }}>{item.unit}</td>
                              <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{item.product?.category}</td>
                              <td className="mono" style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                {prevBuyRate > 0 ? `Rs ${prevBuyRate.toFixed(2)}` : '—'}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--forest)' }}>
                                {buyRate > 0 ? `Rs ${buyRate.toFixed(2)}` : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {isEditing ? (
                                  <input
                                    type="number"
                                    value={item.sellRate ?? ''}
                                    onFocus={e => e.target.select()}
                                    onChange={e => updateRate(realIndex, 'sellRate', e.target.value === '' ? 0 : Number(e.target.value))}
                                    style={{ width: 100, textAlign: 'right', padding: '4px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)', color: 'var(--ink)', fontWeight: 'bold' }}
                                  />
                                ) : (
                                  <span className="mono" style={{ fontWeight: 'bold' }}>Rs {item.sellRate}</span>
                                )}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', color: margin >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                                Rs {margin.toFixed(0)}
                              </td>
                              <td>
                                <MarginBar pct={marginPct} />
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Card List View */}
              <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                {filteredEditItems.length === 0 ? (
                  <div className="va-empty">No products in active master catalog</div>
                ) : (
                  filteredEditItems.map((item, idx) => {
                    const realIndex = editItems.indexOf(item);
                    const margin = item.sellRate - item.buyRate;
                    const marginPct = item.buyRate > 0 ? (margin / item.buyRate) * 100 : 0;
                    const buyChanged = item.origBuyRate !== undefined && item.buyRate !== item.origBuyRate;
                    const sellChanged = item.origSellRate !== undefined && item.sellRate !== item.origSellRate;

                    return (
                      <MobileCard
                        key={idx}
                        title={item.itemName}
                        headerBadge={item.product?.urduName || item.unit}
                        style={{
                          background: (buyChanged || sellChanged) ? '#FFFDE6' : '#FFFFFF',
                        }}
                      >
                        <MobileCardRow label="Unit / Category" value={`${item.unit} · ${item.product?.category || 'General'}`} />
                        <MobileCardRow label="Buy Rate (Mandi)">
                          {isEditing ? (
                            <input
                              type="number"
                              value={item.buyRate ?? ''}
                              onFocus={e => e.target.select()}
                              onChange={e => updateRate(realIndex, 'buyRate', e.target.value === '' ? 0 : Number(e.target.value))}
                              style={{ width: 100, textAlign: 'right', padding: '4px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: '13px', fontWeight: 700 }}
                            />
                          ) : (
                            `Rs ${item.buyRate}`
                          )}
                        </MobileCardRow>
                        <MobileCardRow label="Sell Rate (Customer)">
                          {isEditing ? (
                            <input
                              type="number"
                              value={item.sellRate || ''}
                              onChange={e => updateRate(realIndex, 'sellRate', +e.target.value)}
                              style={{ width: 100, textAlign: 'right', padding: '4px', border: '1px solid #CBD5E1', borderRadius: 6, background: '#F8FAFC', fontSize: '13px', fontWeight: 700 }}
                            />
                          ) : (
                            `Rs ${item.sellRate}`
                          )}
                        </MobileCardRow>
                        <MobileCardRow 
                          label="Profit Margin" 
                          value={`Rs ${margin.toFixed(0)}`} 
                          valueColor={margin < 0 ? '#991B1B' : '#166534'} 
                          isMono 
                        />
                        <MobileCardRow label="Margin %">
                          <div style={{ maxWidth: 120, width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                            <MarginBar pct={marginPct} />
                          </div>
                        </MobileCardRow>
                      </MobileCard>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: INDEFINITE PRICE HISTORY                              */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <>
          {/* Two-Date Comparison Tool */}
          <div className="va-panel">
            <div className="va-panel-head"><h3>📅 Compare Prices Between Two Dates</h3></div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700 }}>Base Date A</label>
                <input type="date" value={compareDateA} onChange={e => setCompareDateA(e.target.value)} style={{ display: 'block', padding: '6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700 }}>Compare Date B</label>
                <input type="date" value={compareDateB} onChange={e => setCompareDateB(e.target.value)} style={{ display: 'block', padding: '6px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <button className="va-btn" onClick={handleCompare}>Compare Snapshots</button>
            </div>

            {compareResults.length > 0 && (
              <>
                {/* Desktop view */}
                <div className="hide-mobile">
                  <div style={{ overflowX: 'auto', marginTop: 20 }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Unit</th>
                          <th style={{ textAlign: 'right' }}>Buy (Date A)</th>
                          <th style={{ textAlign: 'right' }}>Buy (Date B)</th>
                          <th>Buy Change</th>
                          <th style={{ textAlign: 'right' }}>Sell (Date A)</th>
                          <th style={{ textAlign: 'right' }}>Sell (Date B)</th>
                          <th>Sell Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {compareResults.map((r, i) => (
                          <tr key={i}>
                            <td><strong>{r.name}</strong></td>
                            <td>{r.unit}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>Rs {r.buyA}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>Rs {r.buyB}</td>
                            <td>
                              <ChangeChip val={r.buyA > 0 ? ((r.buyB - r.buyA) / r.buyA) * 100 : null} />
                            </td>
                            <td className="mono" style={{ textAlign: 'right' }}>Rs {r.sellA}</td>
                            <td className="mono" style={{ textAlign: 'right' }}>Rs {r.sellB}</td>
                            <td>
                              <ChangeChip val={r.sellA > 0 ? ((r.sellB - r.sellA) / r.sellA) * 100 : null} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile view */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%', marginTop: 20 }}>
                  {compareResults.map((r, i) => (
                    <div key={i} className="va-mobile-card">
                      <div className="card-header">
                        <span className="card-title" style={{ color: '#FFFFFF' }}>{r.name}</span>
                        <span className="card-subtitle">{r.unit}</span>
                      </div>

                      <div className="card-divider" />

                      <div className="flex flex-col gap-2.5">
                        <div className="card-info-row">
                          <span className="card-label">Buy Rate (A ➔ B)</span>
                          <span className="card-value flex items-center gap-1.5 justify-end">
                            Rs {r.buyA} ➔ Rs {r.buyB}
                            <ChangeChip val={r.buyA > 0 ? ((r.buyB - r.buyA) / r.buyA) * 100 : null} />
                          </span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Sell Rate (A ➔ B)</span>
                          <span className="card-value flex items-center gap-1.5 justify-end">
                            Rs {r.sellA} ➔ Rs {r.sellB}
                            <ChangeChip val={r.sellA > 0 ? ((r.sellB - r.sellA) / r.sellA) * 100 : null} />
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Indefinite Logs list */}
          <div className="va-panel">
            <div className="va-panel-head">
              <h3>Indefinite Price History Logs</h3>
              <select value={historyDays} onChange={e => setHistoryDays(+e.target.value)} style={{ padding: '4px', border: '1px solid var(--line)', borderRadius: 4, background: 'var(--paper)', color: 'var(--ink)' }}>
                <option value={30}>Last 30 days</option>
                <option value={180}>Last 6 months</option>
                <option value={365}>Last 1 year</option>
                <option value={1825}>Last 5 years</option>
              </select>
            </div>

            {loading ? (
              <div className="va-loading">Computing historical trends...</div>
            ) : (
              <>
                {/* Desktop View */}
                <div className="hide-mobile">
                  <div style={{ overflowX: 'auto' }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>Latest Buy</th>
                          <th style={{ textAlign: 'right' }}>Latest Sell</th>
                          <th>Margin</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.map(h => (
                          <>
                            <tr key={h.itemName} style={{ cursor: 'pointer' }} onClick={() => setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName)}>
                              <td>
                                <strong>{h.itemName}</strong>
                                {h.product?.urduName && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>({h.product.urduName})</span>}
                              </td>
                              <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{h.product?.category}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>Rs {h.latest?.buyRate ?? '0'}</td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 'bold' }}>Rs {h.latest?.sellRate ?? '0'}</td>
                              <td><MarginBar pct={h.latest?.marginPct ?? 0} /></td>
                              <td style={{ color: 'var(--muted)', fontSize: 12 }}>{expandedProduct === h.itemName ? '▲ Collapse' : `▼ ${h.history.length} snapshots`}</td>
                            </tr>
                            {expandedProduct === h.itemName && h.history.map((entry, idx) => (
                              <tr key={`${h.itemName}-${idx}`} style={{ background: 'var(--line-soft)', fontSize: 12 }}>
                                <td style={{ paddingLeft: 24 }}>{fmtDate(entry.date)}</td>
                                <td></td>
                                <td className="mono" style={{ textAlign: 'right' }}>Rs {entry.buyRate}</td>
                                <td className="mono" style={{ textAlign: 'right', fontWeight: 'bold' }}>Rs {entry.sellRate}</td>
                                <td className="mono">Rs {entry.margin.toFixed(0)} ({entry.marginPct.toFixed(0)}%)</td>
                                <td>
                                  <span style={{ fontSize: 10, marginRight: 8 }}>Sell Change:</span>
                                  <ChangeChip val={entry.sellChange} />
                                </td>
                              </tr>
                            ))}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile View */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {filteredHistory.map(h => (
                    <div key={h.itemName} className="va-mobile-card" style={{ cursor: 'pointer' }} onClick={() => setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName)}>
                      <div className="card-header">
                        <span className="card-title" style={{ color: '#FFFFFF' }}>{h.itemName}</span>
                        {h.product?.urduName && <span className="card-subtitle text-emerald-100">{h.product.urduName}</span>}
                      </div>

                      <div className="card-divider" />

                      <div className="flex flex-col gap-2.5">
                        <div className="card-info-row">
                          <span className="card-label">Category</span>
                          <span className="card-value text-capitalize">{h.product?.category}</span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Latest Buy / Sell</span>
                          <span className="card-value font-bold">Rs {h.latest?.buyRate ?? '0'} / Rs {h.latest?.sellRate ?? '0'}</span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Margin %</span>
                          <span className="card-value max-w-[60%] flex justify-end">
                            <MarginBar pct={h.latest?.marginPct ?? 0} />
                          </span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Snapshots Log</span>
                          <span className="card-value text-emerald-100">{expandedProduct === h.itemName ? '▲ Collapse' : `▼ ${h.history.length} snapshots`}</span>
                        </div>
                      </div>

                      {expandedProduct === h.itemName && (
                        <>
                          <div className="card-divider" />
                          <div className="flex flex-col gap-3" style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px' }}>
                            {h.history.map((entry, idx) => (
                              <div key={idx} className="flex flex-col gap-1.5" style={{ borderBottom: idx < h.history.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', paddingBottom: idx < h.history.length - 1 ? '10px' : '0' }}>
                                <div className="flex justify-between items-center text-xs font-semibold text-white">
                                  <span>{fmtDate(entry.date)}</span>
                                  <span>Margin: Rs {entry.margin.toFixed(0)} ({entry.marginPct.toFixed(0)}%)</span>
                                </div>
                                <div className="flex justify-between items-center text-xs text-emerald-100">
                                  <span>Buy: Rs {entry.buyRate} | Sell: Rs {entry.sellRate}</span>
                                  <span className="flex items-center gap-1">
                                    <span>Change:</span>
                                    <ChangeChip val={entry.sellChange} />
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: SAVED SNAPSHOTS                                       */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {tab === 'lists' && (
        <div className="va-panel">
          {/* Desktop view */}
          <div className="hide-mobile">
            <div style={{ overflowX: 'auto' }}>
              <table className="va-table">
                <thead>
                  <tr>
                    <th>Snapshot Date</th>
                    <th>Product Count</th>
                    <th>Notes</th>
                    <th>Created By</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lists.map(list => (
                    <tr key={list.id}>
                      <td><strong>{fmtDate(list.date)}</strong></td>
                      <td>{list._count?.items ?? 0} products</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{list.notes ?? '—'}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{list.createdBy?.name ?? 'System'}</td>
                      <td>
                        <button className="va-btn secondary small" onClick={() => {
                          setTargetDate(list.date.slice(0, 10));
                          setTab('today');
                        }}>View Snapshot</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile view */}
          <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
            {lists.map(list => (
              <div key={list.id} className="va-mobile-card">
                <div className="card-header">
                  <span className="card-title" style={{ color: '#FFFFFF' }}>{fmtDate(list.date)}</span>
                  <span className="card-subtitle">{list._count?.items ?? 0} products</span>
                </div>

                <div className="card-divider" />

                <div className="flex flex-col gap-2.5">
                  <div className="card-info-row">
                    <span className="card-label">Notes</span>
                    <span className="card-value max-w-[65%] truncate">{list.notes ?? '—'}</span>
                  </div>
                  <div className="card-info-row">
                    <span className="card-label">Created By</span>
                    <span className="card-value">{list.createdBy?.name ?? 'System'}</span>
                  </div>
                </div>

                <div className="card-divider" />

                <button
                  onClick={() => {
                    setTargetDate(list.date.slice(0, 10));
                    setTab('today');
                  }}
                  className="card-btn"
                  style={{ width: '100%' }}
                >
                  View Snapshot
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* TAB: PRODUCT CATALOG MANAGEMENT                           */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {tab === 'catalog' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
          {/* Add Product Form */}
          <div className="va-panel">
            <div className="va-panel-head"><h3>➕ Add Master Product</h3></div>
            <form onSubmit={handleAddProduct}>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Product Name (English) *</label>
                <input required value={newProdName} onChange={e => setNewProdName(e.target.value)} placeholder="e.g. Avocado" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Urdu Name (Optional)</label>
                <input value={newProdUrdu} onChange={e => setNewProdUrdu(e.target.value)} placeholder="e.g. ایوکاڈو" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Category *</label>
                <select value={newProdCat} onChange={e => setNewProdCat(e.target.value)} style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Default Unit *</label>
                <select value={newProdUnit} onChange={e => setNewProdUnit(e.target.value)} style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                  {UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </div>
              <div className="va-field" style={{ marginBottom: 16 }}>
                <label>Availability Status *</label>
                <select value={newProdAvail} onChange={e => setNewProdAvail(e.target.value as ProductAvailability)} style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
                  <option value={ProductAvailability.AVAILABLE}>Available</option>
                  <option value={ProductAvailability.SEASONAL}>Seasonal</option>
                  <option value={ProductAvailability.INACTIVE}>Inactive</option>
                </select>
              </div>
              <button type="submit" className="va-btn" disabled={saving}>Add to Catalog</button>
            </form>
          </div>

          {/* Master Product List */}
          <div className="va-panel">
            <div className="va-panel-head"><h3>📋 Permanent Catalog Catalog</h3></div>
            {/* Desktop view */}
            <div className="hide-mobile">
              <div style={{ overflowX: 'auto' }}>
                <table className="va-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Category</th>
                      <th>Unit</th>
                      <th>Availability Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalog.map(p => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          {p.urduName && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>({p.urduName})</span>}
                        </td>
                        <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{p.category}</td>
                        <td style={{ color: 'var(--muted)' }}>{p.defaultUnit}</td>
                        <td>
                          <select
                            value={p.availability}
                            onChange={e => handleUpdateProductAvailability(p.id, e.target.value as ProductAvailability)}
                            style={{
                              fontSize: 12, padding: '4px', borderRadius: 4,
                              color: p.availability === ProductAvailability.AVAILABLE ? 'var(--ok)' : p.availability === ProductAvailability.SEASONAL ? 'var(--mustard)' : 'var(--danger)',
                              border: '1px solid var(--line)',
                              background: 'var(--paper)'
                            }}
                          >
                            <option value={ProductAvailability.AVAILABLE}>Available</option>
                            <option value={ProductAvailability.SEASONAL}>Seasonal</option>
                            <option value={ProductAvailability.INACTIVE}>Inactive</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mobile view */}
            <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%', marginTop: '14px' }}>
              {filteredCatalog.map(p => (
                <div key={p.id} className="va-mobile-card">
                  <div className="card-header">
                    <span className="card-title" style={{ color: '#FFFFFF' }}>{p.name}</span>
                    {p.urduName && <span className="card-subtitle text-emerald-100">{p.urduName}</span>}
                  </div>

                  <div className="card-divider" />

                  <div className="flex flex-col gap-2.5">
                    <div className="card-info-row">
                      <span className="card-label">Category</span>
                      <span className="card-value text-capitalize">{p.category}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Default Unit</span>
                      <span className="card-value">{p.defaultUnit}</span>
                    </div>
                    <div className="card-info-row">
                      <span className="card-label">Availability Status</span>
                      <span className="card-value">
                        <select
                          value={p.availability}
                          onChange={e => handleUpdateProductAvailability(p.id, e.target.value as ProductAvailability)}
                          className="bg-transparent border border-white/30 text-white rounded px-2 py-0.5 text-xs font-bold cursor-pointer"
                        >
                          <option value={ProductAvailability.AVAILABLE} style={{ color: '#000' }}>Available</option>
                          <option value={ProductAvailability.SEASONAL} style={{ color: '#000' }}>Seasonal</option>
                          <option value={ProductAvailability.INACTIVE} style={{ color: '#000' }}>Inactive</option>
                        </select>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* ─── MODAL: BROADCAST SETUP & LIVE MONITOR ──────────────── */}
      {showBroadcastModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16
        }}>
          <div className="va-panel" style={{
            width: '100%', maxWidth: '850px', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)'
          }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12 }}>
              <h3>
                {activeBroadcastId ? '📡 WhatsApp Sharing Progress' : '📤 Share Today’s Price List via WhatsApp'}
              </h3>
              <button 
                onClick={() => {
                  setShowBroadcastModal(false);
                  setActiveBroadcastId(null);
                  setBroadcastProgress(null);
                }}
                disabled={isBroadcasting}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            {activeBroadcastId && broadcastProgress ? (
              /* --- LIVE MONITOR VIEW INSIDE MODAL --- */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', padding: '16px 0', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <h4 style={{ margin: 0 }}>Progress Update</h4>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>Broadcast ID: {broadcastProgress.id}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {broadcastProgress.status === 'COMPLETED' && (
                      <span className="va-badge paid" style={{ fontSize: 12, padding: '4px 10px' }}>✓ Completed</span>
                    )}
                    {broadcastProgress.status === 'PROCESSING' && (
                      <span className="va-badge pending" style={{ fontSize: 12, padding: '4px 10px' }}>⚡ Sending...</span>
                    )}
                    {broadcastProgress.status === 'FAILED' && (
                      <span className="va-badge danger" style={{ fontSize: 12, padding: '4px 10px' }}>⚠️ Failed</span>
                    )}
                    {broadcastProgress.failureCount > 0 && broadcastProgress.status === 'COMPLETED' && (
                      <button 
                        className="va-btn danger small" 
                        onClick={() => handleRetryFailed(broadcastProgress.id)}
                      >
                        🔄 Retry Failed ({broadcastProgress.failureCount})
                      </button>
                    )}
                  </div>
                </div>

                {/* KPI progress grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                  <div className="va-card" style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total Clients</div>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{broadcastProgress.totalRecipients}</div>
                  </div>
                  <div className="va-card" style={{ padding: 10, borderLeft: '3px solid var(--ok)' }}>
                    <div style={{ fontSize: 11, color: 'var(--ok)' }}>Sent</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--ok)' }}>{broadcastProgress.successCount}</div>
                  </div>
                  <div className="va-card" style={{ padding: 10, borderLeft: '3px solid var(--danger)' }}>
                    <div style={{ fontSize: 11, color: 'var(--danger)' }}>Failed</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{broadcastProgress.failureCount}</div>
                  </div>
                  <div className="va-card" style={{ padding: 10, borderLeft: '3px solid var(--mustard)' }}>
                    <div style={{ fontSize: 11, color: 'var(--mustard)' }}>Pending</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--mustard)' }}>
                      {Math.max(0, broadcastProgress.totalRecipients - broadcastProgress.successCount - broadcastProgress.failureCount)}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                    <span>Queue Progress</span>
                    <span>{Math.round(((broadcastProgress.successCount + broadcastProgress.failureCount) / broadcastProgress.totalRecipients) * 100)}%</span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: 'var(--line-soft)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${(broadcastProgress.successCount / broadcastProgress.totalRecipients) * 100}%`, height: '100%', background: 'var(--ok)' }} />
                    <div style={{ width: `${(broadcastProgress.failureCount / broadcastProgress.totalRecipients) * 100}%`, height: '100%', background: 'var(--danger)' }} />
                  </div>
                </div>

                {/* Recipient Details Table */}
                <div style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    <table className="va-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Client</th>
                          <th>WhatsApp</th>
                          <th>Status</th>
                          <th>Sent Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {broadcastProgress.recipients?.map((r: any) => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 600 }}>{r.client?.name}</td>
                            <td className="mono">{r.whatsappNumber}</td>
                            <td>
                              <span className={`va-badge ${r.status === 'DELIVERED' ? 'paid' : r.status === 'PENDING' ? 'pending' : 'danger'}`} style={{ fontSize: 10, padding: '1px 6px' }}>
                                {r.status}
                              </span>
                              {r.errorMessage && <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>{r.errorMessage}</div>}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                              {r.lastAttemptAt ? fmtDateTime(r.lastAttemptAt) : 'Pending'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              /* --- SETUP FORM VIEW --- */
              <div style={{ display: 'flex', gap: 20, overflowY: 'auto', padding: '16px 0', flex: 1 }}>
                <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: 12, paddingRight: 8 }}>
                  <div className="va-field">
                    <label style={{ fontWeight: 600 }}>Client Selection</label>
                    <select 
                      value={broadcastFilter} 
                      onChange={e => setBroadcastFilter(e.target.value as any)}
                      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                    >
                      <option value="ALL">All Clients</option>
                      <option value="CATEGORY">Customer Category</option>
                      <option value="SELECTED">Selected Clients Only</option>
                    </select>
                  </div>

                  {broadcastFilter === 'CATEGORY' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 8, background: 'var(--line-soft)', borderRadius: 6 }}>
                      {CLIENT_TYPES.map(cat => {
                        const active = selectedCategories.includes(cat);
                        return (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => {
                              setSelectedCategories(prev => 
                                active ? prev.filter(c => c !== cat) : [...prev, cat]
                              );
                            }}
                            style={{
                              padding: '4px 10px', borderRadius: 4, border: '1px solid',
                              borderColor: active ? 'var(--forest)' : 'var(--line)',
                              background: active ? 'var(--forest)' : 'transparent',
                              color: active ? '#fff' : 'var(--ink)',
                              fontSize: 11, fontWeight: 600, cursor: 'pointer'
                            }}
                          >
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {broadcastFilter === 'SELECTED' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, border: '1px solid var(--line)', borderRadius: 6, maxHeight: '200px', overflowY: 'auto' }}>
                      <input 
                        value={broadcastSearch} 
                        onChange={e => setBroadcastSearch(e.target.value)}
                        placeholder="🔍 Search clients..."
                        style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 4, fontSize: 12, background: 'var(--paper)', color: 'var(--ink)' }}
                      />
                      {broadcastClients
                        .filter(c => c.name.toLowerCase().includes(broadcastSearch.toLowerCase()) || (c.clientId && c.clientId.toLowerCase().includes(broadcastSearch.toLowerCase())))
                        .map(c => {
                          const active = selectedClients.has(c.id);
                          return (
                            <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                              <input 
                                type="checkbox"
                                checked={active}
                                onChange={() => {
                                  const next = new Set(selectedClients);
                                  if (active) next.delete(c.id);
                                  else next.add(c.id);
                                  setSelectedClients(next);
                                }}
                              />
                              <span>{c.name} <span style={{ color: 'var(--muted)', fontSize: 10 }}>({c.clientId || 'WH-0000'})</span></span>
                            </label>
                          );
                        })}
                    </div>
                  )}

                  <div className="va-field">
                    <label style={{ fontWeight: 600 }}>Greeting Message</label>
                    <textarea 
                      value={broadcastGreeting}
                      onChange={e => setBroadcastGreeting(e.target.value)}
                      placeholder="Enter customized greetings template..."
                      rows={6}
                      style={{ width: '100%', padding: '8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', fontSize: 13 }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>Use tag `{"{{ClientName}}"}` to personalize each message dynamically.</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, background: 'var(--line-soft)', padding: 10, borderRadius: 6, fontSize: 12 }}>
                    <div>📅 Date: <strong>{fmtDate(targetDate)}</strong></div>
                    <div>🛒 Total Products: <strong>{editItems.filter(i => i.sellRate > 0).length} items</strong></div>
                  </div>
                </div>

                {/* Right Column: JPG Preview Card */}
                <div style={{ flex: 0.8, display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 8, borderLeft: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Image Rate Card Preview</span>
                  <div style={{
                    flex: 1, border: '1px dashed var(--line)', borderRadius: 8,
                    background: '#F0F0EE', display: 'flex', justifyContent: 'center', alignItems: 'center',
                    padding: 12, overflow: 'hidden'
                  }}>
                    <div style={{
                      width: '100%', maxWidth: '300px', height: '100%', maxHeight: '420px',
                      boxShadow: '0 4px 15px rgba(0,0,0,0.1)', background: '#FAFAF6',
                      overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 4,
                      display: 'flex', flexDirection: 'column', fontSize: 11
                    }}>
                      <div style={{ background: '#1F3D2B', color: '#fff', padding: 8, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 700 }}>{waSettings?.companyName || "HALAL VEGG SUPPLIES"}</div>
                        <div style={{ fontSize: 8, color: '#A3E635', fontWeight: 600, marginTop: 2 }}>Today's Fresh Fruit & Vegetable Rates</div>
                        <div style={{ fontSize: 8, color: '#E9ECEF', marginTop: 2 }}>{fmtDate(targetDate)}</div>
                      </div>
                      
                      <div style={{ padding: 8, flex: 1 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                          <thead>
                            <tr style={{ background: '#E9ECEF', borderBottom: '1px solid var(--line)' }}>
                              <th style={{ textAlign: 'left', padding: 2 }}>Product</th>
                              <th style={{ textAlign: 'right', padding: 2 }}>Unit</th>
                              <th style={{ textAlign: 'right', padding: 2 }}>Rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {editItems.filter(i => i.sellRate > 0).slice(0, 10).map((it, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 1 ? '#F3F4F6' : undefined }}>
                                <td style={{ padding: 4, fontWeight: 600 }}>
                                  <span>{it.itemName}</span>
                                  {it.product?.urduName && (
                                    <span style={{ fontSize: 10, color: '#4B5563', fontFamily: '"Jameel Khushkhat L", "Noto Nastaliq Urdu", "Noto Sans Arabic", "Urdu Typesetting", serif', marginLeft: 4 }}>
                                      ({it.product.urduName})
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: 4, textAlign: 'right', color: '#666', verticalAlign: 'middle' }}>{it.unit}</td>
                                <td style={{ padding: 4, textAlign: 'right', fontWeight: 700, color: '#1F3D2B', verticalAlign: 'middle' }}>Rs {it.sellRate}</td>
                              </tr>
                            ))}
                            {editItems.filter(i => i.sellRate > 0).length > 10 && (
                              <tr>
                                <td colSpan={3} style={{ textAlign: 'center', padding: 4, color: 'var(--muted)', fontSize: 8 }}>
                                  ... and {editItems.filter(i => i.sellRate > 0).length - 10} more items
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div style={{ background: '#1F3D2B', color: '#fff', padding: '6px 4px', textAlign: 'center', fontSize: 7 }}>
                        {waSettings?.defaultFooter || "Order via WhatsApp: +92 300 1234567 | Call: +92 300 7654321"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="va-panel-foot" style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {activeBroadcastId && broadcastProgress ? (
                <button 
                  type="button" 
                  className="va-btn secondary small" 
                  onClick={() => {
                    setShowBroadcastModal(false);
                    setActiveBroadcastId(null);
                    setBroadcastProgress(null);
                  }}
                >
                  Close
                </button>
              ) : (
                <>
                  <button 
                    type="button" 
                    className="va-btn secondary small" 
                    onClick={() => setShowBroadcastModal(false)}
                    disabled={isBroadcasting}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    className="va-btn small" 
                    style={{ background: '#25D366', color: '#fff', borderColor: '#25D366', fontWeight: 'bold' }}
                    onClick={startBroadcast}
                    disabled={isBroadcasting || editItems.filter(i => i.sellRate > 0).length === 0}
                  >
                    {isBroadcasting ? '🚀 Sending...' : 'Send'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ─── MODAL: SHARE OPTIONS SELECTION ─────────────────────── */}
      {showShareOptionsModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16
        }}>
          <div className="va-panel" style={{
            width: '100%', maxWidth: '420px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            borderRadius: 12, padding: 20
          }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 16 }}>
              <h3>📤 Share Today’s Price List</h3>
              <button 
                onClick={() => setShowShareOptionsModal(false)}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                className="va-btn"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: '#25D366', color: '#fff', borderColor: '#25D366',
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold'
                }}
                onClick={() => {
                  setShowShareOptionsModal(false);
                  setShowBroadcastModal(true);
                  if (waSettings?.defaultGreeting) {
                    setBroadcastGreeting(waSettings.defaultGreeting);
                  }
                  setActiveBroadcastId(null);
                  setBroadcastProgress(null);
                }}
              >
                <span style={{ fontSize: 20 }}>📲</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>Share via WhatsApp</span>
                  <small style={{ fontWeight: 400, opacity: 0.9, fontSize: 11 }}>Send price list directly to client chats</small>
                </div>
              </button>

              <button
                className="va-btn secondary"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold'
                }}
                onClick={() => {
                  shareWhatsAppStatus();
                }}
              >
                <span style={{ fontSize: 20 }}>📢</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>Share as WhatsApp Status</span>
                  <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>Download rate card optimized for Status upload</small>
                </div>
              </button>

              <button
                className="va-btn secondary"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
                  opacity: 0.5, cursor: 'not-allowed'
                }}
                disabled
              >
                <span style={{ fontSize: 20 }}>📧</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>Share via Newsletter</span>
                  <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>Coming Soon - Email broadcast updates</small>
                </div>
              </button>

              <button
                className="va-btn secondary"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold'
                }}
                onClick={() => {
                  downloadPriceListJpg();
                }}
              >
                <span style={{ fontSize: 20 }}>💾</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>Download JPG</span>
                  <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>Save high-quality image card locally</small>
                </div>
              </button>

              <button
                className="va-btn secondary"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold'
                }}
                onClick={() => {
                  previewPriceListImage();
                }}
              >
                <span style={{ fontSize: 20 }}>👁</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>Preview Image</span>
                  <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>View rates card preview in full resolution</small>
                </div>
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="va-btn secondary small"
                onClick={() => setShowShareOptionsModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: FULL RESOLUTION IMAGE PREVIEW ────────────────── */}
      {showPreviewModal && previewImgUrl && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 999999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16
        }}>
          <div className="va-panel" style={{
            width: '100%', maxWidth: '500px', maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)', borderRadius: 12
          }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <h3>👁 Rates Card Preview</h3>
              <button 
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewImgUrl(null);
                }}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '16px 0', background: 'var(--line-soft)' }}>
              <img 
                src={previewImgUrl} 
                alt="Rates Card Preview" 
                style={{
                  width: '100%', maxWidth: '360px', height: 'auto',
                  border: '1px solid var(--line)', borderRadius: 6,
                  boxShadow: '0 4px 15px rgba(0,0,0,0.15)'
                }}
              />
            </div>

            <div className="va-panel-foot" style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="va-btn secondary small"
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewImgUrl(null);
                }}
              >
                Close
              </button>
              <button
                className="va-btn small"
                style={{ background: '#25D366', color: '#fff', borderColor: '#25D366', fontWeight: 'bold' }}
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewImgUrl(null);
                  downloadPriceListJpg();
                }}
              >
                💾 Download
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
