import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { Purchase, CreatePurchaseDto } from '@/types/purchase';
import { purchasesService } from '@/services/purchasesService';

interface PurchasesState {
  items: Purchase[];
  selectedPurchase: Purchase | null;
  total: number;
  page: number;
  limit: number;
  isLoading: boolean;
  error: string | null;
}

const initialState: PurchasesState = {
  items: [],
  selectedPurchase: null,
  total: 0,
  page: 1,
  limit: 25,
  isLoading: false,
  error: null,
};

export const fetchPurchases = createAsyncThunk<
  { data: Purchase[]; total: number; page: number; limit: number },
  { page?: number; search?: string; branchId?: string }
>('purchases/fetchAll', async (params, { rejectWithValue }) => {
  try {
    return await purchasesService.getAll(params);
  } catch (err: unknown) {
    const error = err as { message?: string };
    return rejectWithValue(error.message ?? 'Failed to fetch purchases');
  }
});

export const createPurchase = createAsyncThunk<Purchase, CreatePurchaseDto>(
  'purchases/create',
  async (data, { rejectWithValue }) => {
    try {
      return await purchasesService.create(data);
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to create purchase');
    }
  }
);

export const deletePurchase = createAsyncThunk<string, string>(
  'purchases/delete',
  async (id, { rejectWithValue }) => {
    try {
      await purchasesService.delete(id);
      return id;
    } catch (err: unknown) {
      const error = err as { message?: string };
      return rejectWithValue(error.message ?? 'Failed to delete purchase');
    }
  }
);

const purchasesSlice = createSlice({
  name: 'purchases',
  initialState,
  reducers: {
    setSelectedPurchase(state, action) {
      state.selectedPurchase = action.payload;
    },
    clearPurchasesError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPurchases.pending, (state) => {
        if (state.items.length === 0) {
          state.isLoading = true;
        }
        state.error = null;
      })
      .addCase(fetchPurchases.fulfilled, (state, action) => {
        state.isLoading = false;
        state.items = action.payload.data;
        state.total = action.payload.total;
        state.page = action.payload.page;
        state.limit = action.payload.limit;
      })
      .addCase(fetchPurchases.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      .addCase(createPurchase.fulfilled, (state, action) => {
        state.items.unshift(action.payload);
        state.total += 1;
      })
      .addCase(deletePurchase.fulfilled, (state, action) => {
        state.items = state.items.filter((p) => p.id !== action.payload);
        state.total -= 1;
      });
  },
});

export const { setSelectedPurchase, clearPurchasesError } = purchasesSlice.actions;
export default purchasesSlice.reducer;
