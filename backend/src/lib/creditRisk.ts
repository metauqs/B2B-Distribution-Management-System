import prisma from './prisma';
import { ClientRating } from '@prisma/client';

export interface CreditRiskAssessment {
  clientId: string;
  clientName: string;
  totalInvoices: number;
  totalBilled: number;
  totalPaid: number;
  currentBalance: number;
  averageOrderValue: number;
  calculatedCreditLimit: number;
  effectiveCreditLimit: number;
  isManualLimitOverride: boolean;
  creditUtilizationPct: number; // For backward compatibility
  exposurePct: number;          // Exposure %
  availableCredit: number;      // Available Credit
  paymentCompletionRate: number;
  averagePaymentDays: number;   // For backward compatibility
  averagePaymentCycle: number;  // Avg Payment Cycle (Days)
  paymentReliabilityRating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';
  overdueCount: number;         // Overdue invoices count
  rating: ClientRating;         // Risk category: GREEN, YELLOW, ORANGE, RED, NEW
  isLimitExceeded: boolean;
  atRisk: boolean;
  reasons: string[];
  recommendedAction: string;    // Recommended Action
}

/**
 * ClientCreditRiskService
 * Calculates AOV using last 30 orders, Credit Limit, Exposure, Overdue Invoices,
 * Average Payment Cycle, and Combined Risk Category with Recommended Actions.
 */
