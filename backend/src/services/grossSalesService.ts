import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

export interface GrossSalesSummary {
  grossSales: number;        // SUM(subtotal) of active non-cancelled invoices
  discounts: number;         // SUM(discount)
  deliveryCharges: number;   // SUM(deliveryCharge)
  netSales: number;          // Math.max(0, grossSales - discounts)
  totalRevenue: number;      // SUM(total)
  invoiceCount: number;
}

/**
 * Single Authoritative Gross Sales Service
 * 
 * CORE BUSINESS RULE:
 * Once an invoice is generated or edited, the latest finalized version (single Sale record)
 * is the single source of truth for Gross Sales.
 * 
 * Gross Sales = SUM(subtotal) of active, non-cancelled invoices.
 * Editing an invoice modifies the single authoritative Sale row with the updated subtotal.
 * Cancelled or deleted invoices contribute 0 to Gross Sales.
 */

/**
 * Calculates Gross Sales metrics synchronously from an array of sales records.
 * Filters out CANCELLED and deleted invoices.
 */
export function calculateGrossSalesFromSales(sales: Array<{
  subtotal: number;
  discount?: number;
  deliveryCharge?: number;
  total?: number;
  status: string;
  deletedAt?: Date | null;
}>): GrossSalesSummary {
  const activeSales = sales.filter(s => s.status !== 'CANCELLED' && !s.deletedAt);

  const grossSales = Math.round(activeSales.reduce((sum, s) => sum + (Number(s.subtotal) || 0), 0));
  const discounts = Math.round(activeSales.reduce((sum, s) => sum + (Number(s.discount) || 0), 0));
  const deliveryCharges = Math.round(activeSales.reduce((sum, s) => sum + (Number(s.deliveryCharge) || 0), 0));
  const netSales = Math.max(0, grossSales - discounts);
  const totalRevenue = Math.round(activeSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0));

  return {
    grossSales,
    discounts,
    deliveryCharges,
    netSales,
    totalRevenue,
    invoiceCount: activeSales.length,
  };
}

/**
 * Computes authoritative Gross Sales directly from the database for any filter.
 * Automatically enforces `status != CANCELLED` and `deletedAt == null`.
 */
export async function getAuthoritativeGrossSales(
  whereClause: Prisma.SaleWhereInput,
  tx?: any
): Promise<GrossSalesSummary> {
  const db = tx || prisma;

  // Enforce active finalized invoice rule: exclude CANCELLED and deleted invoices
  const enforcedWhere: Prisma.SaleWhereInput = {
    ...whereClause,
    status: { not: 'CANCELLED' },
    deletedAt: null,
  };

  const agg = await db.sale.aggregate({
    where: enforcedWhere,
    _sum: {
      subtotal: true,
      discount: true,
      deliveryCharge: true,
      total: true,
    },
    _count: true,
  });

  const grossSales = Math.round(agg._sum.subtotal ?? 0);
  const discounts = Math.round(agg._sum.discount ?? 0);
  const deliveryCharges = Math.round(agg._sum.deliveryCharge ?? 0);
  const netSales = Math.max(0, grossSales - discounts);
  const totalRevenue = Math.round(agg._sum.total ?? 0);
  const invoiceCount = agg._count;

  return {
    grossSales,
    discounts,
    deliveryCharges,
    netSales,
    totalRevenue,
    invoiceCount,
  };
}
