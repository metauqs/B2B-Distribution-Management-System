import { fetchWithCache, TTL_LONG, TTL_MEDIUM } from './cacheStore';

let prefetchTimer: NodeJS.Timeout | null = null;

/**
 * Intelligently prefetches safe read-only datasets for a destination ERP page
 * on link hover or touch before the user clicks, enabling 0ms instant data display.
 * Debounced to prevent query storms on rapid cursor movement across menu items.
 */
export function prefetchPageData(pathname: string): void {
  if (prefetchTimer) clearTimeout(prefetchTimer);

  prefetchTimer = setTimeout(() => {
    try {
      switch (pathname) {
        case '/sales':
        case '/pricelist':
          fetchWithCache('/api/pricelist/active', { ttl: TTL_MEDIUM }).catch(() => {});
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/clients':
        case '/collections':
          fetchWithCache('/api/clients?minimal=true', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/inventory':
        case '/purchases':
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/settings':
          fetchWithCache('/api/broadcasts/settings', { ttl: TTL_LONG }).catch(() => {});
          break;
      }
    } catch {
      // Non-blocking prefetch guard
    }
  }, 250);
}
