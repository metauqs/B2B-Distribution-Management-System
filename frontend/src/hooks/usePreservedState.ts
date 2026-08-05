'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { savePageState, getSavedPageState, restoreScrollPosition } from '@/utils/navigationStateStore';

export function usePreservedState<T extends Record<string, any>>(pageKey: string, initialState: T) {
  const [state, setStateState] = useState<T>(() => {
    const saved = getSavedPageState(pageKey);
    if (saved && saved.state) {
      return { ...initialState, ...saved.state };
    }
    return initialState;
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const setPreservedState = useCallback((updater: Partial<T> | ((prev: T) => T)) => {
    setStateState(prev => {
      const next = typeof updater === 'function' ? (updater as any)(prev) : { ...prev, ...updater };
      stateRef.current = next;
      const scrollPos = typeof window !== 'undefined' ? window.scrollY : 0;
      savePageState(pageKey, next, scrollPos);
      return next;
    });
  }, [pageKey]);

  // Restore scroll position on mount & auto-save on scroll / navigation
  useEffect(() => {
    restoreScrollPosition(pageKey, 60);

    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (typeof window !== 'undefined') {
          savePageState(pageKey, stateRef.current, window.scrollY);
        }
      }, 100);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      clearTimeout(scrollTimeout);
      if (typeof window !== 'undefined') {
        savePageState(pageKey, stateRef.current, window.scrollY);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, [pageKey]);

  return [state, setPreservedState] as const;
}
