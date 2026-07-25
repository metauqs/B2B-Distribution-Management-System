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
    await fetch('/api/auth/logout', { method: 'POST' });
  },

  async getMe(): Promise<User> {
    const res  = await fetch('/api/auth/me');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error('Not authenticated');
    return data.data as User;
  },
};
