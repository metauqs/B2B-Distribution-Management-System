import api from './api';
import type { Sale, SaleListResponse, CreateSaleDto } from '@/types/sale';
import { API_ENDPOINTS } from '@/constants/routes';

export const salesService = {
  async getAll(params?: {
    page?: number;
    limit?: number;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    status?: string;
    clientId?: string;
    branchId?: string;
  }): Promise<SaleListResponse> {
    const { data } = await api.get<{ data: SaleListResponse }>(API_ENDPOINTS.SALES, { params });
    return data.data;
  },

  async getById(id: string): Promise<Sale> {
    const { data } = await api.get<{ data: Sale }>(API_ENDPOINTS.SALE(id));
    return data.data;
  },

  async create(payload: CreateSaleDto): Promise<Sale> {
    const { data } = await api.post<{ data: Sale }>(API_ENDPOINTS.SALES, payload);
    return data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(API_ENDPOINTS.SALE(id));
  },

  async getBill(id: string): Promise<Sale> {
    const { data } = await api.get<{ data: Sale }>(API_ENDPOINTS.SALE_BILL(id));
    return data.data;
  },
};
