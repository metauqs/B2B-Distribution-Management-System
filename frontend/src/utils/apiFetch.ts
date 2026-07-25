/**
 * Utility wrapper around fetch that automatically handles:
 * 1. Attaching JWT Authorization Bearer headers
 * 2. Silent token refresh when access token expires (401 status)
 * 3. Fallback to direct backend URL (http://127.0.0.1:3001) if proxy network error occurs
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sabzi_token') : null;

  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch {
    // If relative proxy fetch throws a network exception, fallback directly to backend on 127.0.0.1:3001
    const urlStr = typeof input === 'string' ? input : input.toString();
    const fallbackUrl = urlStr.startsWith('/') ? `http://127.0.0.1:3001${urlStr}` : urlStr;
    response = await fetch(fallbackUrl, { ...init, headers });
  }

  // If request failed due to expired access token (401), attempt silent token refresh
  if (response.status === 401 && typeof window !== 'undefined') {
    const refreshToken = localStorage.getItem('sabzi_refresh_token');
    if (refreshToken) {
      try {
        let refreshRes: Response;
        try {
          refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
        } catch {
          refreshRes = await fetch('http://127.0.0.1:3001/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });
        }

        const refreshData = await refreshRes.json();
        if (refreshRes.ok && refreshData.success && refreshData.accessToken) {
          localStorage.setItem('sabzi_token', refreshData.accessToken);
          if (refreshData.refreshToken) {
            localStorage.setItem('sabzi_refresh_token', refreshData.refreshToken);
          }

          // Retry original failed request with new access token
          headers.set('Authorization', `Bearer ${refreshData.accessToken}`);
          try {
            response = await fetch(input, { ...init, headers });
          } catch {
            const urlStr = typeof input === 'string' ? input : input.toString();
            const fallbackUrl = urlStr.startsWith('/') ? `http://127.0.0.1:3001${urlStr}` : urlStr;
            response = await fetch(fallbackUrl, { ...init, headers });
          }
        }
      } catch {
        // Silent catch
      }
    }
  }

  return response;
}
