import { z } from 'zod';

// ─── Shared Field Validators ───────────────────────────────────────────────────

export const phoneSchema = z
  .string()
  .min(10, 'Phone number must be at least 10 digits')
  .max(15, 'Phone number too long')
  .regex(/^[0-9+\-\s()]+$/, 'Invalid phone number format');

export const amountSchema = z
  .coerce.number()
  .min(0, 'Amount cannot be negative');

export const positiveAmountSchema = z
  .coerce.number()
  .positive('Amount must be greater than 0');

export const qtySchema = z
  .coerce.number()
  .positive('Quantity must be greater than 0');

export const rateSchema = z
  .coerce.number()
  .positive('Rate must be greater than 0');

// ─── Client Validators ────────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  phone: phoneSchema,
  address: z.string().min(5, 'Address too short').max(500, 'Address too long'),
  type: z.enum(['RETAIL', 'WHOLESALE', 'HOTEL', 'RESTAURANT', 'OTHER']),
  openingBalance: amountSchema.optional().default(0),
});

export type CreateClientFormValues = z.infer<typeof createClientSchema>;

// ─── Sale Validators ──────────────────────────────────────────────────────────

export const saleItemSchema = z.object({
  itemName: z.string().min(1, 'Item name is required').max(100),
  qty: qtySchema,
  unit: z.enum(['KG', 'MAUND', 'DOZEN', 'PIECE', 'CRATE', 'BAG', 'TON']),
  rate: rateSchema,
});

export const createSaleSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  date: z.string().min(1, 'Date is required'),
  items: z.array(saleItemSchema).min(1, 'At least one item is required'),
  discount: amountSchema.optional().default(0),
  paid: amountSchema.optional().default(0),
  notes: z.string().max(500).optional(),
});

export type CreateSaleFormValues = z.infer<typeof createSaleSchema>;

// ─── Purchase Validators ──────────────────────────────────────────────────────

export const createPurchaseSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  date: z.string().min(1, 'Date is required'),
  items: z.array(saleItemSchema).min(1, 'At least one item is required'),
  discount: amountSchema.optional().default(0),
  paid: amountSchema.optional().default(0),
  notes: z.string().max(500).optional(),
});

export type CreatePurchaseFormValues = z.infer<typeof createPurchaseSchema>;

// ─── Collection Validators ────────────────────────────────────────────────────

export const createCollectionSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  amount: positiveAmountSchema,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'ONLINE']),
  date: z.string().min(1, 'Date is required'),
  reference: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export type CreateCollectionFormValues = z.infer<typeof createCollectionSchema>;

// ─── Expense Validators ───────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  category: z.enum(['TRANSPORT', 'LABOUR', 'RENT', 'UTILITIES', 'COMMISSION', 'MISCELLANEOUS', 'OTHER']),
  description: z.string().min(3, 'Description too short').max(500),
  amount: positiveAmountSchema,
  date: z.string().min(1, 'Date is required'),
});

export type CreateExpenseFormValues = z.infer<typeof createExpenseSchema>;

// ─── Auth Validators ──────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
