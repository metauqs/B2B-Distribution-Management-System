import prisma from './prisma';

export interface CollectionBehaviourProfile {
  clientId: string;
  score: number;                     // 0-100 score
  preferredMethodHist: string;       // E.g. CASH, ONLINE
  preferredMethodCurr: string;
  paymentGapHist: number;            // Avg days between sale and collection
  paymentGapCurr: number;
  paymentFrequency: 'DAILY' | 'WEEKLY' | 'BI-WEEKLY' | 'MONTHLY' | 'IRREGULAR';
  avgPaymentIntervalDays: number;
  paidImmediatelyPct: number;
  paidOnCreditPct: number;
  avgCollectionAmount: number;
  partialPaymentsCount: number;
  delayedPaymentsCount: number;
  trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' | 'HIGH_VOLATILITY';
  alertLevel: 'INFO' | 'CAUTION' | 'WARNING' | 'CRITICAL';
  alerts: string[];
  recommendedAction: string;
}

export interface PreFetchedBehaviourData {
  sales?: Array<{ id: string; total: number; paid: number; balance: number; status: string; date: Date; createdAt: Date }>;
  collections?: Array<{ id: string; amount: number; method?: string; date: Date; createdAt: Date }>;
  paymentTerms?: number | null;
  currentBalance?: number;
}

/**
 * Calculates collection behaviour and pattern anomalies for a client.
 */
