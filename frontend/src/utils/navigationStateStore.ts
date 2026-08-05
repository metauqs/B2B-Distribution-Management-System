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

function persistToStorage() {
  if (typeof window === 'undefined') return;
  try {
    const obj: Record<string, any> = {};
    pageStateMap.forEach((v, k) => {
      obj[k] = v;
    });
    sessionStorage.setItem('sabzi_page_states', JSON.stringify(obj));
  } catch (e) {
    // Ignore storage quota limits
  }
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
  persistToStorage();
}

/**
 * Retrieve saved state for a page key
 */
export function getSavedPageState(pageKey: string): PageState | null {
  return pageStateMap.get(pageKey) || null;
}

/**
 * Restore window scroll position for a page key
 */
export function restoreScrollPosition(pageKey: string, delayMs: number = 60) {
  if (typeof window === 'undefined') return;
  const entry = pageStateMap.get(pageKey);
  if (entry && entry.scrollPosition > 0) {
    setTimeout(() => {
      window.scrollTo({ top: entry.scrollPosition, behavior: 'instant' as ScrollBehavior });
    }, delayMs);
  }
}
