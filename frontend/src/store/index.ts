import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';

import authReducer from './slices/authSlice';
import uiReducer from './slices/uiSlice';
import clientsReducer from './slices/clientsSlice';
import salesReducer from './slices/salesSlice';
import purchasesReducer from './slices/purchasesSlice';

// ─── Store ────────────────────────────────────────────────────────────────────

export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    clients: clientsReducer,
    sales: salesReducer,
    purchases: purchasesReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['persist/PERSIST', 'persist/REHYDRATE'],
      },
    }),
  devTools: process.env.NODE_ENV !== 'production',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// ─── Typed Hooks ──────────────────────────────────────────────────────────────

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
