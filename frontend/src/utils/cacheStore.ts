import { apiFetch } from './apiFetch';

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cacheMap = new Map<string, CacheEntry>();
const inFlightMap = new Map<string, Promise<any>>();

// Standard Freshness Time-To-Live (TTL) in milliseconds
export const TTL_SHORT = 15000;    // 15 sec: Financial/inventory data
export const TTL_MEDIUM = 30000;   // 30 sec: Lists (clients, sales, purchases)
export const TTL_LONG = 300000;    // 5 min: Master data (products, employees, settings)

/**
 * Retrieves cached data synchronously if available.
 */
export function getCachedData<T = any>(key: string): T | null {
  const entry = cacheMap.get(key);
  if (!entry) return null;
  return entry.data as T;
}

/**
 * Checks whether the cache for key is still within its TTL freshness window.
 */
export function isCacheFresh(key: string, ttl: number = TTL_MEDIUM): boolean {
  const entry = cacheMap.get(key);
  if (!entry) return false;
  return Date.now() - entry.timestamp < ttl;
}

/**
 * Manually updates the cache for a key.
 */
export function setCachedData(key: string, data: any): void {
  cacheMap.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalidates (clears) cache entries matching a string or RegExp pattern.
 */
export function invalidateCache(pattern?: string | RegExp): void {
  if (!pattern) {
    cacheMap.clear();
    return;
  }
  for (const key of cacheMap.keys()) {
    if (typeof pattern === 'string') {
      if (key.includes(pattern)) {
        cacheMap.delete(key);
      }
    } else if (pattern.test(key)) {
      cacheMap.delete(key);
    }
  }
}

/**
 * Fetches JSON data from relative API path with automatic deduplication,
 * in-memory caching, and silent background revalidation.
 */
export async function fetchWithCache<T = any>(
  key: string,
  options?: {
    ttl?: number;
    forceRefresh?: boolean;
    init?: RequestInit;
  }
): Promise<T> {
  const ttl = options?.ttl ?? TTL_MEDIUM;
  const cachedEntry = cacheMap.get(key);

  // 1. If fresh cache exists and forceRefresh is false, return immediately
  if (!options?.forceRefresh && cachedEntry && Date.now() - cachedEntry.timestamp < ttl) {
    return cachedEntry.data as T;
  }

  // 2. If in-flight request exists for the same key, reuse it to prevent duplicate requests
  if (inFlightMap.has(key)) {
    return inFlightMap.get(key)!;
  }

  // 3. Otherwise perform network request via apiFetch
  const requestPromise = (async () => {
    try {
      const res = await apiFetch(key, options?.init);
      const data = await res.json();
      if (res.ok && data.success) {
        setCachedData(key, data.data ?? data);
        return (data.data ?? data) as T;
      }
      throw new Error(data.error ?? 'Request failed');
    } finally {
      inFlightMap.delete(key);
    }
  })();

  inFlightMap.set(key, requestPromise);

  // 4. If stale cache exists, return stale cache immediately while background request finishes
  if (cachedEntry && !options?.forceRefresh) {
    // Fire-and-forget background update
    requestPromise.catch(() => {});
    return cachedEntry.data as T;
  }

  return requestPromise;
}