export async function calculateClientCreditRisk(
  clientId: string,
  tx?: any
): Promise<CreditRiskAssessment> {
  const db = tx || prisma;

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      creditLimit: true,
      currentBalance: true,
      openingBalance: true,
      paymentTerms: true,
    },
  });

  if (!client) {
    throw new Error(`Client with id ${clientId} not found`);
  }

  // Fetch non-deleted sales for this client
  const sales = await db.sale.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      total: true,
      paid: true,
      balance: true,
      status: true,
      date: true,
      createdAt: true,
    },
    orderBy: { date: 'asc' },
  });

  // Fetch non-deleted collections for this client
  const collections = await db.collection.findMany({
    where: { clientId, deletedAt: null },
    select: {
      id: true,
      amount: true,
      date: true,
      createdAt: true,
    },
    orderBy: { date: 'asc' },
  });

  const totalInvoices = sales.length;
  const totalBilled = sales.reduce((sum: number, s: any) => sum + s.total, 0);
  const totalPaidFromSales = sales.reduce((sum: number, s: any) => sum + s.paid, 0);
  const totalCollections = collections.reduce((sum: number, c: any) => sum + c.amount, 0);
  const totalPaid = Math.max(totalPaidFromSales, totalCollections);

  const currentBalance = Math.max(0, client.currentBalance);

  // 1. Calculate Average Order Value (AOV) using configurable number of previous invoices (last 30 orders)
  const selectedSales = sales.slice(-30);
  const averageOrderValue = selectedSales.length > 0
    ? Math.round(selectedSales.reduce((sum: number, s: any) => sum + s.total, 0) / selectedSales.length)
    : 0;

  // 2. Calculated Credit Limit = AOV * 3 (default Rs 0 for brand new clients with 0 orders)
  const calculatedCreditLimit = averageOrderValue > 0 ? Math.round(averageOrderValue * 3) : 0;

  // Manual Limit Override: if admin explicitly set client.creditLimit > 0
  const isManualLimitOverride = Boolean(client.creditLimit && client.creditLimit > 0);
  const effectiveCreditLimit = isManualLimitOverride ? client.creditLimit : calculatedCreditLimit;

  // Exposure %
  const exposurePct = effectiveCreditLimit > 0
    ? Math.round((currentBalance / effectiveCreditLimit) * 100)
    : (currentBalance > 0 ? 999 : 0);
  const creditUtilizationPct = exposurePct;

  // Available Credit
  const availableCredit = Math.max(0, effectiveCreditLimit - currentBalance);

  // Payment Completion Rate
  const paymentCompletionRate = totalBilled > 0
    ? Math.min(100, Math.round((totalPaid / totalBilled) * 100))
    : 100;

  // Average Payment Days calculation (from sale date to collection date)
  let totalDays = 0;
  let paidCount = 0;
  for (const s of sales) {
    if (s.status === 'PAID' || s.paid >= s.total) {
      const saleDate = new Date(s.date);
      const matchingColl = collections.find((c: any) => new Date(c.date) >= saleDate);
      const payDate = matchingColl ? new Date(matchingColl.date) : new Date(s.createdAt);
      const diffDays = Math.max(0, Math.round((payDate.getTime() - saleDate.getTime()) / (1000 * 3600 * 24)));
      totalDays += diffDays;
      paidCount++;
    }
  }
  const averagePaymentDays = paidCount > 0 ? Math.round(totalDays / paidCount) : 0;
  const averagePaymentCycle = averagePaymentDays;

  // Calculate Overdue Invoices count
  const termsDays = client.paymentTerms && client.paymentTerms > 0 ? client.paymentTerms : 7;
  const nowTime = Date.now();
  const overdueSales = sales.filter((s: any) => {
    if (s.status === 'PAID' || s.paid >= s.total) return false;
    const dueDate = new Date(s.date).getTime() + termsDays * 86400000;
    return dueDate < nowTime;
  });
  const overdueCount = overdueSales.length;

  // 3. Payment Reliability Rating
  let paymentReliabilityRating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL' = 'EXCELLENT';
  if (totalInvoices === 0) {
    paymentReliabilityRating = 'EXCELLENT';
  } else if (averagePaymentDays > 45 || overdueCount > 6) {
    paymentReliabilityRating = 'CRITICAL';
  } else if (averagePaymentDays > 30 || overdueCount > 3) {
    paymentReliabilityRating = 'POOR';
  } else if (averagePaymentDays > 14 || overdueCount > 1) {
    paymentReliabilityRating = 'FAIR';
  } else if (averagePaymentDays > 5) {
    paymentReliabilityRating = 'GOOD';
  } else {
    paymentReliabilityRating = 'EXCELLENT';
  }

  // 4. Combined Risk Rating & Decision Matrix
  // Exposure Category
  let exposureCat: 'LOW' | 'MEDIUM' | 'HIGH' | 'ABOVE_LIMIT' = 'LOW';
  if (exposurePct > 100) {
    exposureCat = 'ABOVE_LIMIT';
  } else if (exposurePct > 90) {
    exposureCat = 'HIGH';
  } else if (exposurePct >= 70) {
    exposureCat = 'MEDIUM';
  } else {
    exposureCat = 'LOW';
  }

  const isPaymentPoor = paymentReliabilityRating === 'FAIR' || paymentReliabilityRating === 'POOR' || paymentReliabilityRating === 'CRITICAL';

  let rating: ClientRating = ClientRating.GREEN;
  let recommendedAction = 'Continue normal credit';

  if (totalInvoices < 2 && collections.length === 0 && currentBalance === 0) {
    rating = ClientRating.NEW;
    recommendedAction = 'New customer with insufficient payment history';
  } else {
    if (exposureCat === 'LOW') {
      if (!isPaymentPoor) {
        rating = ClientRating.GREEN;
        recommendedAction = 'Continue normal credit';
      } else {
        rating = ClientRating.YELLOW;
        recommendedAction = 'Monitor closely';
      }
    } else if (exposureCat === 'MEDIUM') {
      if (!isPaymentPoor) {
        rating = ClientRating.YELLOW;
        recommendedAction = 'Continue with caution';
      } else {
        rating = ClientRating.ORANGE;
        recommendedAction = 'Begin collection follow-up';
      }
    } else if (exposureCat === 'HIGH') {
      if (!isPaymentPoor) {
        rating = ClientRating.ORANGE;
        recommendedAction = 'Management approval required for additional credit';
      } else {
        rating = ClientRating.RED;
        recommendedAction = 'Suspend further credit and prioritize collection';
      }
    } else { // ABOVE_LIMIT
      rating = ClientRating.RED;
      if (!isPaymentPoor) {
        recommendedAction = 'Temporary override only with authorization';
      } else {
        recommendedAction = 'Immediate credit hold until outstanding balance is reduced';
      }
    }
  }

  const isLimitExceeded = currentBalance > effectiveCreditLimit;
  const atRisk = rating === ClientRating.RED || rating === ClientRating.ORANGE || isLimitExceeded;

  // Reasons list for risk explanation
  const reasons: string[] = [];
  if (isLimitExceeded) {
    reasons.push(`Outstanding balance (Rs ${currentBalance.toLocaleString()}) exceeds credit limit (Rs ${effectiveCreditLimit.toLocaleString()})`);
  }
  if (exposurePct >= 70 && !isLimitExceeded) {
    reasons.push(`Credit exposure is high at ${exposurePct}% (limit: Rs ${effectiveCreditLimit.toLocaleString()})`);
  }
  if (overdueCount > 0) {
    reasons.push(`Customer has ${overdueCount} overdue invoice(s)`);
  }
  if (averagePaymentDays > 30) {
    reasons.push(`High average payment delay (${averagePaymentDays} days)`);
  } else if (averagePaymentDays > 14) {
    reasons.push(`Occasional payment delay (${averagePaymentDays} days avg)`);
  }
  if (paymentCompletionRate < 50) {
    reasons.push(`Low payment completion rate (${paymentCompletionRate}%)`);
  }

  if (reasons.length === 0) {
    if (rating === ClientRating.NEW) {
      reasons.push('New customer with insufficient payment history');
    } else {
      reasons.push('Payments consistently on time with low credit exposure');
    }
  }

  return {
    clientId,
    clientName: client.name,
    totalInvoices,
    totalBilled,
    totalPaid,
    currentBalance,
    averageOrderValue,
    calculatedCreditLimit,
    effectiveCreditLimit,
    isManualLimitOverride,
    creditUtilizationPct,
    exposurePct,
    availableCredit,
    paymentCompletionRate,
    averagePaymentDays,
    averagePaymentCycle,
    paymentReliabilityRating,
    overdueCount,
    rating,
    isLimitExceeded,
    atRisk,
    reasons,
    recommendedAction,
  };
}

/**
 * Recalculates and updates the client's rating in the database.
 * Call this function whenever a Sale or Collection is created, updated, or deleted.
 */
export async function updateClientCreditRating(clientId: string, tx?: any): Promise<CreditRiskAssessment> {
  const db = tx || prisma;
  const risk = await calculateClientCreditRisk(clientId, db);

  await db.client.update({
    where: { id: clientId },
    data: { rating: risk.rating },
  });

  return risk;
}

/**
 * Recalculates ratings for all active clients across the system.
 */
export async function recalculateAllClientRatings(): Promise<number> {
  const activeClients = await prisma.client.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  let count = 0;
  for (const c of activeClients) {
    await updateClientCreditRating(c.id);
    count++;
  }
  return count;
}
