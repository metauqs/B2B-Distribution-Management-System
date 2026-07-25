import api from './api';
import type { Client, ClientListResponse, CreateClientDto, UpdateClientDto } from '@/types/client';
import { API_ENDPOINTS } from '@/constants/routes';

export const clientService = {
  async getAll(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
  }): Promise<ClientListResponse> {
    const { data } = await api.get<{ data: ClientListResponse }>(API_ENDPOINTS.CLIENTS, { params });
    return data.data;
  },

  async getById(id: string): Promise<Client> {
    const { data } = await api.get<{ data: Client }>(API_ENDPOINTS.CLIENT(id));
    return data.data;
  },

  async create(payload: CreateClientDto): Promise<Client> {
    const { data } = await api.post<{ data: Client }>(API_ENDPOINTS.CLIENTS, payload);
    return data.data;
  },

  async update(id: string, payload: UpdateClientDto): Promise<Client> {
    const { data } = await api.put<{ data: Client }>(API_ENDPOINTS.CLIENT(id), payload);
    return data.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(API_ENDPOINTS.CLIENT(id));
  },
};
