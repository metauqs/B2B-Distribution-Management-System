import { fetchWithCache, TTL_LONG, TTL_MEDIUM, TTL_SHORT } from './cacheStore';
import { getTodayBusinessDateString } from './businessDate';

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
      const today = getTodayBusinessDateString();
      switch (pathname) {
        case '/':
          fetchWithCache(`/api/reports/dashboard?date=${today}`, { ttl: TTL_SHORT }).catch(() => {});
          break;

        case '/sales':
          fetchWithCache('/api/sales?limit=100', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/pricelist/active', { ttl: TTL_MEDIUM }).catch(() => {});
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/collections':
          fetchWithCache('/api/collections', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/clients?minimal=true', { ttl: TTL_SHORT }).catch(() => {});
          break;

        case '/clients':
          fetchWithCache('/api/clients?stats=true', { ttl: TTL_MEDIUM }).catch(() => {});
          break;

        case '/inventory':
          fetchWithCache('/api/inventory', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/purchases':
          fetchWithCache('/api/purchases', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/suppliers', { ttl: TTL_LONG }).catch(() => {});
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          fetchWithCache('/api/inventory', { ttl: TTL_SHORT }).catch(() => {});
          break;

        case '/delivery':
          fetchWithCache('/api/delivery', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/vehicles', { ttl: TTL_MEDIUM }).catch(() => {});
          fetchWithCache('/api/employees?activeOnly=true', { ttl: TTL_MEDIUM }).catch(() => {});
          break;

        case '/pricelist':
          fetchWithCache('/api/pricelist/active', { ttl: TTL_MEDIUM }).catch(() => {});
          fetchWithCache('/api/products?availability=ALL', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/expenses':
          fetchWithCache('/api/expenses', { ttl: TTL_SHORT }).catch(() => {});
          fetchWithCache('/api/expenses/summary', { ttl: TTL_SHORT }).catch(() => {});
          break;

        case '/employees':
          fetchWithCache('/api/employees', { ttl: TTL_LONG }).catch(() => {});
          break;

        case '/reports':
          fetchWithCache(`/api/reports/executive-dashboard?preset=today&from=${today}&to=${today}`, { ttl: TTL_SHORT }).catch(() => {});
          break;

        case '/settings':
          fetchWithCache('/api/settings/users', { ttl: TTL_LONG }).catch(() => {});
          fetchWithCache('/api/products', { ttl: TTL_LONG }).catch(() => {});
          fetchWithCache('/api/broadcasts/settings', { ttl: TTL_LONG }).catch(() => {});
          break;
      }
    } catch {
      // Non-blocking prefetch guard
    }
  }, 150);
}

