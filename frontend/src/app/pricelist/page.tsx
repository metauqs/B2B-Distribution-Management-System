'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useCallback, useRef } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { fmtMoney, fmtDate, fmtDateTime, todayInputDate, compressProductImage } from '@/utils/formatters';
import { fmtBusinessDate } from '@/utils/businessDate';
import { loadBrandConfig, loadBrandConfigWithLogo, generatePriceListHTML, openPrintWindow, writeAndPrint, generateTemplateImageBase64, generateTemplateJpgBase64, downloadImage, shareDocumentAsImageOnWhatsApp } from '@/utils/documentTemplates';
import { MobileCard, MobileCardRow } from '@/components/ui/MobileCard';
import { apiFetch } from '@/utils/apiFetch';
import { fetchWithCache, getCachedData, invalidateCache, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { usePreservedState } from '@/hooks/usePreservedState';
import { useIdempotentSubmit } from '@/hooks/useIdempotentSubmit';
import Icon from '@mdi/react';
import { mdiFormatListNumbered } from '@mdi/js';
import { ProductVisual } from '@/components/ui/ProductVisual';
import { useAccess } from '@/hooks/useAccess';

const WhatsAppShareModal = dynamic(() => import('@/components/modals/WhatsAppShareModal').then(m => m.WhatsAppShareModal), { ssr: false });

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
  emoji?:       string | null;
  imageUrl?:    string | null;
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
  avgBuyCost?: number;
  latestPurchasePrice?: number;
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
    emoji?:        string | null;
    imageUrl?:     string | null;
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
  latest: { sellRate: number; buyRate: number; marginPct: number; date: string; sellChange?: number | null; buyChange?: number | null; } | null;
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

function ChangeChip({ val }: { val?: number | null }) {
  if (val === undefined || val === null || val === 0) return <span style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>;
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
  const [plState, setPlState] = usePreservedState('pricelist', {
    tab: 'today' as 'today' | 'history' | 'lists' | 'catalog',
    search: '',
  });

  const tab = plState.tab;
  const setTab = (t: any) => setPlState({ tab: t });

  // WhatsApp Broadcast States
  const [showShareOptionsModal, setShowShareOptionsModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewImgUrl, setPreviewImgUrl] = useState<string | null>(null);
  const [waShareModal, setWaShareModal] = useState<{ jpgBase64: string; whatsappUrl: string; filename: string; displayPhone?: string } | null>(null);
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
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  // Access permissions
  const { isAdmin, isSupervisor } = useAccess();
  const canEditCatalog = isAdmin || isSupervisor;

  // Master Catalog State
  const [products, setProducts] = useState<Product[]>([]);
  const [newProdName, setNewProdName] = useState('');
  const [newProdUrdu, setNewProdUrdu] = useState('');
  const [newProdEmoji, setNewProdEmoji] = useState('');
  const [newProdCat, setNewProdCat] = useState('vegetable');
  const [newProdUnit, setNewProdUnit] = useState('KG');
  const [newProdAvail, setNewProdAvail] = useState<ProductAvailability>(ProductAvailability.AVAILABLE);
  const [newProdImageBase64, setNewProdImageBase64] = useState<string | null>(null);
  const [newProdImagePreview, setNewProdImagePreview] = useState('');

  // Edit Product Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrdu, setEditUrdu] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editImagePreview, setEditImagePreview] = useState('');
  const [editImageBase64, setEditImageBase64] = useState<string | null>(null);
  const [editImageRemoved, setEditImageRemoved] = useState(false);
  const [editCategory, setEditCategory] = useState('vegetable');
  const [editUnit, setEditUnit] = useState('KG');
  const [editAvailability, setEditAvailability] = useState<ProductAvailability>(ProductAvailability.AVAILABLE);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Audit Log Modal State
  const [auditProduct, setAuditProduct] = useState<Product | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

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

  const loadProducts = useCallback(async (forceRefresh = false) => {
    try {
      const data = await fetchWithCache<Product[]>('/api/products?availability=ALL', { ttl: TTL_LONG, forceRefresh });
      if (data) setProducts(data);
    } catch (err) {
      console.error('loadProducts error:', err);
    }
  }, []);

  const loadDateList = useCallback(async (date: string, isBackground = false) => {
    const key = `/api/pricelist?date=${date}`;
    if (!isBackground && !getCachedData(key)) setLoading(true);
    try {
      const data = await fetchWithCache<any>(key, { ttl: TTL_MEDIUM, forceRefresh: isBackground });
      if (data) {
        const listData = data?.data && !Array.isArray(data.data) ? data.data : data;
        setCurrentList(listData);
        setIsDraft(!!(data.isDraft ?? listData?.isDraft));
        const items = listData?.items ?? (Array.isArray(listData) ? listData : []);
        if (!isEditing) {
          setEditItems(items.map((i: PriceItemRow) => ({
            ...i,
            origBuyRate: i.buyRate,
            origSellRate: i.sellRate,
          })));
        }
        setListNotes(listData?.notes ?? '');
      }
    } catch (err) {
      console.error('loadDateList error:', err);
    } finally {
      setLoading(false);
    }
  }, [isEditing]);

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

  // ─── WhatsApp Image Broadcast Actions & Deterministic Cache ──────────────────
  const BROADCAST_IMG_CACHE = useRef<Map<string, { base64: string; imageUrl?: string }>>(new Map());
  
  const generateBroadcastImageBase64 = async (): Promise<string | null> => {
    try {
      const items = editItems.filter(i => i.sellRate > 0);
      if (items.length === 0) return null;

      const dateStr = fmtBusinessDate(targetDate) || fmtDate(targetDate);
      const versionKey = `${dateStr}_${items.map(it => `${it.productId || it.itemName}:${it.sellRate}:${it.unit}`).join('|')}_${listNotes || ''}`;
      
      const cached = BROADCAST_IMG_CACHE.current.get(versionKey);
      if (cached?.base64) {
        return cached.base64;
      }

      const brand = await loadBrandConfigWithLogo();
      const html = generatePriceListHTML(
        {
          dateStr,
          items: items.map(it => {
            const master = products.find(p => p.id === it.productId || p.name.toLowerCase() === it.itemName.toLowerCase());
            return {
              itemName: it.itemName,
              unit:     it.unit,
              sellRate: it.sellRate,
              urduName: it.product?.urduName || master?.urduName || (it as any).urduName || '',
              category: it.product?.category || master?.category,
              imageUrl: it.product?.imageUrl || master?.imageUrl || (it as any).imageUrl || null,
              emoji:    it.product?.emoji || master?.emoji || (it as any).emoji || null,
              productId: it.productId || master?.id || null,
            };
          }),
          notes: listNotes || undefined,
        },
        brand,
        window.location.origin,
      );
      const base64 = await generateTemplateJpgBase64(html);
      if (base64) {
        BROADCAST_IMG_CACHE.current.set(versionKey, { base64 });
      }
      return base64;
    } catch (err) {
      console.error('generateBroadcastImageBase64 error:', err);
      return null;
    }
  };

  const startBroadcast = async () => {
    setIsBroadcasting(true);
    try {
      const items = editItems.filter(i => i.sellRate > 0);
      const dateStr = fmtBusinessDate(targetDate) || fmtDate(targetDate);
      const versionKey = `${dateStr}_${items.map(it => `${it.productId || it.itemName}:${it.sellRate}:${it.unit}`).join('|')}_${listNotes || ''}`;

      let uploadedImageUrl = BROADCAST_IMG_CACHE.current.get(versionKey)?.imageUrl;

      if (!uploadedImageUrl) {
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
        uploadedImageUrl = uploadData.imageUrl;
        const entry = BROADCAST_IMG_CACHE.current.get(versionKey);
        if (entry) {
          entry.imageUrl = uploadedImageUrl;
        }
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
          imageUrl: uploadedImageUrl
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

  const openWhatsAppDownloadModal = async (filenamePrefix = 'PriceList') => {
    if (isGeneratingImage) return;
    setIsGeneratingImage(true);
    showToast('⏳ Generating Price List image...');
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Unable to generate Price List image.');
        return;
      }
      setShowShareOptionsModal(false);
      setShowPreviewModal(false);
      const res = await shareDocumentAsImageOnWhatsApp(
        {
          jpgBase64: base64Img,
          filename: `${filenamePrefix}_${targetDate}.jpg`,
          phone: '',
        },
        (msg) => { if (msg) showToast(msg); }
      );
      if (res.method === 'modal' && res.jpgBase64) {
        setWaShareModal({
          jpgBase64: res.jpgBase64,
          whatsappUrl: res.whatsappUrl || 'https://wa.me/',
          filename: `${filenamePrefix}_${targetDate}.jpg`,
          displayPhone: 'WhatsApp',
        });
      }
    } catch (err: any) {
      showToast('❌ Unable to prepare WhatsApp share image.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const downloadPriceListJpg = async () => {
    if (isGeneratingImage) return;
    setIsGeneratingImage(true);
    showToast('⏳ Generating Price List image...');
    try {
      const base64Img = await generateBroadcastImageBase64();
      if (!base64Img) {
        showToast('❌ Unable to generate Price List image.');
        return;
      }
      setShowShareOptionsModal(false);
      setShowPreviewModal(false);
      await downloadImage(base64Img, `PriceList_${targetDate}.jpg`, showToast);
    } catch (err: any) {
      showToast('❌ Download failed.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const shareWhatsAppStatus = async () => {
    await openWhatsAppDownloadModal('PriceList_Status');
  };

  const previewPriceListImage = async () => {
    if (isGeneratingImage) return;
    setIsGeneratingImage(true);
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
    } finally {
      setIsGeneratingImage(false);
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

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>, isNew: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast('❌ Only PNG, JPG, and WEBP image formats are supported');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      showToast('❌ Image size exceeds 15MB limit');
      return;
    }

    try {
      // Automatically compress and resize to max 600px (retina quality ~40KB)
      const compressedDataUrl = await compressProductImage(file, 600, 0.88);
      if (isNew) {
        setNewProdImagePreview(compressedDataUrl);
        setNewProdImageBase64(compressedDataUrl);
      } else {
        setEditImagePreview(compressedDataUrl);
        setEditImageBase64(compressedDataUrl);
        setEditImageRemoved(false);
      }
    } catch {
      showToast('❌ Failed to process image file');
    }
  };

  const handleRemoveImage = (isNew: boolean = false) => {
    if (isNew) {
      setNewProdImagePreview('');
      setNewProdImageBase64(null);
    } else {
      setEditImagePreview('');
      setEditImageBase64(null);
      setEditImageUrl('');
      setEditImageRemoved(true);
    }
  };

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
          emoji: newProdEmoji,
          category: newProdCat,
          defaultUnit: newProdUnit,
          availability: newProdAvail
        })
      });
      const data = await res.json();
      if (data.success) {
        if (newProdImageBase64 && data.data?.id) {
          try {
            await apiFetch(`/api/products/${data.data.id}/image`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: newProdImageBase64 })
            });
          } catch (err) {
            console.error('Failed to upload image for new product:', err);
          }
        }
        invalidateCache('/api/products');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/inventory');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ ${newProdName} added to master catalog`);
        setNewProdName('');
        setNewProdUrdu('');
        setNewProdEmoji('');
        setNewProdImagePreview('');
        setNewProdImageBase64(null);
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
        window.dispatchEvent(new Event('app-revalidate'));
        showToast('✅ Status updated');
        await loadProducts(true);
        await loadDateList(targetDate, true);
      }
    } catch {
      showToast('❌ Failed to update status');
    }
  };

  const handleOpenEditProduct = (p: Product) => {
    setEditingProduct(p);
    setEditName(p.name || '');
    setEditUrdu(p.urduName || '');
    setEditEmoji(p.emoji || '');
    setEditImageUrl(p.imageUrl || '');
    setEditImagePreview(p.imageUrl || '');
    setEditImageBase64(null);
    setEditImageRemoved(false);
    setEditCategory((p.category || 'vegetable').toLowerCase());
    setEditUnit(p.defaultUnit || 'KG');
    setEditAvailability(p.availability || ProductAvailability.AVAILABLE);
    setEditError('');
  };

  const handleSaveEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    if (!editName.trim()) {
      setEditError('Product name cannot be empty');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      // 1. Upload or delete image if modified
      let finalImageUrl: string | null = editImageUrl;
      if (editImageBase64) {
        const uploadRes = await apiFetch(`/api/products/${editingProduct.id}/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: editImageBase64 })
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          let errJson;
          try { errJson = JSON.parse(errText); } catch { /* ignore */ }
          throw new Error(errJson?.error || `Image upload failed (HTTP ${uploadRes.status}): ${errText.slice(0, 80)}`);
        }
        const uploadData = await uploadRes.json();
        if (uploadData.success && uploadData.imageUrl) {
          finalImageUrl = uploadData.imageUrl;
        }
      } else if (editImageRemoved) {
        await apiFetch(`/api/products/${editingProduct.id}/image`, {
          method: 'DELETE'
        });
        finalImageUrl = null;
      }

      // 2. Update core product fields
      const res = await apiFetch(`/api/products/${editingProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          urduName: editUrdu,
          emoji: editEmoji,
          imageUrl: finalImageUrl,
          category: editCategory,
          defaultUnit: editUnit,
          availability: editAvailability,
        })
      });
      const data = await res.json();
      if (data.success) {
        invalidateCache('/api/products');
        invalidateCache('/api/pricelist');
        invalidateCache('/api/inventory');
        window.dispatchEvent(new Event('app-revalidate'));
        showToast(`✅ Updated "${editName.trim()}" successfully`);
        setEditingProduct(null);
        await loadProducts(true);
        await loadDateList(targetDate, true);
      } else {
        setEditError(data.error || 'Failed to update product');
      }
    } catch (err: any) {
      setEditError(err.message || 'Error updating product');
    } finally {
      setEditSaving(false);
    }
  };

  const handleOpenAuditLog = async (p: Product) => {
    setAuditProduct(p);
    setLoadingAudit(true);
    setAuditLogs([]);
    try {
      const res = await apiFetch(`/api/products/${p.id}/audit-logs`);
      const data = await res.json();
      if (data.success) {
        setAuditLogs(data.data || []);
      } else {
        showToast('❌ Failed to fetch audit logs');
      }
    } catch (err: any) {
      console.error('Audit log fetch error:', err);
      showToast('❌ Failed to fetch audit logs');
    } finally {
      setLoadingAudit(false);
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
    await executeSavePriceList();
  };

  const { isSubmitting: isSubmittingPriceList, submit: executeSavePriceList } = useIdempotentSubmit({
    onSubmit: async (_: any, idempotencyKey: string) => {
      const res = await apiFetch('/api/pricelist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
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
        if (res.status === 409 && currentList?.id) {
          const updateRes = await apiFetch(`/api/pricelist/${currentList.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
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
    },
    onError: () => {
      showToast('❌ Network error saving price list');
    },
    getFingerprint: () => `${targetDate}-${listNotes}-${(editItems || []).map(i => `${i.productId}:${i.buyRate}:${i.sellRate}`).join(',')}`,
  });

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

  // ─── Print Price List ───────────────────────────────────────────────────────
  const printPriceList = async () => {
    const items = editItems.filter(i => i.sellRate > 0);
    if (items.length === 0) return showToast('No rates to export');
    // Open window synchronously first — avoids browser popup blocker
    const w = openPrintWindow();
    if (!w) { showToast('❌ Popup blocked — please allow popups for this site'); return; }
    const brand = await loadBrandConfigWithLogo();
    const dateStr = fmtBusinessDate(targetDate) || fmtDate(targetDate);
    const html = generatePriceListHTML(
      {
        dateStr,
        items: items.map(it => {
          const master = products.find(p => p.id === it.productId || p.name.toLowerCase() === it.itemName.toLowerCase());
          return {
            itemName: it.itemName,
            unit:     it.unit,
            sellRate: it.sellRate,
            urduName: it.product?.urduName || master?.urduName || (it as any).urduName || '',
            category: it.product?.category || master?.category,
            imageUrl: it.product?.imageUrl || master?.imageUrl || (it as any).imageUrl || null,
            emoji:    it.product?.emoji || master?.emoji || (it as any).emoji || null,
            productId: it.productId || master?.id || null,
          };
        }),
        notes: listNotes || undefined,
      },
      brand,
      window.location.origin,
    );
    writeAndPrint(w, html, `Daily Price List — ${dateStr}`);
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
            <button className="va-btn secondary small" onClick={printPriceList}>🖨️ Print Price List</button>
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
                        <th style={{ textAlign: 'right', width: 120, color: 'var(--primary)', fontWeight: 700 }}>Stock</th>
                        <th style={{ textAlign: 'right', width: 150, color: 'var(--forest)', fontWeight: 700 }}>Avg Buy Cost (Inventory)</th>
                        <th style={{ textAlign: 'right', width: 140, fontWeight: 700 }}>Sell Rate (Customer)</th>
                        <th style={{ textAlign: 'right', width: 110 }}>Profit Margin</th>
                        <th style={{ minWidth: 110 }}>Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEditItems.length === 0 ? (
                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '30px', color: 'var(--muted)' }}>No products in active master catalog</td></tr>
                      ) : (
                        filteredEditItems.map((item, idx) => {
                          const realIndex = editItems.indexOf(item);
                    const buyRate = (item.avgBuyCost && item.avgBuyCost > 0)
                      ? item.avgBuyCost
                      : ((item as any).currentBuyPrice && (item as any).currentBuyPrice > 0)
                        ? (item as any).currentBuyPrice
                        : (item.buyRate ?? 0);
                          const availStock = item.availableStock ?? item.currentStock ?? 0;
                          const margin = item.sellRate - buyRate;
                          const marginPct = (buyRate > 0) ? (margin / buyRate) * 100 : 0;
                          const sellChanged = item.origSellRate !== undefined && item.sellRate !== item.origSellRate;

                          return (
                            <tr key={idx} style={{ background: sellChanged ? '#FFFBE6' : undefined }}>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <ProductVisual
                                    name={item.itemName}
                                    emoji={(item.product as any)?.emoji}
                                    imageUrl={(item.product as any)?.imageUrl}
                                    size={24}
                                  />
                                  <div>
                                    <strong>{item.itemName}</strong>
                                    {item.product?.urduName && (
                                      <span style={{ color: 'var(--muted)', fontSize: 14, marginLeft: 6, fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', direction: 'rtl', unicodeBidi: 'isolate' }}>
                                        ({item.product.urduName})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td style={{ color: 'var(--muted)' }}>{item.unit}</td>
                              <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{item.product?.category}</td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: availStock > 0 ? 'var(--primary)' : 'var(--danger)' }}>
                                {availStock.toFixed(2)} {item.unit}
                              </td>
                              <td className="mono" style={{ textAlign: 'right', fontWeight: 800, color: 'var(--forest)' }}>
                                {buyRate > 0 ? (
                                  <div>
                                    <span style={{ fontSize: 13, fontWeight: 800 }}>Rs {buyRate.toFixed(2)}</span>
                                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>
                                      Inventory Avg
                                    </div>
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--muted)' }}>—</span>
                                )}
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
                    const buyRate = (item.avgBuyCost && item.avgBuyCost > 0)
                      ? item.avgBuyCost
                      : ((item as any).currentBuyPrice && (item as any).currentBuyPrice > 0)
                        ? (item as any).currentBuyPrice
                        : (item.buyRate ?? 0);
                    const margin = item.sellRate - buyRate;
                    const marginPct = buyRate > 0 ? (margin / buyRate) * 100 : 0;
                    const sellChanged = item.origSellRate !== undefined && item.sellRate !== item.origSellRate;

                    return (
                      <MobileCard
                        key={idx}
                        title={item.itemName}
                        headerBadge={item.product?.urduName || item.unit}
                        style={{
                          background: sellChanged ? '#FFFDE6' : '#FFFFFF',
                        }}
                      >
                        <MobileCardRow label="Unit / Category" value={`${item.unit} · ${item.product?.category || 'General'}`} />
                        <MobileCardRow label="Avg Buy Cost (Inventory)">
                          <span style={{ fontWeight: 800, color: 'var(--forest)' }}>
                            {buyRate > 0 ? `Rs ${buyRate.toFixed(2)}` : '—'}
                          </span>
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
          <div className="va-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h3>Price Trend Analysis &amp; Historical Margins</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>History range:</span>
                <select
                  value={historyDays}
                  onChange={e => setHistoryDays(Number(e.target.value))}
                  style={{ padding: '4px 8px', border: '1px solid var(--line)', borderRadius: 6, background: 'var(--paper)', color: 'var(--ink)', fontSize: 12 }}
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={14}>Last 14 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
              </div>
            </div>
          </div>

          <div className="va-panel">
            {loading && filteredHistory.length === 0 ? (
              <div style={{ padding: 16 }}><SkeletonTable rows={8} cols={6} /></div>
            ) : (
              <>
                {/* Desktop View */}
                <div className="hide-mobile">
                  <div style={{ overflowX: 'auto' }}>
                    <table className="va-table">
                      <thead>
                        <tr>
                          <th>Product Name</th>
                          <th>Category</th>
                          <th style={{ textAlign: 'right' }}>Latest Buy Rate</th>
                          <th style={{ textAlign: 'right' }}>Latest Sell Rate</th>
                          <th style={{ textAlign: 'right' }}>Current Margin</th>
                          <th>Margin %</th>
                          <th>Sell Change</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.length === 0 ? (
                          <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No historical rate data found for selected filter</td></tr>
                        ) : (
                          filteredHistory.map((h, idx) => (
                            <>
                              <tr key={idx} style={{ cursor: 'pointer' }} onClick={() => setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName)}>
                                <td>
                                  <strong>{h.itemName}</strong>
                                  {h.product?.urduName && <span style={{ color: 'var(--muted)', fontSize: 14, marginLeft: 6, fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', direction: 'rtl', unicodeBidi: 'isolate' }}>({h.product.urduName})</span>}
                                </td>
                                <td style={{ textTransform: 'capitalize', fontSize: 12 }}>{h.product?.category || '—'}</td>
                                <td className="mono" style={{ textAlign: 'right' }}>
                                  {h.latest ? `Rs ${h.latest.buyRate}` : '—'}
                                </td>
                                <td className="mono" style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                  {h.latest ? `Rs ${h.latest.sellRate}` : '—'}
                                </td>
                                <td className="mono" style={{ textAlign: 'right' }}>
                                  {h.latest ? `Rs ${(h.latest.sellRate - h.latest.buyRate).toFixed(0)}` : '—'}
                                </td>
                                <td>
                                  {h.latest ? <MarginBar pct={h.latest.marginPct} /> : '—'}
                                </td>
                                <td>
                                  {h.latest ? <ChangeChip val={h.latest.sellChange} /> : '—'}
                                </td>
                                <td>
                                  <button
                                    className="va-btn secondary small"
                                    onClick={e => {
                                      e.stopPropagation();
                                      setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName);
                                    }}
                                  >
                                    {expandedProduct === h.itemName ? '▲ Hide Log' : `▼ View (${h.history.length})`}
                                  </button>
                                </td>
                              </tr>

                              {expandedProduct === h.itemName && (
                                <tr key={`${idx}-sub`} style={{ background: '#F8F9FA' }}>
                                  <td colSpan={8} style={{ padding: '12px 24px' }}>
                                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--primary)' }}>
                                      📜 Complete Price Change History for {h.itemName} ({h.history.length} snapshots)
                                    </div>
                                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                                      <thead>
                                        <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--muted)', textAlign: 'left' }}>
                                          <th style={{ padding: '4px 8px' }}>Date</th>
                                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>Buy Rate</th>
                                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>Sell Rate</th>
                                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>Margin</th>
                                          <th style={{ padding: '4px 8px' }}>Margin %</th>
                                          <th style={{ padding: '4px 8px' }}>Sell Change</th>
                                          <th style={{ padding: '4px 8px' }}>Buy Change</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {h.history.map((entry, eIdx) => (
                                          <tr key={eIdx} style={{ borderBottom: '1px solid #EAEAEA' }}>
                                            <td style={{ padding: '4px 8px', fontWeight: 600 }}>{fmtDate(entry.date)}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right' }} className="mono">Rs {entry.buyRate}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700 }} className="mono">Rs {entry.sellRate}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'right' }} className="mono">Rs {entry.margin.toFixed(0)}</td>
                                            <td style={{ padding: '4px 8px' }}><MarginBar pct={entry.marginPct} /></td>
                                            <td style={{ padding: '4px 8px' }}><ChangeChip val={entry.sellChange} /></td>
                                            <td style={{ padding: '4px 8px' }}><ChangeChip val={entry.buyChange} /></td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile View */}
                <div className="show-mobile" style={{ display: 'none', flexDirection: 'column', gap: '14px', width: '100%' }}>
                  {filteredHistory.map((h, idx) => (
                    <div key={idx} className="va-mobile-card">
                      <div className="card-header" onClick={() => setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName)} style={{ cursor: 'pointer' }}>
                        <span className="card-title" style={{ color: '#FFFFFF' }}>{h.itemName}</span>
                        {h.product?.urduName && <span className="card-subtitle text-emerald-100" style={{ fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', fontSize: 14, direction: 'rtl', unicodeBidi: 'isolate' }}>{h.product.urduName}</span>}
                      </div>

                      <div className="card-divider" />

                      <div className="flex flex-col gap-2.5">
                        <div className="card-info-row">
                          <span className="card-label">Category</span>
                          <span className="card-value text-capitalize">{h.product?.category || 'General'}</span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Latest Rates</span>
                          <span className="card-value font-mono">Buy: Rs {h.latest?.buyRate ?? 0} | Sell: Rs {h.latest?.sellRate ?? 0}</span>
                        </div>
                        <div className="card-info-row">
                          <span className="card-label">Margin</span>
                          <span className="card-value font-mono">Rs {((h.latest?.sellRate ?? 0) - (h.latest?.buyRate ?? 0)).toFixed(0)} ({h.latest?.marginPct.toFixed(0)}%)</span>
                        </div>
                      </div>

                      <div className="card-divider" />

                      <button
                        onClick={() => setExpandedProduct(expandedProduct === h.itemName ? null : h.itemName)}
                        className="card-btn"
                        style={{ width: '100%' }}
                      >
                        {expandedProduct === h.itemName ? 'Hide Log' : `View Change Log (${h.history.length})`}
                      </button>

                      {expandedProduct === h.itemName && (
                        <>
                          <div className="card-divider" />
                          <div className="flex flex-col gap-3" style={{ background: 'rgba(0,0,0,0.15)', padding: '12px', borderRadius: '8px' }}>
                            {h.history.map((entry, eIdx) => (
                              <div key={eIdx} className="flex flex-col gap-1.5" style={{ borderBottom: eIdx < h.history.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none', paddingBottom: eIdx < h.history.length - 1 ? '10px' : '0' }}>
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
              {/* Live Visual Preview Box for New Product */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', background: 'var(--line-soft)',
                borderRadius: 8, marginBottom: 12, border: '1px solid var(--line)'
              }}>
                <div style={{
                  width: 50, height: 50, borderRadius: 8,
                  background: '#FFFFFF', border: '1px solid var(--line)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden', flexShrink: 0
                }}>
                  <ProductVisual name={newProdName} emoji={newProdEmoji} imageUrl={newProdImagePreview} size={38} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                    Visual Icon / Image
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    <label
                      className="va-btn secondary small"
                      style={{ cursor: 'pointer', padding: '2px 8px', fontSize: 11, margin: 0 }}
                    >
                      📁 {newProdImagePreview ? 'Replace' : 'Upload Image'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        style={{ display: 'none' }}
                        onChange={e => handleImageFileChange(e, true)}
                      />
                    </label>
                    {newProdImagePreview && (
                      <button
                        type="button"
                        className="va-btn secondary small"
                        style={{ padding: '2px 8px', fontSize: 11, color: 'var(--danger)' }}
                        onClick={() => handleRemoveImage(true)}
                      >
                        🗑️ Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Product Name (English) *</label>
                <input required value={newProdName} onChange={e => setNewProdName(e.target.value)} placeholder="e.g. Avocado" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Urdu Name (Optional)</label>
                <input value={newProdUrdu} onChange={e => setNewProdUrdu(e.target.value)} placeholder="e.g. ایوکاڈو" style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', direction: 'rtl' }} />
              </div>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label>Product Emoji / Icon (Optional)</label>
                <input value={newProdEmoji} onChange={e => setNewProdEmoji(e.target.value)} placeholder="e.g. 🥑" style={{ background: 'var(--paper)', color: 'var(--ink)' }} />
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
            <div className="va-panel-head"><h3>📋 Permanent Catalog</h3></div>
            {/* Desktop view */}
            <div className="hide-mobile">
              <div style={{ overflowX: 'auto' }}>
                <table className="va-table">
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>Icon</th>
                      <th>Product ID</th>
                      <th>English Name</th>
                      <th>Urdu Name</th>
                      <th>Category</th>
                      <th>Unit</th>
                      <th>Availability Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalog.map(p => (
                      <tr key={p.id}>
                        <td style={{ textAlign: 'center' }}>
                          <ProductVisual name={p.name} emoji={p.emoji} imageUrl={p.imageUrl} size={24} />
                        </td>
                        <td>
                          <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)' }}>{p.id}</span>
                        </td>
                        <td>
                          <strong>{p.name}</strong>
                        </td>
                        <td>
                          {p.urduName ? (
                            <span style={{ fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', fontSize: 14, direction: 'rtl', unicodeBidi: 'isolate' }}>
                              {p.urduName}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                          )}
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
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="va-btn secondary small"
                              style={{ padding: '3px 8px', fontSize: 12 }}
                              onClick={() => handleOpenEditProduct(p)}
                            >
                              ✏️ Edit
                            </button>
                            <button
                              className="va-btn secondary small"
                              style={{ padding: '3px 8px', fontSize: 12 }}
                              onClick={() => handleOpenAuditLog(p)}
                            >
                              📜 Audit Log
                            </button>
                          </div>
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
                  <div className="card-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ProductVisual name={p.name} emoji={p.emoji} imageUrl={p.imageUrl} size={28} />
                    <div>
                      <span className="card-title" style={{ color: '#FFFFFF' }}>{p.name}</span>
                      {p.urduName && (
                        <span className="card-subtitle text-emerald-100" style={{ display: 'block', fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', fontSize: 14, direction: 'rtl', unicodeBidi: 'isolate' }}>
                          {p.urduName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="card-divider" />

                  <div className="flex flex-col gap-2.5">
                    <div className="card-info-row">
                      <span className="card-label">Product ID</span>
                      <span className="card-value font-mono text-xs text-emerald-100">{p.id}</span>
                    </div>
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

                  <div className="card-divider" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      onClick={() => handleOpenEditProduct(p)}
                      className="card-btn"
                      style={{ padding: '6px' }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleOpenAuditLog(p)}
                      className="card-btn secondary"
                      style={{ padding: '6px' }}
                    >
                      📜 Audit Log
                    </button>
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
                                    <span style={{ fontSize: 12, color: '#4B5563', fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', marginLeft: 4, direction: 'rtl', unicodeBidi: 'isolate' }}>
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
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
                  opacity: isGeneratingImage ? 0.5 : 1, cursor: isGeneratingImage ? 'not-allowed' : 'pointer',
                }}
                disabled={isGeneratingImage}
                onClick={() => {
                  shareWhatsAppStatus();
                }}
              >
                <span style={{ fontSize: 20 }}>📢</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>{isGeneratingImage ? '⏳ Generating...' : 'Share as WhatsApp Status'}</span>
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
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
                  opacity: isGeneratingImage ? 0.5 : 1, cursor: isGeneratingImage ? 'not-allowed' : 'pointer',
                }}
                disabled={isGeneratingImage}
                onClick={() => {
                  downloadPriceListJpg();
                }}
              >
                <span style={{ fontSize: 20 }}>💾</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>{isGeneratingImage ? '⏳ Generating...' : 'Download JPG'}</span>
                  <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>Save high-quality image card locally</small>
                </div>
              </button>

              <button
                className="va-btn secondary"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left', padding: '12px 16px', borderRadius: 8, fontSize: 14, fontWeight: 'bold',
                  opacity: isGeneratingImage ? 0.5 : 1, cursor: isGeneratingImage ? 'not-allowed' : 'pointer',
                }}
                disabled={isGeneratingImage}
                onClick={() => {
                  previewPriceListImage();
                }}
              >
                <span style={{ fontSize: 20 }}>👁</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span>{isGeneratingImage ? '⏳ Generating...' : 'Preview Image'}</span>
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
                style={{ background: '#25D366', color: '#fff', borderColor: '#25D366', fontWeight: 'bold', opacity: isGeneratingImage ? 0.5 : 1, cursor: isGeneratingImage ? 'not-allowed' : 'pointer' }}
                disabled={isGeneratingImage}
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewImgUrl(null);
                  downloadPriceListJpg();
                }}
              >
                {isGeneratingImage ? '⏳ Generating...' : '💾 Download'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── MODAL: EDIT PRODUCT DETAILS ───────────────────────── */}
      {editingProduct && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16
        }}>
          <div className="va-panel" style={{
            width: '100%', maxWidth: '480px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)', borderRadius: 12, padding: 20
          }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>✏️ Edit Product Details</h3>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  Product ID: {editingProduct.id} (Identity Preserved)
                </span>
              </div>
              <button 
                onClick={() => setEditingProduct(null)}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            {editError && (
              <div style={{ padding: '8px 12px', background: '#FCE8E6', color: '#C5221F', borderRadius: 6, fontSize: 12, marginBottom: 12, fontWeight: 600 }}>
                ⚠️ {editError}
              </div>
            )}

            {/* Visual Icon & Image Management Box */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 14px', background: 'var(--line-soft)',
              borderRadius: 8, marginBottom: 16, border: '1px solid var(--line)'
            }}>
              <div style={{
                width: 58, height: 58, borderRadius: 8,
                background: '#FFFFFF', border: '1px solid var(--line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
              }}>
                <ProductVisual name={editName} emoji={editEmoji} imageUrl={editImagePreview || editImageUrl} size={44} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                  Product Visual Asset
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  Priority: Uploaded Image &gt; Emoji &gt; Default Icon
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <label
                    className="va-btn secondary small"
                    style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 11, margin: 0 }}
                  >
                    📁 {editImagePreview || editImageUrl ? 'Replace Image' : 'Upload Image'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      style={{ display: 'none' }}
                      onChange={e => handleImageFileChange(e, false)}
                    />
                  </label>
                  {(editImagePreview || editImageUrl) && (
                    <button
                      type="button"
                      className="va-btn secondary small"
                      style={{ padding: '3px 8px', fontSize: 11, color: 'var(--danger)' }}
                      onClick={() => handleRemoveImage(false)}
                    >
                      🗑️ Remove Image
                    </button>
                  )}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveEditProduct}>
              <div className="va-field" style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600 }}>English Product Name *</label>
                <input
                  required
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="e.g. Fresh Potato"
                  style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                />
              </div>

              <div className="va-field" style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600 }}>Urdu Product Name (Optional)</label>
                <input
                  value={editUrdu}
                  onChange={e => setEditUrdu(e.target.value)}
                  placeholder="e.g. تازہ آلو"
                  style={{ background: 'var(--paper)', color: 'var(--ink)', fontFamily: 'var(--font-urdu, "Jameel", "Jameel Noori Nastaleeq", "Jameel Khushkhat L", serif)', direction: 'rtl' }}
                />
              </div>

              <div className="va-field" style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600 }}>Product Emoji / Icon (Optional)</label>
                <input
                  value={editEmoji}
                  onChange={e => setEditEmoji(e.target.value)}
                  placeholder="e.g. 🥔"
                  style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                />
              </div>

              <div className="va-field" style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600 }}>Category *</label>
                <select
                  value={editCategory}
                  onChange={e => setEditCategory(e.target.value)}
                  style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="va-field" style={{ marginBottom: 12 }}>
                <label style={{ fontWeight: 600 }}>Default Unit *</label>
                <select
                  value={editUnit}
                  onChange={e => setEditUnit(e.target.value)}
                  style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                >
                  {UNITS.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </div>

              <div className="va-field" style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600 }}>Availability Status *</label>
                <select
                  value={editAvailability}
                  onChange={e => setEditAvailability(e.target.value as ProductAvailability)}
                  style={{ background: 'var(--paper)', color: 'var(--ink)' }}
                >
                  <option value={ProductAvailability.AVAILABLE}>Available</option>
                  <option value={ProductAvailability.SEASONAL}>Seasonal</option>
                  <option value={ProductAvailability.INACTIVE}>Inactive</option>
                </select>
              </div>

              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="va-btn secondary small"
                  onClick={() => setEditingProduct(null)}
                  disabled={editSaving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="va-btn small"
                  disabled={editSaving || !editName.trim()}
                >
                  {editSaving ? 'Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: AUDIT LOG HISTORY ───────────────────────────── */}
      {auditProduct && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 99999,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          padding: 16
        }}>
          <div className="va-panel" style={{
            width: '100%', maxWidth: '650px', maxHeight: '85vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)', borderRadius: 12, padding: 20
          }}>
            <div className="va-panel-head" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>📜 Audit Log History: {auditProduct.name}</h3>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  Product ID: {auditProduct.id}
                </span>
              </div>
              <button 
                onClick={() => setAuditProduct(null)}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 18, color: 'var(--muted)' }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {loadingAudit ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>Loading audit history...</div>
              ) : auditLogs.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                  No name update logs recorded for this product yet.
                </div>
              ) : (
                auditLogs.map((log, idx) => {
                  const oldData = log.oldData || {};
                  const newData = log.newData || {};
                  return (
                    <div key={log.id || idx} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, background: 'var(--paper)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
                        <div>
                          👤 <strong>{log.user?.name || 'Admin/Supervisor'}</strong>
                          {log.user?.role && <span style={{ color: 'var(--muted)', marginLeft: 4 }}>({log.user.role})</span>}
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: 11 }}>
                          📅 {fmtDateTime(log.createdAt)}
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12, background: 'var(--line-soft)', padding: 8, borderRadius: 6 }}>
                        <div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', fontWeight: 700 }}>Previous Details</div>
                          <div>Name: <strong>{oldData.name || '—'}</strong></div>
                          {oldData.urduName && <div>Urdu: {oldData.urduName}</div>}
                          {oldData.emoji && <div>Emoji: {oldData.emoji}</div>}
                          {oldData.category && <div>Cat: {oldData.category}</div>}
                        </div>

                        <div>
                          <div style={{ fontSize: 10, color: 'var(--ok)', textTransform: 'uppercase', fontWeight: 700 }}>Updated Details</div>
                          <div>Name: <strong style={{ color: 'var(--ok)' }}>{newData.name || '—'}</strong></div>
                          {newData.urduName && <div>Urdu: {newData.urduName}</div>}
                          {newData.emoji && <div>Emoji: {newData.emoji}</div>}
                          {newData.category && <div>Cat: {newData.category}</div>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--line)', marginTop: 16, paddingTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="va-btn secondary small"
                onClick={() => setAuditProduct(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
    </DashboardLayout>
  );
}