export async function calculateCollectionBehaviour(
  clientId: string,
  tx?: any,
  prefetched?: PreFetchedBehaviourData
): Promise<CollectionBehaviourProfile> {
  const db = tx || prisma;

  // 1. Use pre-fetched sales and collections if available, else fetch from DB
  const sales = prefetched?.sales ?? await db.sale.findMany({
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

  const collections = prefetched?.collections ?? await db.collection.findMany({
    where: { clientId, deletedAt: null, status: { not: 'CANCELLED' } },
    select: {
      id: true,
      amount: true,
      method: true,
      date: true,
      createdAt: true,
    },
    orderBy: { date: 'asc' },
  });

  // Basic totals
  const totalCollectionsCount = collections.length;
  const totalSalesCount = sales.length;

  // Defaults if no history exists
  if (totalSalesCount === 0 && totalCollectionsCount === 0) {
    return {
      clientId,
      score: 100,
      preferredMethodHist: 'CASH',
      preferredMethodCurr: 'CASH',
      paymentGapHist: 0,
      paymentGapCurr: 0,
      paymentFrequency: 'WEEKLY',
      avgPaymentIntervalDays: 0,
      paidImmediatelyPct: 100,
      paidOnCreditPct: 0,
      avgCollectionAmount: 0,
      partialPaymentsCount: 0,
      delayedPaymentsCount: 0,
      trend: 'STABLE',
      alertLevel: 'INFO',
      alerts: ['New account — establishing payment behaviour baseline.'],
      recommendedAction: 'Continue normal credit terms.',
    };
  }

  // 2. Preferred Payment Methods (Historical vs Current last 10)
  const methodCountsHist: Record<string, number> = {};
  collections.forEach((c: any) => {
    methodCountsHist[c.method] = (methodCountsHist[c.method] || 0) + 1;
  });
  let preferredMethodHist = 'CASH';
  let maxCountHist = 0;
  Object.entries(methodCountsHist).forEach(([m, count]) => {
    if (count > maxCountHist) {
      preferredMethodHist = m;
      maxCountHist = count;
    }
  });

  const collectionsCurr = collections.slice(-10);
  const methodCountsCurr: Record<string, number> = {};
  collectionsCurr.forEach((c: any) => {
    methodCountsCurr[c.method] = (methodCountsCurr[c.method] || 0) + 1;
  });
  let preferredMethodCurr = preferredMethodHist;
  let maxCountCurr = 0;
  Object.entries(methodCountsCurr).forEach(([m, count]) => {
    if (count > maxCountCurr) {
      preferredMethodCurr = m;
      maxCountCurr = count;
    }
  });

  // Calculate cash collection percentage (historical vs current)
  const totalHistCollAmt = collections.reduce((s: number, c: any) => s + c.amount, 0);
  const avgCollectionAmount = totalCollectionsCount > 0 ? Math.round(totalHistCollAmt / totalCollectionsCount) : 0;

  // 3. Payment Gap Analysis (Historical vs Current last 10 invoices)
  let totalGapDaysHist = 0;
  let paidSalesCountHist = 0;
  const saleGaps: number[] = [];

  for (const s of sales) {
    if (s.status === 'PAID' || s.paid >= s.total) {
      const saleDate = new Date(s.date);
      const matchingColl = collections.find((c: any) => new Date(c.date) >= saleDate);
      const payDate = matchingColl ? new Date(matchingColl.date) : new Date(s.createdAt);
      const gap = Math.max(0, Math.round((payDate.getTime() - saleDate.getTime()) / (1000 * 3600 * 24)));
      totalGapDaysHist += gap;
      paidSalesCountHist++;
      saleGaps.push(gap);
    }
  }
  const paymentGapHist = paidSalesCountHist > 0 ? Math.round(totalGapDaysHist / paidSalesCountHist) : 0;

  // Current gap is based on the last 10 paid invoices
  const recentGaps = saleGaps.slice(-10);
  const paymentGapCurr = recentGaps.length > 0
    ? Math.round(recentGaps.reduce((s, g) => s + g, 0) / recentGaps.length)
    : paymentGapHist;

  // 4. Payment Frequency
  // Average days between consecutive collection transactions
  let avgPaymentIntervalDays = 0;
  if (totalCollectionsCount > 1) {
    let totalIntervalDays = 0;
    for (let i = 1; i < totalCollectionsCount; i++) {
      const prevDate = new Date(collections[i - 1].date).getTime();
      const currDate = new Date(collections[i].date).getTime();
      totalIntervalDays += Math.max(0, (currDate - prevDate) / (1000 * 3600 * 24));
    }
    avgPaymentIntervalDays = Math.round(totalIntervalDays / (totalCollectionsCount - 1));
  }

  let paymentFrequency: 'DAILY' | 'WEEKLY' | 'BI-WEEKLY' | 'MONTHLY' | 'IRREGULAR' = 'WEEKLY';
  if (avgPaymentIntervalDays <= 1.5) {
    paymentFrequency = 'DAILY';
  } else if (avgPaymentIntervalDays <= 8) {
    paymentFrequency = 'WEEKLY';
  } else if (avgPaymentIntervalDays <= 16) {
    paymentFrequency = 'BI-WEEKLY';
  } else if (avgPaymentIntervalDays <= 32) {
    paymentFrequency = 'MONTHLY';
  } else {
    paymentFrequency = 'IRREGULAR';
  }

  // If volatility (standard deviation of gaps) is very high, set to irregular
  if (saleGaps.length > 3) {
    const mean = saleGaps.reduce((s, g) => s + g, 0) / saleGaps.length;
    const variance = saleGaps.reduce((s, g) => s + Math.pow(g - mean, 2), 0) / saleGaps.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 10) {
      paymentFrequency = 'IRREGULAR';
    }
  }

  // 5. Ratios of Invoices Paid Immediately vs Credit
  const paidImmediatelyCount = sales.filter((s: any) => s.paid >= s.total).length;
  const paidImmediatelyPct = totalSalesCount > 0
    ? Math.round((paidImmediatelyCount / totalSalesCount) * 100)
    : 100;

  const paidOnCreditCount = sales.filter((s: any) => s.paid === 0).length;
  const paidOnCreditPct = totalSalesCount > 0
    ? Math.round((paidOnCreditCount / totalSalesCount) * 100)
    : 0;

  const partialPaymentsCount = sales.filter((s: any) => s.status === 'PARTIAL').length;

  // Delayed payments: gap is longer than allowed credit/payment terms (default 7)
  let allowedTerms = 7;
  if (prefetched?.paymentTerms !== undefined) {
    allowedTerms = prefetched.paymentTerms && prefetched.paymentTerms > 0 ? prefetched.paymentTerms : 7;
  } else {
    const clientRow = await db.client.findUnique({
      where: { id: clientId },
      select: { paymentTerms: true, currentBalance: true },
    });
    allowedTerms = clientRow?.paymentTerms && clientRow.paymentTerms > 0 ? clientRow.paymentTerms : 7;
  }
  const delayedPaymentsCount = saleGaps.filter(g => g > allowedTerms).length;

  // 6. Behaviour Trend
  let trend: 'IMPROVING' | 'STABLE' | 'DETERIORATING' | 'HIGH_VOLATILITY' = 'STABLE';
  if (paymentFrequency === 'IRREGULAR') {
    trend = 'HIGH_VOLATILITY';
  } else if (paymentGapCurr <= paymentGapHist - 1) {
    trend = 'IMPROVING';
  } else if (paymentGapCurr >= paymentGapHist + 3) {
    trend = 'DETERIORATING';
  } else {
    trend = 'STABLE';
  }

  // 7. Behaviour Alerts & Score Deductions
  const alerts: string[] = [];
  let score = 100;

  // Check Cash to Credit Shift
  // E.g. Historically cash preferred, now credit is used or cash collections dropped below 30% of sales value
  const totalSalesVal = sales.reduce((s: number, sa: any) => s + sa.total, 0);
  const totalOutstanding = prefetched?.currentBalance ?? 0;
  const creditUsagePct = totalSalesVal > 0 ? Math.round((totalOutstanding / totalSalesVal) * 100) : 0;

  if (preferredMethodHist === 'CASH' && preferredMethodCurr !== 'CASH') {
    alerts.push('Cash customer has shifted payment preference to Credit/Transfer.');
    score -= 15;
  }

  // Gap extension warning
  if (paymentGapCurr > paymentGapHist + 4) {
    alerts.push(`Payment gap is stretching: historical average was ${paymentGapHist} day(s), currently averaging ${paymentGapCurr} day(s).`);
    score -= 15;
  } else if (paymentGapCurr > paymentGapHist + 1) {
    alerts.push(`Minor payment cycle delay: cycle increased by ${paymentGapCurr - paymentGapHist} day(s).`);
    score -= 5;
  }

  // Accumulating balances
  if (totalOutstanding > avgCollectionAmount * 3 && totalOutstanding > 0) {
    alerts.push(`Customer is accumulating outstanding balance (Rs ${totalOutstanding.toLocaleString()} vs avg collection Rs ${avgCollectionAmount.toLocaleString()}).`);
    score -= 10;
  }

  // Partial payment frequency
  if (partialPaymentsCount > totalSalesCount * 0.3 && totalSalesCount > 0) {
    alerts.push(`High partial payments frequency (${Math.round(partialPaymentsCount / totalSalesCount * 100)}% of invoices).`);
    score -= 8;
  }

  // Overdue count deduction
  const nowTime = Date.now();
  const overdueCount = sales.filter((s: any) => {
    if (s.status === 'PAID' || s.paid >= s.total) return false;
    return new Date(s.date).getTime() + allowedTerms * 86400000 < nowTime;
  }).length;

  if (overdueCount > 0) {
    alerts.push(`Customer has ${overdueCount} overdue unpaid invoice(s).`);
    score -= overdueCount * 8;
  }

  // Volatility or deterioration trend deductions
  if (trend === 'DETERIORATING') {
    score -= 10;
  } else if (trend === 'HIGH_VOLATILITY') {
    score -= 5;
  }

  // Final score clamping
  score = Math.max(0, Math.min(100, score));

  // Determine Alert Level & Recommended Action
  let alertLevel: 'INFO' | 'CAUTION' | 'WARNING' | 'CRITICAL' = 'INFO';
  let recommendedAction = 'Continue normal credit terms.';

  if (score < 40) {
    alertLevel = 'CRITICAL';
    recommendedAction = 'Suspend additional credit pending management approval and prioritize collection immediately.';
  } else if (score < 70) {
    alertLevel = 'WARNING';
    recommendedAction = 'Increase collection follow-ups; avoid extending credit limit without manual review.';
  } else if (score < 85) {
    alertLevel = 'CAUTION';
    recommendedAction = 'Monitor collections closely and confirm future payment expectations.';
  } else {
    alertLevel = 'INFO';
    recommendedAction = 'Stable collection patterns. Continue standard terms.';
  }

  if (alerts.length === 0) {
    alerts.push('Payment patterns are regular and consistent with baseline.');
  }

  return {
    clientId,
    score,
    preferredMethodHist,
    preferredMethodCurr,
    paymentGapHist,
    paymentGapCurr,
    paymentFrequency,
    avgPaymentIntervalDays,
    paidImmediatelyPct,
    paidOnCreditPct,
    avgCollectionAmount,
    partialPaymentsCount,
    delayedPaymentsCount,
    trend,
    alertLevel,
    alerts,
    recommendedAction,
  };
}
