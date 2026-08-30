import type { User, LoginCredentials } from '@/types/auth';

// ─── Auth Service (cookie-based) ──────────────────────────────────────────────

export const authService = {
  async login(credentials: LoginCredentials): Promise<User> {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(credentials),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error ?? 'Login failed');
    return data.data.user as User;
  },

  async logout(): Promise<void> {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sabzi_user');
      localStorage.removeItem('sabzi_token');
      localStorage.removeItem('sabzi_refresh_token');
      sessionStorage.clear();
      document.cookie = 'sabzi_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
      document.cookie = 'sabzi_refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Backend logout failed:', err);
    }
  },

  async getMe(): Promise<User> {
    const res  = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error('Not authenticated');
    return data.data as User;
  },
};
