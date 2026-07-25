import api from './api';
import type { Purchase, CreatePurchaseDto } from '@/types/purchase';
import { API_ENDPOINTS } from '@/constants/routes';

export const purchasesService = {
  async getAll(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
  }): Promise<{ data: Purchase[]; total: number; page: number; limit: number }> {
    const { data } = await api.get<{ data: { data: Purchase[]; total: number; page: number; limit: number } }>(
      API_ENDPOINTS.PURCHASES,
      { params }
    );
    return data.data;
  },

  async getById(id: string): Promise<Purchase> {
    const { data } = await api.get<{ data: Purchase }>(API_ENDPOINTS.PURCHASE(id));
    return data.data;
  },

  async create(payload: CreatePurchaseDto): Promise<Purchase> {
    const { data } = await api.post<{ data: Purchase }>(API_ENDPOINTS.PURCHASES, payload);
    return data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(API_ENDPOINTS.PURCHASE(id));
  },
};
