let activeRefreshPromise: Promise<string | null> | null = null;

async function performSingleFlightTokenRefresh(): Promise<string | null> {
  if (activeRefreshPromise) return activeRefreshPromise;

  activeRefreshPromise = (async () => {
    try {
      const refreshToken = typeof window !== 'undefined' ? localStorage.getItem('sabzi_refresh_token') : null;
      if (!refreshToken) return null;

      const refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      const refreshData = await refreshRes.json();
      if (refreshRes.ok && refreshData.success && refreshData.accessToken) {
        localStorage.setItem('sabzi_token', refreshData.accessToken);
        if (refreshData.refreshToken) {
          localStorage.setItem('sabzi_refresh_token', refreshData.refreshToken);
        }
        return refreshData.accessToken as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Utility wrapper around fetch that automatically handles:
 * 1. Attaching JWT Authorization Bearer headers
 * 2. Silent token refresh with single-flight lock when access token expires (401 status)
 * 3. Timeout handling to prevent hanging requests
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sabzi_token') : null;

  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const method = (init?.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (!headers.has('Idempotency-Key') && !headers.has('idempotency-key')) {
      const key = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      headers.set('Idempotency-Key', key);
    }
  }

  // Setup abort controller for timeout handling (45 seconds default timeout for multi-item transactions)
  const timeoutMs = 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const requestInit: RequestInit = {
    ...init,
    headers,
    signal: init?.signal || controller.signal,
  };

  try {
    let response = await fetch(input, requestInit);
    clearTimeout(timeoutId);

    // If request failed due to expired access token (401), attempt single-flight silent token refresh
    if (response.status === 401 && typeof window !== 'undefined') {
      const newAccessToken = await performSingleFlightTokenRefresh();
      if (newAccessToken) {
        // Retry original failed request with new access token
        headers.set('Authorization', `Bearer ${newAccessToken}`);
        response = await fetch(input, { ...requestInit, headers });
      }
    }

    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Server connection timed out. Please try again.');
    }
    throw error;
  }
}
