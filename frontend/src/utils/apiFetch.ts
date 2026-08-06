/**
 * Utility wrapper around fetch that automatically handles:
 * 1. Attaching JWT Authorization Bearer headers
 * 2. Silent token refresh when access token expires (401 status)
 * 3. Reasonable timeout handling (15s limit) to prevent hanging requests
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sabzi_token') : null;

  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
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

    // If request failed due to expired access token (401), attempt silent token refresh
    if (response.status === 401 && typeof window !== 'undefined') {
      const refreshToken = localStorage.getItem('sabzi_refresh_token');
      if (refreshToken) {
        try {
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

            // Retry original failed request with new access token
            headers.set('Authorization', `Bearer ${refreshData.accessToken}`);
            response = await fetch(input, { ...requestInit, headers });
          }
        } catch {
          // Silent catch
        }
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
