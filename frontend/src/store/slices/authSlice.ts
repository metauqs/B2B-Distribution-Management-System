import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import type { AuthState, LoginCredentials, User } from '@/types/auth';

// ─── Login via fetch (cookie-based, no Redux token needed) ────────────────────

export const login = createAsyncThunk<User, LoginCredentials>(
  'auth/login',
  async (credentials, { rejectWithValue }) => {
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(credentials),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return rejectWithValue(data.error ?? 'Login failed');
      return data.data.user as User;
    } catch {
      return rejectWithValue('Network error');
    }
  }
);

export const logout = createAsyncThunk('auth/logout', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
});

export const fetchCurrentUser = createAsyncThunk(
  'auth/fetchCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const res  = await fetch('/api/auth/me');
      const data = await res.json();
      if (!res.ok || !data.success) return rejectWithValue('Session expired');
      return data.data as User;
    } catch {
      return rejectWithValue('Network error');
    }
  }
);

// ─── Initial State ────────────────────────────────────────────────────────────

const initialState: AuthState = {
  user:            null,
  isAuthenticated: false,
  isLoading:       false,
  error:           null,
};

// ─── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError(state) { state.error = null; },
    setUser(state, action: PayloadAction<User>) {
      state.user            = action.payload;
      state.isAuthenticated = true;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(login.pending,   state => { state.isLoading = true; state.error = null; })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading       = false;
        state.isAuthenticated = true;
        state.user            = action.payload;
        state.error           = null;
      })
      .addCase(login.rejected,  (state, action) => {
        state.isLoading       = false;
        state.isAuthenticated = false;
        state.error           = action.payload as string;
      })
      .addCase(logout.fulfilled, state => {
        state.user            = null;
        state.isAuthenticated = false;
        state.error           = null;
      })
      .addCase(fetchCurrentUser.pending,   state => { state.isLoading = true; })
      .addCase(fetchCurrentUser.fulfilled, (state, action) => {
        state.isLoading       = false;
        state.isAuthenticated = true;
        state.user            = action.payload as User;
      })
      .addCase(fetchCurrentUser.rejected,  state => {
        state.isLoading       = false;
        state.isAuthenticated = false;
        state.user            = null;
      });
  },
});

export const { clearError, setUser } = authSlice.actions;
export default authSlice.reducer;
