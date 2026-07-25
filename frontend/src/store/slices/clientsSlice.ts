import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Client, ClientListResponse, CreateClientDto } from '@/types/client';
import { clientService } from '@/services/clientService';

// ─── State ────────────────────────────────────────────────────────────────────

interface ClientsState {
  items: Client[];
  selectedClient: Client | null;
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
}

const initialState: ClientsState = {
  items: [],
  selectedClient: null,
  total: 0,
  page: 1,
  limit: 25,
  isLoading: false,
  error: null,
};

// ─── Async Thunks ─────────────────────────────────────────────────────────────

export const fetchClients = createAsyncThunk<
  ClientListResponse,
  { page?: number; search?: string; branchId?: string }
>('clients/fetchAll', async (params, { rejectWithValue }) => {
  try {
    return await clientService.getAll(params);
  } catch (err: unknown) {
    const error = err as { message?: string };
    return rejectWithValue(error.message ?? 'Failed to fetch clients');
  }
});

export const createClient = createAsyncThunk<Client, CreateClientDto>(
  'clients/create',
  async (data, { rejectWithValue }) => {
    try {
      return await clientService.create(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to create client');
    }
  }
);

export const updateClient = createAsyncThunk<Client, { id: string; data: Partial<CreateClientDto> }>(
  'clients/update',
  async ({ id, data }, { rejectWithValue }) => {
    try {
      return await clientService.update(id, data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to update client');
    }
  }
);

export const deleteClient = createAsyncThunk<string, string>(
  'clients/delete',
  async (id, { rejectWithValue }) => {
    try {
      await clientService.delete(id);
      return id;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to delete client');
    }
  }
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const clientsSlice = createSlice({
  name: 'clients',
  initialState,
  reducers: {
    setSelectedClient(state, action) {
      state.selectedClient = action.payload;
    },
    clearClientsError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchClients.pending, (state) => {
        if (state.items.length === 0) {
          state.isLoading = true;
        }
        state.error = null;
      })
      .addCase(fetchClients.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.limit = action.payload.limit;
      })
      .addCase(fetchClients.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(createClient.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.total += 1;
      })
      .addCase(updateClient.fulfilled, (state, action) => {
        const idx = state.items.findIndex((c) => c.id === action.payload.id);
        if (idx !== -1) state.items[idx] = action.payload;
        if (state.selectedClient?.id === action.payload.id) {
          state.selectedClient = action.payload;
        }
      })
      .addCase(deleteClient.fulfilled, (state, action) => {
        state.items = state.items.filter((c) => c.id !== action.payload);
        state.total -= 1;
        if (state.selectedClient?.id === action.payload) {
          state.selectedClient = null;
        }
      });
  },
});

export const { setSelectedClient, clearClientsError } = clientsSlice.actions;
export default clientsSlice.reducer;
