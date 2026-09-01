/**
 * Global Navigation State Store for HalalVeggSupplies ERP
 * Manages page state persistence, scroll position restoration,
 * and seamless module transitions across navigation and browser back/forward.
 */

interface PageState {
  state: Record<string, any>;
  scrollPosition: number;
  updatedAt: number;
}

const pageStateMap = new Map<string, PageState>();

// Hydrate from sessionStorage on startup
if (typeof window !== 'undefined') {
  try {
    const saved = sessionStorage.getItem('sabzi_page_states');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.entries(parsed).forEach(([k, v]) => {
        pageStateMap.set(k, v as PageState);
      });
    }
  } catch (e) {
    console.error('Failed to load page states from sessionStorage', e);
  }
}

let persistTimer: any = null;

export function persistToStorage(immediate = false) {
  if (typeof window === 'undefined') return;

  const doPersist = () => {
    try {
      const obj: Record<string, any> = {};
      pageStateMap.forEach((v, k) => {
        obj[k] = v;
      });
      sessionStorage.setItem('sabzi_page_states', JSON.stringify(obj));
    } catch {
      // Ignore storage quota limits
    }
  };

  if (immediate) {
    if (persistTimer) clearTimeout(persistTimer);
    doPersist();
    return;
  }

  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      (window as any).requestIdleCallback(doPersist);
    } else {
      doPersist();
    }
  }, 2000);
}

// Flush immediately before page unloads or visibility changes to hidden
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => persistToStorage(true), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistToStorage(true);
  }, { passive: true });
}

/**
 * Save state and scroll position for a page key
 */
export function savePageState(pageKey: string, state: Record<string, any>, scrollPosition?: number) {
  const existing = pageStateMap.get(pageKey);
  const currentScroll = scrollPosition !== undefined ? scrollPosition : (typeof window !== 'undefined' ? window.scrollY : 0);
  pageStateMap.set(pageKey, {
    state: { ...(existing?.state || {}), ...state },
    scrollPosition: currentScroll,
    updatedAt: Date.now(),
  });
  persistToStorage(false);
}

/**
 * Retrieve saved state for a page key
 */
export function getSavedPageState(pageKey: string): PageState | null {
  return pageStateMap.get(pageKey) || null;
}

/**
 * Restore window scroll position for a page key with smooth, non-blocking frame scheduling
 */
export function restoreScrollPosition(pageKey: string, delayMs: number = 60) {
  if (typeof window === 'undefined') return;
  const entry = pageStateMap.get(pageKey);
  if (entry && entry.scrollPosition > 0) {
    setTimeout(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: entry.scrollPosition, behavior: 'instant' as ScrollBehavior });
      });
    }, delayMs);
  }
}
