'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface PriceItem {
  productId: string;
  itemName: string;
  unit: string;
  sellRate: number;
  product?: { id: string; name: string; urduName?: string | null; category: string };
}

interface ProductAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onSelect: (item: PriceItem) => void;
  priceItems: PriceItem[];
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

  // Compute matching products
  const q = value.trim().toLowerCase();

  // 1. Prefix matches (itemName, product name, or urduName starts with query)
  const prefixMatches = priceItems.filter((p) => {
    if (!q) return true;
    const name = p.itemName.toLowerCase();
    const prodName = p.product?.name.toLowerCase() ?? '';
    const urdu = p.product?.urduName?.toLowerCase() ?? '';
    return name.startsWith(q) || prodName.startsWith(q) || urdu.startsWith(q);
  });

  // 2. Contains matches (includes query but doesn't start with query)
  const containsMatches = priceItems.filter((p) => {
    if (!q) return false;
    const name = p.itemName.toLowerCase();
    const prodName = p.product?.name.toLowerCase() ?? '';
    const urdu = p.product?.urduName?.toLowerCase() ?? '';
    const starts = name.startsWith(q) || prodName.startsWith(q) || urdu.startsWith(q);
    const contains = name.includes(q) || prodName.includes(q) || urdu.includes(q);
    return !starts && contains;
  });

  // Combine results so prefix matches appear on top
  const suggestions = q ? [...prefixMatches, ...containsMatches] : priceItems;

  // Reset highlighted index when query or priceItems change
  useEffect(() => {
    setHighlightedIndex(suggestions.length > 0 ? 0 : -1);
  }, [value, priceItems.length]);

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

  const handleSelect = (item: PriceItem) => {
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
              return (
                <div
                  key={item.productId || `${item.itemName}-${index}`}
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
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{item.itemName}</span>
                    {item.product?.urduName && (
                      <span style={{ fontSize: 11, color: '#64748B' }}>
                        {item.product.urduName}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span className="mono" style={{ fontWeight: 700, color: '#166534' }}>
                      Rs {item.sellRate?.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B', marginLeft: 3 }}>
                      / {item.unit}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ padding: '12px 16px', fontSize: 13, color: '#64748B', textAlign: 'center', fontWeight: 500 }}>
              No matching products found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
