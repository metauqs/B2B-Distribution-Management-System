/**
 * Utility wrapper around fetch that automatically handles JWT authorization headers
 * and performs silent token refresh when an access token expires (401 status).
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('sabzi_token') : null;

  const headers = new Headers(init?.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response = await fetch(input, { ...init, headers });

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
          response = await fetch(input, { ...init, headers });
        } else {
          // Token refresh failed or revoked - clear tokens and redirect to login
          localStorage.removeItem('sabzi_token');
          localStorage.removeItem('sabzi_refresh_token');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      } catch {
        // Network error during refresh
      }
    }
  }

  return response;
}
