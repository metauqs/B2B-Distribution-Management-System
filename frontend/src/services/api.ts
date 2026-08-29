import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

// ─── Axios Instance ───────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '/api',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with every request (httpOnly JWT)
});

// ─── Request Interceptor ──────────────────────────────────────────────────────

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Prevent double /api/api if baseURL is already /api and endpoint starts with /api
    if (config.url?.startsWith('/api/')) {
      config.url = config.url.replace(/^\/api/, '');
    } else if (config.url === '/api') {
      config.url = '';
    }

    const method = (config.method || '').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (!config.headers['Idempotency-Key'] && !config.headers['idempotency-key']) {
        const key = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        config.headers['Idempotency-Key'] = key;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor ─────────────────────────────────────────────────────

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    // 401 → Redirect to login
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }

    // Normalize error message
    const data = error.response?.data as { error?: string; message?: string } | undefined;
    const message = data?.error ?? data?.message ?? error.message ?? 'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

export default api;
