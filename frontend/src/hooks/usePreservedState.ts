'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { savePageState, getSavedPageState, restoreScrollPosition } from '@/utils/navigationStateStore';

export function usePreservedState<T extends Record<string, any>>(pageKey: string, initialState: T) {
  const [state, setStateState] = useState<T>(() => {
    let urlView: string | null = null;
    let urlTab: string | null = null;

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      urlView = params.get('view');
      urlTab = params.get('tab');
    }

    const saved = getSavedPageState(pageKey);
    const base = saved && saved.state ? { ...initialState, ...saved.state } : { ...initialState };

    // Ensure transient sub-views like 'detail' without explicit URL or ID don't get stuck
    if (!urlView && (base as any).view === 'detail' && !(base as any).detailSaleId && !(base as any).profId) {
      (base as any).view = (initialState as any).view || 'list';
    }

    if (urlView && 'view' in base) (base as any).view = urlView;
    if (urlTab && 'tab' in base) (base as any).tab = urlTab;

    return base;
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const setPreservedState = useCallback((updater: Partial<T> | ((prev: T) => T)) => {
    setStateState(prev => {
      const next = typeof updater === 'function' ? (updater as any)(prev) : { ...prev, ...updater };
      const prevView = (prev as any).view;
      const nextView = (next as any).view;
      const prevTab = (prev as any).tab;
      const nextTab = (next as any).tab;

      stateRef.current = next;
      const scrollPos = typeof window !== 'undefined' ? window.scrollY : 0;
      savePageState(pageKey, next, scrollPos);

      // Push history state entry when changing sub-view or tab for trackpad back-swipe & browser back support
      if (typeof window !== 'undefined') {
        const viewChanged = nextView !== undefined && nextView !== prevView;
        const tabChanged = nextTab !== undefined && nextTab !== prevTab;

        if (viewChanged || tabChanged) {
          const url = new URL(window.location.href);
          if (nextView && nextView !== 'list' && nextView !== 'overview') {
            url.searchParams.set('view', String(nextView));
          } else {
            url.searchParams.delete('view');
          }

          if (nextTab && nextTab !== 'overview' && nextTab !== 'sales') {
            url.searchParams.set('tab', String(nextTab));
          } else {
            url.searchParams.delete('tab');
          }

          window.history.pushState({ pageKey, state: next }, '', url.toString());
        }
      }

      return next;
    });
  }, [pageKey]);

  // Handle popstate for browser back/forward and trackpad back swipe
  useEffect(() => {
    restoreScrollPosition(pageKey, 60);

    const handlePopState = (event: PopStateEvent) => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const urlView = params.get('view');
      const urlTab = params.get('tab');

      setStateState(prev => {
        const next = { ...prev } as any;
        if ('view' in next) {
          next.view = (urlView || (initialState as any).view || 'list');
        }
        if ('tab' in next) {
          next.tab = (urlTab || (initialState as any).tab || 'overview');
        }
        stateRef.current = next;
        savePageState(pageKey, next, window.scrollY);
        return next;
      });

      restoreScrollPosition(pageKey, 60);
    };

    window.addEventListener('popstate', handlePopState);

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
      window.removeEventListener('popstate', handlePopState);
      clearTimeout(scrollTimeout);
      if (typeof window !== 'undefined') {
        savePageState(pageKey, stateRef.current, window.scrollY);
      }
      window.removeEventListener('scroll', handleScroll);
    };
  }, [pageKey, (initialState as any).view, (initialState as any).tab]);

  return [state, setPreservedState] as const;
}
