import React, { useState, useEffect, useRef } from 'react';
import { ProductVisual } from './ProductVisual';
import { fetchWithCache, getCachedData, TTL_MEDIUM, TTL_LONG } from '@/utils/cacheStore';

export interface PriceItem {
  productId: string;
  itemName: string;
  unit: string;
  sellRate?: number;
  buyRate?: number;
  product?: { id: string; name: string; urduName?: string | null; emoji?: string | null; imageUrl?: string | null; category?: string };
}

interface ProductAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onSelect: (item: any) => void;
  priceItems?: any[];
  products?: any[];
  items?: any[];
  placeholder?: string;
  required?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function ProductAutocomplete({
  value,
  onChange,
  onSelect,
  priceItems,
  products,
  items,
  placeholder = "Product name",
  required = false,
  style,
  className = "",
}: ProductAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [fallbackList, setFallbackList] = useState<any[]>(() => {
    const cachedActive = getCachedData<any>('/api/pricelist/active');
    const items = cachedActive?.data?.items || cachedActive?.items;
    if (items && items.length > 0) return items;
    const cachedProducts = getCachedData<any[]>('/api/products');
    return Array.isArray(cachedProducts) ? cachedProducts : [];
  });
  const [loading, setLoading] = useState(false);

  // Normalize source list with fallback
  const rawList: any[] = (items && items.length > 0)
    ? items
    : (priceItems && priceItems.length > 0)
    ? priceItems
    : (products && products.length > 0)
    ? products
    : fallbackList;

  // Auto-fetch active product/price list if passed list is empty (deduplicated & cached)
  useEffect(() => {
    if (rawList.length === 0 && !loading) {
      let isMounted = true;
      setLoading(true);
      (async () => {
        try {
          const data = await fetchWithCache<any>('/api/pricelist/active', { ttl: TTL_MEDIUM });
          const fetched = data?.data?.items || data?.items || [];
          if (isMounted && fetched.length > 0) {
            setFallbackList(fetched);
          } else {
            const prodData = await fetchWithCache<any>('/api/products', { ttl: TTL_LONG });
            const pList = prodData?.data || (Array.isArray(prodData) ? prodData : []);
            if (isMounted && pList.length > 0) {
              setFallbackList(pList);
            }
          }
        } catch (e) {
          console.error('ProductAutocomplete fallback fetch failed:', e);
        } finally {
          if (isMounted) setLoading(false);
        }
      })();
      return () => { isMounted = false; };
    }
  }, [rawList.length, loading]);

  const q = value.trim().toLowerCase();

  // Helper to extract searchable names and details
  const getSearchFields = (p: any) => {
    const itemName = (p?.itemName || p?.name || '').toString();
    const prodName = (p?.product?.name || '').toString();
    const urdu = (p?.product?.urduName || p?.urduName || '').toString();
    const emoji = p?.product?.emoji || p?.emoji || null;
    const imageUrl = p?.product?.imageUrl || p?.imageUrl || null;
    const unit = p?.unit || p?.defaultUnit || 'KG';
    const rate = p?.sellRate ?? p?.rate ?? p?.buyRate ?? 0;
    const productId = p?.productId || p?.id || '';
    const availableStock = p?.availableStock ?? p?.currentStock ?? p?.stock ?? p?.qty ?? undefined;
    return { itemName, prodName, urdu, emoji, imageUrl, unit, rate, productId, availableStock };
  };

  // 1. Prefix matches (itemName, product name, or urduName starts with query)
  const prefixMatches = rawList.filter((p) => {
    if (!q) return true;
    const { itemName, prodName, urdu } = getSearchFields(p);
    const nameLower = itemName.toLowerCase();
    const prodLower = prodName.toLowerCase();
    const urduLower = urdu.toLowerCase();
    return nameLower.startsWith(q) || prodLower.startsWith(q) || urduLower.startsWith(q);
  });

  // 2. Contains matches (includes query but doesn't start with query)
  const containsMatches = rawList.filter((p) => {
    if (!q) return false;
    const { itemName, prodName, urdu } = getSearchFields(p);
    const nameLower = itemName.toLowerCase();
    const prodLower = prodName.toLowerCase();
    const urduLower = urdu.toLowerCase();
    const starts = nameLower.startsWith(q) || prodLower.startsWith(q) || urduLower.startsWith(q);
    const contains = nameLower.includes(q) || prodLower.includes(q) || urduLower.includes(q);
    return !starts && contains;
  });

  // Combine results so prefix matches appear on top
  const suggestions = q ? [...prefixMatches, ...containsMatches] : rawList;

  // Reset highlighted index when query or items change
  useEffect(() => {
    setHighlightedIndex(suggestions.length > 0 ? 0 : -1);
  }, [value, rawList.length]);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (isOpen && listRef.current && highlightedIndex >= 0) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl && typeof activeEl.scrollIntoView === 'function') {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = (item: any) => {
    onSelect(item);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(0);
      } else if (suggestions.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setHighlightedIndex(suggestions.length - 1);
      } else if (suggestions.length > 0) {
        setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      if (isOpen && suggestions.length > 0) {
        e.preventDefault();
        const targetIndex = highlightedIndex >= 0 && highlightedIndex < suggestions.length ? highlightedIndex : 0;
        handleSelect(suggestions[targetIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    } else if (e.key === 'Tab') {
      if (isOpen && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        handleSelect(suggestions[highlightedIndex]);
      } else {
        setIsOpen(false);
      }
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        style={{
          width: '100%',
          padding: '6px 10px',
          border: '1px solid var(--line)',
          borderRadius: 6,
          fontSize: 13,
          background: 'var(--paper)',
          color: 'var(--ink)',
          ...style,
        }}
        className={className}
        autoComplete="off"
      />

      {isOpen && (
        <div
          ref={listRef}
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 9999,
            background: '#FFFFFF',
            border: '1px solid #CBD5E1',
            borderRadius: 8,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            maxHeight: 220,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {suggestions.length > 0 ? (
            suggestions.map((item, index) => {
              const isHighlighted = index === highlightedIndex;
              const { itemName, urdu, emoji, imageUrl, unit, rate, productId, availableStock } = getSearchFields(item);
              return (
                <div
                  key={productId || `${itemName}-${index}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(item);
                  }}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    handleSelect(item);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: isHighlighted ? '#F1F5F9' : 'transparent',
                    borderLeft: isHighlighted ? '3px solid #1F3D2B' : '3px solid transparent',
                    fontSize: 13,
                    lineHeight: '1.4',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ProductVisual name={itemName} emoji={emoji} imageUrl={imageUrl} size={22} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>{itemName}</span>
                      {urdu && (
                        <span style={{ fontSize: 11, color: '#64748B' }}>
                          {urdu}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', whiteSpace: 'nowrap' }}>
                    <div>
                      {rate > 0 && (
                        <span className="mono" style={{ fontWeight: 700, color: '#166534', marginRight: 3 }}>
                          Rs {rate.toLocaleString()}
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: '#64748B' }}>
                        / {unit}
                      </span>
                    </div>
                    {availableStock !== undefined && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        marginTop: 2,
                        background: availableStock > 0 ? '#E6F4EA' : '#FCE8E6',
                        color: availableStock > 0 ? '#137333' : '#C5221F',
                      }}>
                        {availableStock > 0 ? `Stock: ${availableStock} ${unit}` : 'Out of Stock'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '12px 16px', fontSize: 13, color: '#64748B', textAlign: 'center', fontWeight: 500 }}>
              {loading ? '⏳ Loading products...' : q ? `No products matching "${value}"` : 'No products available in catalog'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
