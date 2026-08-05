// ─── Auth Types — aligned with Prisma schema ─────────────────────────────

export type UserRole =
  | 'OWNER'
  | 'MANAGER'
  | 'CASHIER'
  | 'SALESMAN'
  | 'ACCOUNTANT'
  | 'DELIVERY';

export interface User {
  id:        string;
  name:      string;
  email:     string;
  role:      UserRole;
  branchId:  string;
  branch?:   { id: string; name: string };
  isActive:  boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthState {
  user:              User | null;
  isAuthenticated:   boolean;
  isLoading:         boolean;
  isCheckingSession: boolean;
  error:             string | null;
}

export interface LoginCredentials {
  email:    string;
  password: string;
}

export interface JwtPayload {
  sub:      string;
  email:    string;
  role:     UserRole;
  branchId: string;
  iat:      number;
  exp:      number;
}
