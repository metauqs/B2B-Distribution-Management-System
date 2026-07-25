'use client';

import { useCallback, useEffect, useState } from 'react';

const cache = new Map<string, { data: unknown; ts: number }>();

interface UseCachedFetchOptions {
  staleTime?: number;
  enabled?: boolean;
}

export function useCachedFetch<T>(
  url: string,
  options: UseCachedFetchOptions = {}
) {
  const { staleTime = 30_000, enabled = true } = options;
  const cached = cache.get(url);
  const hasCachedData = cached != null;

  const [data, setData] = useState<T | null>(
    hasCachedData ? (cached.data as T) : null
  );
  const [isLoading, setIsLoading] = useState(!hasCachedData);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (force = false) => {
      const entry = cache.get(url);
      const isFresh = entry && Date.now() - entry.ts < staleTime;

      if (!force && isFresh) {
        setData(entry.data as T);
        setIsLoading(false);
        return;
      }

      if (!entry) {
        setIsLoading(true);
      }

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Request failed');
        const json = await res.json();
        const result = json.data as T;
        cache.set(url, { data: result, ts: Date.now() });
        setData(result);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong');
      } finally {
        setIsLoading(false);
      }
    },
    [url, staleTime]
  );

  useEffect(() => {
    if (enabled) {
      fetchData();
    }
  }, [enabled, fetchData]);

  return {
    data,
    isLoading: isLoading && data == null,
    isRefreshing: isLoading && data != null,
    error,
    refetch: () => fetchData(true),
  };
}

export function invalidateCache(urlPrefix?: string) {
  if (!urlPrefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(urlPrefix)) {
      cache.delete(key);
    }
  }
}
