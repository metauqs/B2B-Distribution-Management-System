import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { AuthState, LoginCredentials, User } from '@/types/auth';

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
  if (typeof window !== 'undefined') {
    localStorage.removeItem('sabzi_token');
    localStorage.removeItem('sabzi_refresh_token');
    sessionStorage.clear();
  }
  await fetch('/api/auth/logout', { method: 'POST' });
});

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCachedUser(null);
        return rejectWithValue('Session expired or invalid');
      }
      const user = (data.data ?? data.user) as User;
      setCachedUser(user);
      return user;
    } catch {
      // Don't log out user on temporary network disconnects
      const cached = loadCachedUser();
      if (cached) return cached;
      setCachedUser(null);
      return rejectWithValue('Network connection failure');
    }
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
        const cached = loadCachedUser();
        if (cached) {
          state.user = cached;
          state.isAuthenticated = true;
        } else {
          state.isAuthenticated = false;
          state.user = null;
          state.error = action.payload as string;
        }
      });
  },
});

export const { clearError, setUser } = authSlice.actions;
export default authSlice.reducer;
