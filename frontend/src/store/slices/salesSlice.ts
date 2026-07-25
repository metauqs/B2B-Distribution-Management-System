import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Sale, SaleListResponse, CreateSaleDto } from '@/types/sale';
import { salesService } from '@/services/salesService';

// ─── State ────────────────────────────────────────────────────────────────────

interface SalesState {
  items: Sale[];
  selectedSale: Sale | null;
  total: number;
  page: number;
  limit: number;
  totalRevenue: number;
  totalBalance: number;
  isLoading: boolean;
  error: string | null;
}

const initialState: SalesState = {
  items: [],
  selectedSale: null,
  total: 0,
  page: 1,
  limit: 25,
  totalRevenue: 0,
  totalBalance: 0,
  isLoading: false,
  error: null,
};

// ─── Async Thunks ─────────────────────────────────────────────────────────────

export const fetchSales = createAsyncThunk<
  SaleListResponse,
  { page?: number; search?: string; dateFrom?: string; dateTo?: string; status?: string; branchId?: string }
>('sales/fetchAll', async (params, { rejectWithValue }) => {
  try {
    return await salesService.getAll(params);
  } catch (err: unknown) {
    const error = err as { message?: string };
    return rejectWithValue(error.message ?? 'Failed to fetch sales');
  }
});

export const fetchSaleById = createAsyncThunk<Sale, string>(
  'sales/fetchById',
  async (id, { rejectWithValue }) => {
    try {
      return await salesService.getById(id);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to fetch sale');
    }
  }
);

export const createSale = createAsyncThunk<Sale, CreateSaleDto>(
  'sales/create',
  async (data, { rejectWithValue }) => {
    try {
      return await salesService.create(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to create sale');
    }
  }
);

export const deleteSale = createAsyncThunk<string, string>(
  'sales/delete',
  async (id, { rejectWithValue }) => {
    try {
      await salesService.delete(id);
      return id;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to delete sale');
    }
  }
);

// ─── Slice ────────────────────────────────────────────────────────────────────

const salesSlice = createSlice({
  name: 'sales',
  initialState,
  reducers: {
    setSelectedSale(state, action) {
      state.selectedSale = action.payload;
    },
    clearSalesError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSales.pending, (state) => {
        if (state.items.length === 0) {
          state.isLoading = true;
        }
        state.error = null;
      })
      .addCase(fetchSales.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.limit = action.payload.limit;
        state.totalRevenue = action.payload.totalRevenue;
        state.totalBalance = action.payload.totalBalance;
      })
      .addCase(fetchSales.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(fetchSaleById.fulfilled, (state, action) => {
        state.selectedSale = action.payload;
      })
      .addCase(createSale.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.total += 1;
      })
      .addCase(deleteSale.fulfilled, (state, action) => {
        state.items = state.items.filter((s) => s.id !== action.payload);
        state.total -= 1;
      });
  },
});

export const { setSelectedSale, clearSalesError } = salesSlice.actions;
export default salesSlice.reducer;
