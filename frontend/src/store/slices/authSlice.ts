import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { AuthState, LoginCredentials, User } from '@/types/auth';
import { apiFetch } from '@/utils/apiFetch';

const loadCachedUser = (): User | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('sabzi_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const setCachedUser = (user: User | null) => {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem('sabzi_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('sabzi_user');
    }
  } catch (err) {
    console.warn('Failed to update sabzi_user in localStorage', err);
  }
};

// ─── Login via fetch ──────────────────────────────────────────────────────────

export const login = createAsyncThunk<User, LoginCredentials>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return rejectWithValue(data.error ?? 'Login failed');

      if (typeof window !== 'undefined') {
        if (data.accessToken) {
          localStorage.setItem('sabzi_token', data.accessToken);
          document.cookie = `sabzi_token=${data.accessToken}; path=/; max-age=604800; SameSite=Lax`;
        }
        if (data.refreshToken) {
          localStorage.setItem('sabzi_refresh_token', data.refreshToken);
          document.cookie = `sabzi_refresh_token=${data.refreshToken}; path=/; max-age=2592000; SameSite=Lax`;
        }
      }

      const user = (data.data?.user ?? data.user) as User;
      setCachedUser(user);
      return user;
    } catch {
      return rejectWithValue('Network error');
    }
  }
);

export const logout = createAsyncThunk('auth/logout', async () => {
  setCachedUser(null);
  lastFetchTime = 0;
  inFlightFetch = null;
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
});

let lastFetchTime = 0;
let inFlightFetch: Promise<any> | null = null;
const FETCH_THROTTLE_MS = 60000; // 60s throttle

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (force: boolean | undefined, { rejectWithValue }) => {
    const hasToken = typeof window !== 'undefined'
      ? (localStorage.getItem('sabzi_token') || document.cookie.includes('sabzi_token='))
      : false;

    if (!hasToken) {
      setCachedUser(null);
      return rejectWithValue('No session');
    }

    const cached = loadCachedUser();
    const now = Date.now();

    if (!force && cached && (now - lastFetchTime) < FETCH_THROTTLE_MS) {
      return cached;
    }

    if (inFlightFetch) {
      return inFlightFetch;
    }

    inFlightFetch = (async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        const data = await res.json();
        if (!res.ok || !data.success) {
          setCachedUser(null);
          if (typeof window !== 'undefined') {
            localStorage.removeItem('sabzi_user');
            localStorage.removeItem('sabzi_token');
            localStorage.removeItem('sabzi_refresh_token');
            document.cookie = 'sabzi_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
            document.cookie = 'sabzi_refresh_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
          }
          return rejectWithValue('Session expired or invalid');
        }
        const user = (data.data ?? data.user) as User;
        setCachedUser(user);
        lastFetchTime = Date.now();
        return user;
      } catch {
        const existing = loadCachedUser();
        if (existing) return existing;
        setCachedUser(null);
        return rejectWithValue('Network connection failure');
      } finally {
        inFlightFetch = null;
      }
    })();

    return inFlightFetch;
  }
);

// ─── Initial State (Hydrates from cache for instant 0ms load, validates silently in background) ───

const initialCachedUser = loadCachedUser();

const initialState: AuthState = {
  user:              initialCachedUser,
  isAuthenticated:   !!initialCachedUser,
  isLoading:         false,
  isCheckingSession: false,
  error:             null,
};

// ─── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError(state) { state.error = null; },
    setUser(state, action: PayloadAction<User>) {
      state.user              = action.payload;
      state.isAuthenticated   = true;
      state.isCheckingSession = false;
      setCachedUser(action.payload);
    },
  },
  extraReducers: builder => {
    builder
      .addCase(login.pending, state => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading         = false;
        state.isAuthenticated   = true;
        state.isCheckingSession = false;
        state.user              = action.payload;
        state.error             = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading         = false;
        state.isAuthenticated   = false;
        state.isCheckingSession = false;
        state.error             = action.payload as string;
      })
      .addCase(logout.fulfilled, state => {
        state.user              = null;
        state.isAuthenticated   = false;
        state.isCheckingSession = false;
        state.error             = null;
      })
      .addCase(fetchCurrentUser.pending, state => {
        state.isLoading = true;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.isLoading         = false;
        state.isAuthenticated   = true;
        state.isCheckingSession = false;
        state.user              = action.payload as User;
      })
      .addCase(fetchCurrentUser.rejected, (state, action) => {
        state.isLoading = false;
        const payload = action.payload as string;
        if (payload === 'No session' || payload?.includes('expired') || payload?.includes('invalid')) {
          state.isAuthenticated = false;
          state.user = null;
          state.error = payload;
          setCachedUser(null);
        } else {
          const cached = loadCachedUser();
          if (cached) {
            state.user = cached;
            state.isAuthenticated = true;
          } else {
            state.isAuthenticated = false;
            state.user = null;
            state.error = payload;
          }
        }
      });
  },
});

export const { clearError, setUser } = authSlice.actions;
export default authSlice.reducer;
