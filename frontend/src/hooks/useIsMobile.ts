'use client';

import { useState, useEffect } from 'react';

/**
 * High-performance, zero-overhead mobile media query match hook.
 * Uses passive MediaQueryList listener to match viewport <= 768px.
 * Enables single-tree mounting (mobile cards on mobile, desktop table on desktop)
 * to cut mobile DOM node count and React reconciliation work by ~50%.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);

    setIsMobile(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler, { passive: true } as any);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      (mediaQuery as any).addListener(handler);
      return () => (mediaQuery as any).removeListener(handler);
    }
  }, [breakpoint]);

  return isMobile;
}
