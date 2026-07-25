import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Toast, ToastType } from '@/types/common';

// ─── UI State ─────────────────────────────────────────────────────────────────

interface UiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  activePage: string;
  toasts: Toast[];
  globalLoading: boolean;
  modals: {
    billModal: boolean;
    addSaleModal: boolean;
    addClientModal: boolean;
    addPurchaseModal: boolean;
    addCollectionModal: boolean;
    addExpenseModal: boolean;
    addPriceModal: boolean;
    confirmDelete: boolean;
  };
  selectedIds: {
    saleId: string | null;
    clientId: string | null;
    purchaseId: string | null;
  };
}

const initialState: UiState = {
  sidebarOpen: false,
  sidebarCollapsed: false,
  activePage: 'dashboard',
  toasts: [],
  globalLoading: false,
  modals: {
    billModal: false,
    addSaleModal: false,
    addClientModal: false,
    addPurchaseModal: false,
    addCollectionModal: false,
    addExpenseModal: false,
    addPriceModal: false,
    confirmDelete: false,
  },
  selectedIds: {
    saleId: null,
    clientId: null,
    purchaseId: null,
  },
};

// ─── Slice ────────────────────────────────────────────────────────────────────

let toastCounter = 0;

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    closeSidebar(state) {
      state.sidebarOpen = false;
    },
    toggleSidebarCollapsed(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setActivePage(state, action: PayloadAction<string>) {
      state.activePage = action.payload;
    },
    setGlobalLoading(state, action: PayloadAction<boolean>) {
      state.globalLoading = action.payload;
    },

    // ─ Modals ───────────────────────────────────────────────────────────────
    openModal(state, action: PayloadAction<keyof UiState['modals']>) {
      state.modals[action.payload] = true;
    },
    closeModal(state, action: PayloadAction<keyof UiState['modals']>) {
      state.modals[action.payload] = false;
    },
    closeAllModals(state) {
      Object.keys(state.modals).forEach((key) => {
        state.modals[key as keyof UiState['modals']] = false;
      });
    },

    // ─ Selected IDs ─────────────────────────────────────────────────────────
    setSelectedSaleId(state, action: PayloadAction<string | null>) {
      state.selectedIds.saleId = action.payload;
    },
    setSelectedClientId(state, action: PayloadAction<string | null>) {
      state.selectedIds.clientId = action.payload;
    },
    setSelectedPurchaseId(state, action: PayloadAction<string | null>) {
      state.selectedIds.purchaseId = action.payload;
    },

    // ─ Toasts ───────────────────────────────────────────────────────────────
    addToast(
      state,
      action: PayloadAction<{ type: ToastType; title: string; message?: string; duration?: number }>
    ) {
      toastCounter += 1;
      state.toasts.push({
        id: `toast-${toastCounter}`,
        ...action.payload,
        duration: action.payload.duration ?? 4000,
      });
    },
    removeToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
    clearToasts(state) {
      state.toasts = [];
    },
  },
});

export const {
  toggleSidebar,
  closeSidebar,
  toggleSidebarCollapsed,
  setActivePage,
  setGlobalLoading,
  openModal,
  closeModal,
  closeAllModals,
  setSelectedSaleId,
  setSelectedClientId,
  setSelectedPurchaseId,
  addToast,
  removeToast,
  clearToasts,
} = uiSlice.actions;

export default uiSlice.reducer;
