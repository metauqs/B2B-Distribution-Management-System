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
 * Retries a function with exponential backoff for transient issues.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
  backoffFactor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) {
      throw error;
    }
    const errText = error.message || '';
    const isTransient =
      errText.includes('OFFLINE') ||
      errText.includes('TIMEOUT') ||
      errText.includes('SERVER_SLEEPING') ||
      errText.includes('HTTP_502') ||
      errText.includes('HTTP_503') ||
      errText.includes('HTTP_504') ||
      errText.includes('Failed to fetch');

    if (!isTransient) {
      throw error;
    }

    console.warn(`🔄 Transient request failure: "${errText}". Retrying in ${delayMs}ms... (${retries} attempts left)`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return retryWithBackoff(fn, retries - 1, delayMs * backoffFactor, backoffFactor);
  }
}

/**
 * Fetches JSON data from relative API path with automatic deduplication,
 * in-memory caching, transient retry backoff, and background revalidation.
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

  // 3. Otherwise perform network request via apiFetch wrapped in backoff retry
  const requestPromise = (async () => {
    try {
      return await retryWithBackoff(async () => {
        let res;
        try {
          res = await apiFetch(key, options?.init);
        } catch (err: any) {
          if (err.name === 'AbortError' || err.message?.includes('timed out')) {
            throw new Error('TIMEOUT: The server took too long to respond. Please try again.');
          }
          throw new Error('OFFLINE: Unable to connect to the server. Check your internet connection.');
        }

        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('UNAUTHORIZED: Your session has expired. Please log in again.');
          }
          if (res.status === 403) {
            throw new Error('FORBIDDEN: You do not have permission to access this page.');
          }
          if (res.status === 502 || res.status === 503 || res.status === 504) {
            throw new Error('SERVER_SLEEPING: The server is starting up or temporarily unavailable (502/503).');
          }
          if (res.status === 500) {
            throw new Error('SERVER_ERROR: Internal server error (500). Please contact support.');
          }
          throw new Error(`HTTP_${res.status}: Server returned status code ${res.status}.`);
        }

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error('PARSE_ERROR: Invalid server response format.');
        }

        if (data && (data.success !== false)) {
          const payloadToCache = data.data !== undefined ? data.data : data;
          setCachedData(key, payloadToCache);
          return payloadToCache as T;
        }
        throw new Error(data?.error ?? 'Request failed');
      });
    } finally {
      inFlightMap.delete(key);
    }
  })();

  inFlightMap.set(key, requestPromise);

  // 4. If stale cache exists, return stale cache immediately while background request finishes
  if (cachedEntry && !options?.forceRefresh) {
    requestPromise.catch(() => {});
    return cachedEntry.data as T;
  }

  return requestPromise;
}
