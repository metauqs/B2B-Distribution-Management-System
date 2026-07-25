// ─── Client Types ─────────────────────────────────────────────────────────────

export type ClientType = 'RETAIL' | 'WHOLESALE' | 'HOTEL' | 'RESTAURANT' | 'OTHER';
export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED';

export interface Client {
  id: string;
  name: string;
  phone: string;
  address: string;
  type: ClientType;
  status: ClientStatus;
  openingBalance: number;
  balance: number;
  branchId: string;
  branch?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface CreateClientDto {
  name: string;
  phone: string;
  address: string;
  type: ClientType;
  openingBalance?: number;
  branchId?: string;
}

export interface UpdateClientDto extends Partial<CreateClientDto> {
  status?: ClientStatus;
}

export interface ClientListResponse {
  data: Client[];
  total: number;
  page: number;
  limit: number;
}
