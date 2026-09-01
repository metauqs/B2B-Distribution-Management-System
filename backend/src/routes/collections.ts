import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { recordCustomerLedgerEntry, writeAuditLog, recalculateClientLedgerAndBalance, deriveInvoiceStatus, reconcileClientBalancesAndAllocations, getAuthoritativeClientOutstanding } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { getBusinessDateRange, getBusinessDateString, getCurrentBusinessDateRange, formatPKTDateTime, parseInputDateToUtc } from '../lib/businessDate';
import { postCollectionLedger, postCollectionCancellationLedger } from '../lib/financialLedgerService';
import { clearReportCache } from './reports';

const router = Router();

// ── In-Memory Cache for Collections (90s TTL) ──────────────────────────────
const COLLECTIONS_CACHE = new Map<string, { ts: number; data: any }>();
const COLLECTIONS_CACHE_TTL = 90000;
const COLLECTIONS_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearCollectionsCache(): void {
  COLLECTIONS_CACHE.clear();
  clearReportCache();
}

// GET /api/collections/daily-history — Server-Side 5 AM Business Day Aggregation & Payment List
router.get('/daily-history', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { date, employeeId, method, clientId, search } = req.query;

    const normDate = date ? getBusinessDateString(getBusinessDateRange(String(date)).start) : getBusinessDateString(getCurrentBusinessDateRange().start);
    const cacheKey = `daily_${branchId || 'all'}_${normDate}_${employeeId || 'all'}_${method || 'all'}_${clientId || 'all'}_${search ? String(search).trim().toLowerCase() : 'all'}`;
    const cached = COLLECTIONS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < COLLECTIONS_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (COLLECTIONS_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await COLLECTIONS_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchDailyPromise = (async () => {
      const targetDateStr = date ? String(date) : undefined;
      const range = getBusinessDateRange(targetDateStr);
      const rawBranchId = branchId || '';
      const rawClientId = clientId ? String(clientId) : '';
      const rawEmployeeId = employeeId && employeeId !== 'all' ? String(employeeId) : '';
      const rawMethod = method && method !== 'all' ? String(method).toUpperCase() : '';
      const rawSearch = search ? String(search).trim() : '';

      const collections: any[] = await prisma.$queryRaw`
        WITH page_collections AS (
          SELECT 
            c.id,
            c."clientId",
            c.amount::float as amount,
            c.method,
            c."cashAccountId",
            c."bankAccountId",
            c."receivedByUserId",
            c."remainingBalance"::float as "remainingBalance",
            c.date,
            c.reference,
            c.notes,
            c."branchId",
            c."createdAt",
            c."deletedAt",
            COALESCE(c.status::text, 'PAID') as status,
            c."cancelledAt",
            c."cancelledByUserId",
            c."cancelReason"
          FROM collections c
          LEFT JOIN clients cl ON cl.id = c."clientId"
          WHERE c."deletedAt" IS NULL 
            AND (${rawBranchId} = '' OR c."branchId" = ${rawBranchId})
            AND (${rawClientId} = '' OR c."clientId" = ${rawClientId})
            AND (${rawEmployeeId} = '' OR c."receivedByUserId" = ${rawEmployeeId})
            AND (${rawMethod} = '' OR c.method::text = ${rawMethod})
            AND c.date >= ${range.start} AND c.date <= ${range.end}
            AND (${rawSearch} = '' OR (
              c.reference ILIKE ${'%' + rawSearch + '%'} OR 
              c.notes ILIKE ${'%' + rawSearch + '%'} OR 
              cl.name ILIKE ${'%' + rawSearch + '%'}
            ))
          ORDER BY c.date ASC, c."createdAt" ASC
        ),
        alloc_aggs AS (
          SELECT 
            ca."collectionId",
            json_agg(
              json_build_object(
                'id', ca.id,
                'saleId', ca."saleId",
                'allocatedAmount', ca."allocatedAmount"::float,
                'sale', json_build_object(
                  'invoiceNo', s."invoiceNo"
                )
              )
            ) as allocations
          FROM collection_allocations ca
          LEFT JOIN sales s ON s.id = ca."saleId"
          WHERE ca."collectionId" IN (SELECT id FROM page_collections)
          GROUP BY ca."collectionId"
        )
        SELECT 
          pc.*,
          json_build_object(
            'id', cl.id,
            'name', cl.name,
            'clientId', cl."clientId",
            'currentBalance', cl."currentBalance"::float
          ) as client,
          CASE WHEN u.id IS NOT NULL THEN
            json_build_object(
              'id', u.id,
              'name', u.name,
              'role', u.role
            )
          ELSE NULL END as "receivedByUser",
          CASE WHEN cu.id IS NOT NULL THEN
            json_build_object(
              'id', cu.id,
              'name', cu.name,
              'role', cu.role
            )
          ELSE NULL END as "cancelledByUser",
          COALESCE(aa.allocations, '[]'::json) as allocations,
          pc."remainingBalance" as "ledgerBalance"
        FROM page_collections pc
        LEFT JOIN clients cl ON cl.id = pc."clientId"
        LEFT JOIN users u ON u.id = pc."receivedByUserId"
        LEFT JOIN users cu ON cu.id = pc."cancelledByUserId"
        LEFT JOIN alloc_aggs aa ON aa."collectionId" = pc.id
        ORDER BY pc.date ASC, pc."createdAt" ASC
      `;

      let totalAmount = 0;
      let cashAmount = 0;
      let bankAmount = 0;
      let onlineAmount = 0;
      let chequeAmount = 0;
      let otherAmount = 0;
      let cancelledCount = 0;
      let cancelledAmount = 0;

      const byMethod: Record<string, number> = {};
      const byEmployee: Record<string, number> = {};

      const formattedTransactions = collections.map((col: any, index: number) => {
        const amt = col.amount || 0;
        const isCancelled = col.status === 'CANCELLED';

        if (!isCancelled) {
          totalAmount += amt;

          const mUpper = (col.method || 'CASH').toUpperCase();
          byMethod[mUpper] = (byMethod[mUpper] || 0) + amt;

          if (mUpper === 'CASH') cashAmount += amt;
          else if (mUpper === 'BANK' || mUpper === 'BANK_TRANSFER') bankAmount += amt;
          else if (mUpper === 'ONLINE') onlineAmount += amt;
          else if (mUpper === 'CHEQUE') chequeAmount += amt;
          else otherAmount += amt;

          const empName = col.receivedByUser?.name || 'Not Recorded';
          byEmployee[empName] = (byEmployee[empName] || 0) + amt;
        } else {
          cancelledCount++;
          cancelledAmount += amt;
        }

        const mUpper = (col.method || 'CASH').toUpperCase();
        const empName = col.receivedByUser?.name || 'Not Recorded';

        const invoiceNumbers = (col.allocations || [])
          .map((a: any) => a.sale?.invoiceNo)
          .filter(Boolean) as string[];
        const invoiceRefStr = invoiceNumbers.length > 0
          ? invoiceNumbers.join(', ')
          : (col.reference || `PAY-${col.id.slice(-6).toUpperCase()}`);

        const pktTime = new Date(col.date).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
          timeZone: 'Asia/Karachi',
        });

        const clientCurrBal = col.client?.currentBalance ?? 0;
        const rawRemBal = (clientCurrBal <= 0) ? 0 : (col.ledgerBalance ?? col.remainingBalance ?? null);
        const remBal = (rawRemBal !== null && rawRemBal !== undefined && Math.abs(rawRemBal) < 1.0) ? 0 : rawRemBal;

        return {
          seqNo: index + 1,
          id: col.id,
          reference: col.reference || `PAY-${col.id.slice(-6).toUpperCase()}`,
          referenceNo: col.reference || `PAY-${col.id.slice(-6).toUpperCase()}`,
          date: col.date,
          time: pktTime,
          clientId: col.clientId,
          clientCode: col.client?.clientId || 'WH-0000',
          clientName: col.client?.name || 'Customer',
          invoiceNo: invoiceRefStr,
          invoices: invoiceNumbers,
          amount: amt,
          method: mUpper,
          receivedBy: empName,
          receivedByUserId: col.receivedByUserId || null,
          remainingBalance: remBal,
          notes: col.notes || null,
          status: col.status || 'PAID',
          cancelledAt: col.cancelledAt ? col.cancelledAt.toISOString() : null,
          cancelledBy: col.cancelledByUser?.name || null,
          cancelReason: col.cancelReason || null,
        };
      });

      return {
        success: true,
        businessDate: range.businessDateStr,
        summary: {
          totalTransactions: collections.filter((c: any) => c.status !== 'CANCELLED').length,
          totalCollected: totalAmount,
          cashCollected: cashAmount,
          bankCollected: bankAmount,
          onlineCollected: onlineAmount,
          chequeCollected: chequeAmount,
          otherCollected: otherAmount,
          cancelledTransactions: cancelledCount,
          cancelledAmount: cancelledAmount,
          byMethod,
          byEmployee,
        },
        transactions: formattedTransactions,
      };
    })();

    COLLECTIONS_IN_FLIGHT.set(cacheKey, fetchDailyPromise);
    try {
      const responsePayload = await fetchDailyPromise;
      if (COLLECTIONS_CACHE.size > 50) COLLECTIONS_CACHE.clear();
      COLLECTIONS_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      COLLECTIONS_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/collections/daily-history:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load daily payment history' });
  }
});

// GET /api/collections
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, employeeId, method, search, from, to, limit: limitQuery } = req.query;
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 1000) : (clientId || from || to ? 200 : 100);

    const normFrom = from ? getBusinessDateString(getBusinessDateRange(String(from)).start) : 'all';
    const normTo = to ? getBusinessDateString(getBusinessDateRange(String(to)).end) : 'all';
    const cacheKey = `list_${branchId || 'all'}_${clientId || 'all'}_${employeeId || 'all'}_${method || 'all'}_${search ? String(search).trim().toLowerCase() : 'all'}_${normFrom}_${normTo}_${limit}`;
    const cached = COLLECTIONS_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < COLLECTIONS_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    if (COLLECTIONS_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await COLLECTIONS_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const fetchCollectionsPromise = (async () => {
      const dateFrom = from ? getBusinessDateRange(String(from)).start : null;
      const dateTo = to ? getBusinessDateRange(String(to)).end : null;

      if (dateFrom && isNaN(dateFrom.getTime())) {
        throw new Error('Invalid from date');
      }
      if (dateTo && isNaN(dateTo.getTime())) {
        throw new Error('Invalid to date');
      }

      const rawBranchId = branchId || '';
      const rawClientId = clientId ? String(clientId) : '';
      const rawEmployeeId = employeeId && employeeId !== 'all' ? String(employeeId) : '';
      const rawMethod = method && method !== 'all' ? String(method).toUpperCase() : '';
      const rawSearch = search ? String(search).trim() : '';

      const collections: any[] = await prisma.$queryRaw`
        WITH page_collections AS (
          SELECT 
            c.id,
            c."clientId",
            c.amount::float as amount,
            c.method,
            c."cashAccountId",
            c."bankAccountId",
            c."receivedByUserId",
            c."remainingBalance"::float as "remainingBalance",
            c.date,
            c.reference,
            c.notes,
            c."branchId",
            c."createdAt",
            c."deletedAt",
            COALESCE(c.status::text, 'PAID') as status,
            c."cancelledAt",
            c."cancelledByUserId",
            c."cancelReason"
          FROM collections c
          LEFT JOIN clients cl ON cl.id = c."clientId"
          WHERE c."deletedAt" IS NULL 
            AND (${rawBranchId} = '' OR c."branchId" = ${rawBranchId})
            AND (${rawClientId} = '' OR c."clientId" = ${rawClientId})
            AND (${rawEmployeeId} = '' OR c."receivedByUserId" = ${rawEmployeeId})
            AND (${rawMethod} = '' OR c.method::text = ${rawMethod})
            AND (${dateFrom}::timestamptz IS NULL OR c.date >= ${dateFrom}::timestamptz)
            AND (${dateTo}::timestamptz IS NULL OR c.date <= ${dateTo}::timestamptz)
            AND (${rawSearch} = '' OR (
              c.reference ILIKE ${'%' + rawSearch + '%'} OR 
              c.notes ILIKE ${'%' + rawSearch + '%'} OR 
              cl.name ILIKE ${'%' + rawSearch + '%'}
            ))
          ORDER BY c.date DESC, c."createdAt" DESC
          LIMIT ${limit}
        ),
        alloc_aggs AS (
          SELECT 
            ca."collectionId",
            json_agg(
              json_build_object(
                'id', ca.id,
                'saleId', ca."saleId",
                'allocatedAmount', ca."allocatedAmount"::float,
                'sale', json_build_object(
                  'invoiceNo', s."invoiceNo"
                )
              )
            ) as allocations
          FROM collection_allocations ca
          LEFT JOIN sales s ON s.id = ca."saleId"
          WHERE ca."collectionId" IN (SELECT id FROM page_collections)
          GROUP BY ca."collectionId"
        )
        SELECT 
          pc.*,
          json_build_object(
            'id', cl.id,
            'name', cl.name,
            'clientId', cl."clientId",
            'currentBalance', cl."currentBalance"::float
          ) as client,
          CASE WHEN u.id IS NOT NULL THEN
            json_build_object(
              'id', u.id,
              'name', u.name,
              'role', u.role
            )
          ELSE NULL END as "receivedByUser",
          CASE WHEN cu.id IS NOT NULL THEN
            json_build_object(
              'id', cu.id,
              'name', cu.name,
              'role', cu.role
            )
          ELSE NULL END as "cancelledByUser",
          COALESCE(aa.allocations, '[]'::json) as allocations,
          pc."remainingBalance" as "ledgerBalance"
        FROM page_collections pc
        LEFT JOIN clients cl ON cl.id = pc."clientId"
        LEFT JOIN users u ON u.id = pc."receivedByUserId"
        LEFT JOIN users cu ON cu.id = pc."cancelledByUserId"
        LEFT JOIN alloc_aggs aa ON aa."collectionId" = pc.id
        ORDER BY pc.date DESC, pc."createdAt" DESC
      `;

      if (collections.length === 0) {
        return {
          success: true,
          data: [],
          summary: { totalAmount: 0, count: 0, byMethod: {}, byEmployee: {} }
        };
      }

      const data = collections.map(c => {
        const clientCurrBal = c.client?.currentBalance ?? 0;
        const rawRemBal = (clientCurrBal <= 0) ? 0 : (c.ledgerBalance ?? c.remainingBalance ?? null);
        const remBal = (rawRemBal !== null && rawRemBal !== undefined && Math.abs(rawRemBal) < 1.0) ? 0 : rawRemBal;
        return {
          ...c,
          status: c.status || 'PAID',
          remainingBalance: remBal,
          runningBalance: remBal
        };
      });

      const activeCollections = collections.filter(c => c.status !== 'CANCELLED');
      const totalAmount = activeCollections.reduce((sum, c) => sum + (c.amount || 0), 0);
      const count = activeCollections.length;
      const byMethod: { [key: string]: number } = {};
      const byEmployee: { [key: string]: number } = {};

      activeCollections.forEach(c => {
        const m = c.method || 'CASH';
        byMethod[m] = (byMethod[m] || 0) + (c.amount || 0);
        const empName = c.receivedByUser?.name || 'Unrecorded (Historical)';
        byEmployee[empName] = (byEmployee[empName] || 0) + (c.amount || 0);
      });

      return {
        success: true,
        data,
        summary: {
          totalAmount,
          count,
          byMethod,
          byEmployee,
        }
      };
    })();

    COLLECTIONS_IN_FLIGHT.set(cacheKey, fetchCollectionsPromise);
    try {
      const responsePayload = await fetchCollectionsPromise;
      if (COLLECTIONS_CACHE.size > 50) {
        const oldestKey = COLLECTIONS_CACHE.keys().next().value;
        if (oldestKey) COLLECTIONS_CACHE.delete(oldestKey);
      }
      COLLECTIONS_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json(responsePayload);
    } finally {
      COLLECTIONS_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/collections:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load collections' });
  }
});

// GET /api/collections/preview — Pre-calculation & FIFO Allocation Preview
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, amount, saleId } = req.query;

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }

    const client = await prisma.client.findUnique({
      where: { id: String(clientId), deletedAt: null },
      select: { id: true, name: true, currentBalance: true, openingBalance: true }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    const amountNum = Math.max(0, Number(amount || 0));
    let targetSale: any = null;
    if (saleId && String(saleId).trim()) {
      targetSale = await prisma.sale.findUnique({
        where: { id: String(saleId) }
      });
    }

    const previousBalance = await getAuthoritativeClientOutstanding(client.id);
    const currentBillAmount = targetSale ? targetSale.balance : 0;
    // Total Payable is the total client dues (which already incorporates previous balances and invoices)
    const totalPayable = Math.max(0, previousBalance);
    const amountReceived = amountNum;
    const remainingBalance = Math.max(0, totalPayable - amountReceived);
    const excessPayment = Math.max(0, amountReceived - totalPayable);

    // Calculate FIFO Payment Allocations
    let unpaidSales = await prisma.sale.findMany({
      where: {
        clientId: client.id,
        ...(branchId ? { branchId } : {}),
        status: { in: ['PENDING', 'PARTIAL'] },
        deletedAt: null,
      },
      select: {
        id: true,
        invoiceNo: true,
        date: true,
        total: true,
        paid: true,
        balance: true,
        status: true,
        clientId: true,
        previousBalance: true,
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });

    if (targetSale && ['PENDING', 'PARTIAL'].includes(targetSale.status)) {
      unpaidSales = [targetSale, ...unpaidSales.filter(s => s.id !== targetSale.id)];
    }

    let remainingPayment = amountNum;
    const allocations: Array<{
      saleId: string;
      invoiceNo: string;
      date: string;
      invoiceTotal: number;
      previousPaid: number;
      previousBalance: number;
      allocatedAmount: number;
      remainingBalance: number;
      newStatus: string;
    }> = [];

    for (const sale of unpaidSales) {
      if (remainingPayment <= 0) break;
      const toApply = Math.min(remainingPayment, sale.balance);
      const newPaid = sale.paid + toApply;
      const rawBal = sale.total - newPaid;
      const newBal = rawBal < 1.0 ? 0 : Math.max(0, rawBal);
      const newStatus = newBal <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : sale.status);

      allocations.push({
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        date: sale.date.toISOString(),
        invoiceTotal: sale.total,
        previousPaid: sale.paid,
        previousBalance: sale.balance,
        allocatedAmount: toApply,
        remainingBalance: newBal,
        newStatus,
      });

      remainingPayment -= toApply;
    }

    return res.json({
      success: true,
      data: {
        client: { id: client.id, name: client.name },
        previousBalance,
        currentBillAmount,
        totalPayable,
        amountReceived,
        remainingBalance,
        excessPayment,
        allocations,
      }
    });
  } catch (err: any) {
    console.error('Error in GET /api/collections/preview:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to calculate payment preview' });
  }
});

// POST /api/collections — Record payment with atomic FIFO allocation & running balance update
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { clientId, saleId, amount, method = 'CASH', reference, notes, date, manualAllocations } = req.body;

  const numAmount = Number(amount);
  if (!clientId || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Valid client and positive payment amount are required' });
  }

  const validMethod = ['CASH', 'BANK', 'CHEQUE', 'ONLINE'].includes(method) ? method : 'CASH';

  const client = await prisma.client.findUnique({ where: { id: clientId, deletedAt: null } });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  // Idempotency / Duplicate Check: Prevent accidental double-clicking within 5 seconds
  const recentDuplicate = await prisma.collection.findFirst({
    where: {
      clientId,
      amount: numAmount,
      deletedAt: null,
      createdAt: { gte: new Date(Date.now() - 5000) }
    }
  });
  if (recentDuplicate) {
    return res.status(409).json({ success: false, error: 'Duplicate payment detected. Please wait a moment before submitting again.' });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      // 1. Authoritative Outstanding Check: Check client current balance under transaction lock
      const clientObj = await tx.client.findUnique({ where: { id: clientId } });
      const authoritativeOutstanding = clientObj?.currentBalance ?? 0;
      const roundedOutstanding = Math.max(0, Math.round((authoritativeOutstanding + Number.EPSILON) * 100) / 100);

      // Financial Overpayment Check: Client has no outstanding dues
      if (roundedOutstanding <= 0.001) {
        const err: any = new Error(`Client has no outstanding balance (Current Due: Rs 0). Payment cannot be recorded.`);
        err.statusCode = 422;
        err.code = 'PAYMENT_EXCEEDS_OUTSTANDING';
        err.outstanding = 0;
        err.attempted = numAmount;
        throw err;
      }

      // Financial Overpayment Check: Payment exceeds authoritative current outstanding
      const roundedMaxOutstanding = Math.round(roundedOutstanding);
      if (numAmount > roundedOutstanding + 0.99 && numAmount > roundedMaxOutstanding) {
        const err: any = new Error(
          `Payment amount (Rs ${numAmount.toLocaleString()}) cannot exceed the current outstanding balance of Rs ${roundedMaxOutstanding.toLocaleString()}.`
        );
        err.statusCode = 422;
        err.code = 'PAYMENT_EXCEEDS_OUTSTANDING';
        err.outstanding = roundedOutstanding;
        err.attempted = numAmount;
        throw err;
      }

      let targetSale = null;
      if (saleId && String(saleId).trim()) {
        targetSale = await tx.sale.findUnique({ where: { id: String(saleId) } });
        const roundedSaleBalance = Math.round(targetSale?.balance || 0);
        if (targetSale && numAmount > targetSale.balance + 0.99 && numAmount > roundedSaleBalance) {
          const err: any = new Error(
            `Payment amount (Rs ${numAmount.toLocaleString()}) cannot exceed invoice remaining balance of Rs ${roundedSaleBalance.toLocaleString()}.`
          );
          err.statusCode = 422;
          err.code = 'PAYMENT_EXCEEDS_OUTSTANDING';
          err.outstanding = targetSale.balance;
          err.attempted = numAmount;
          throw err;
        }
      }

      const previousBalance = roundedOutstanding;
      const currentBillAmount = targetSale ? targetSale.balance : 0;
      const totalPayable = roundedOutstanding;
      const amountReceived = numAmount;
      const remainingBalance = Math.max(0, totalPayable - amountReceived);
      const excessPayment = 0;

      // Determine receivedByUserId strictly from authenticated user token
      let receivedByUserId: string | undefined = undefined;
      if (userId) {
        const u = await tx.user.findUnique({ where: { id: userId } });
        if (u) receivedByUserId = u.id;
      }

      // Create Collection master record
      let coll = await tx.collection.create({
        data: {
          clientId,
          branchId,
          amount: numAmount,
          method: validMethod as any,
          date: date ? parseInputDateToUtc(date) : parseInputDateToUtc(),
          reference: reference || (targetSale ? `INV-${targetSale.invoiceNo}` : undefined),
          notes: notes || (targetSale ? `Payment for Invoice ${targetSale.invoiceNo}` : undefined),
          receivedByUserId,
          remainingBalance: remainingBalance,
        },
        include: {
          client: { select: { id: true, name: true, clientId: true } },
          receivedByUser: { select: { id: true, name: true, role: true } },
        },
      });

      // Customer Ledger Entry (Credit decreases customer dues / increases advance credit)
      const ledgerRes = await recordCustomerLedgerEntry(tx, {
        clientId,
        branchId,
        type: 'PAYMENT',
        date: coll.date,
        referenceId: coll.id,
        referenceNo: targetSale ? targetSale.invoiceNo : `PAY-${coll.id.slice(-6).toUpperCase()}`,
        description: targetSale ? `Payment for Invoice ${targetSale.invoiceNo}` : `Payment Received (${coll.method})`,
        debit: 0,
        credit: numAmount,
      });

      // Update exact post-ledger remaining balance on collection
      coll = await tx.collection.update({
        where: { id: coll.id },
        data: { remainingBalance: ledgerRes.balance },
        include: {
          client: { select: { id: true, name: true, clientId: true } },
          receivedByUser: { select: { id: true, name: true, role: true } },
        },
      });

      // Single authoritative allocation & financial ledger synchronization
      await reconcileClientBalancesAndAllocations(clientId, tx);

      await updateClientCreditRating(clientId, tx);

      await postCollectionLedger(tx, {
        branchId,
        collectionId: coll.id,
        clientId,
        date: coll.date,
        amount: coll.amount,
        method: coll.method,
        reference: coll.reference || undefined,
      });

      const allocationsData = await tx.collectionAllocation.findMany({
        where: { collectionId: coll.id },
        include: { sale: { select: { id: true, invoiceNo: true, date: true, total: true, paid: true, balance: true, status: true } } }
      });

      const formattedAllocations = allocationsData.map(a => ({
        saleId: a.saleId,
        invoiceNo: a.sale?.invoiceNo || '',
        date: a.sale?.date ? a.sale.date.toISOString() : '',
        invoiceTotal: a.sale?.total || 0,
        previousPaid: (a.sale?.paid || 0) - a.allocatedAmount,
        previousBalance: (a.sale?.balance || 0) + a.allocatedAmount,
        allocatedAmount: a.allocatedAmount,
        remainingBalance: a.sale?.balance || 0,
        newStatus: a.sale?.status || 'PENDING',
      }));

      return {
        collection: coll,
        summary: {
          previousBalance,
          currentBillAmount,
          totalPayable,
          amountReceived,
          remainingBalance: ledgerRes.balance,
          excessPayment,
        },
        allocations: formattedAllocations,
      };
    }, { maxWait: 15000, timeout: 120000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CREATE',
      entity: 'Collection',
      entityId: result.collection.id,
      newData: { clientId, amount: numAmount, summary: result.summary, allocationsCount: result.allocations.length }
    });

    clearCollectionsCache();

    return res.status(201).json({
      success: true,
      data: {
        ...result.collection,
        summary: result.summary,
        allocations: result.allocations,
      }
    });
  } catch (err: any) {
    console.error('[POST /api/collections]', err);
    const status = err.statusCode || (err.code === 'PAYMENT_EXCEEDS_OUTSTANDING' ? 422 : 500);
    return res.status(status).json({
      success: false,
      code: err.code || 'COLLECTION_ERROR',
      error: err.message ?? 'Internal server error',
      outstanding: err.outstanding,
      attempted: err.attempted,
    });
  }
});

// POST /api/collections/reconcile-all — Global Multi-Client Reconciliation Engine
router.post('/reconcile-all', async (req: Request, res: Response) => {
  try {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, clientId: true }
    });

    const results: any[] = [];
    for (const c of clients) {
      const outcome = await prisma.$transaction(async tx => {
        return reconcileClientBalancesAndAllocations(c.id, tx);
      });
      results.push({
        clientId: c.id,
        clientCode: c.clientId,
        name: c.name,
        currentBalance: outcome.clientBalance,
        reconciledAllocations: outcome.reconciledAllocations
      });
    }

    clearCollectionsCache();

    return res.json({
      success: true,
      message: `Reconciled ${clients.length} clients successfully`,
      data: results
    });
  } catch (err: any) {
    console.error('[POST /api/collections/reconcile-all]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Reconciliation failed' });
  }
});

// POST /api/collections/:id/cancel — Production-Safe Payment Cancellation & Full Financial Reversal
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = (req.headers['x-user-id'] as string) || (req.user as any)?.id || (req.user as any)?.sub || null;
  const userRole = (req.headers['x-user-role'] as string) || (req.user as any)?.role;
  const branchId = (req.headers['x-branch-id'] as string) || undefined;

  // 1. Authorization: Only administrative roles (ADMIN, OWNER, MANAGER, SUPER_ADMIN, SUPERVISOR) may cancel payments
  const AUTHORIZED_ROLES = ['ADMIN', 'OWNER', 'MANAGER', 'SUPER_ADMIN', 'SUPERVISOR'];
  if (userRole && !AUTHORIZED_ROLES.includes(userRole.toUpperCase())) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized: Only administrators and managers are authorized to cancel payments.'
    });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      // 1. Lock/read payment
      const collection = await tx.collection.findUnique({
        where: { id, deletedAt: null },
        include: {
          client: true,
          allocations: {
            include: { sale: { select: { id: true, invoiceNo: true, total: true, paid: true, balance: true, status: true } } }
          }
        }
      });

      if (!collection) {
        const err: any = new Error('Payment collection not found');
        err.statusCode = 404;
        throw err;
      }

      // 2. Verify payment is still ACTIVE (Prevent duplicate/concurrent cancellation)
      if (collection.status === 'CANCELLED') {
        const err: any = new Error('This payment has already been cancelled.');
        err.statusCode = 409;
        throw err;
      }

      // 3. Mark payment as CANCELLED with audit metadata (NEVER delete)
      const cancelledCollection = await tx.collection.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: userId,
          cancelReason: reason || 'Payment Cancellation',
        },
        include: {
          client: { select: { id: true, name: true, clientId: true, currentBalance: true } },
          receivedByUser: { select: { id: true, name: true, role: true } },
          cancelledByUser: { select: { id: true, name: true, role: true } },
        }
      });

      // 4. Reverse Customer Ledger Effect: Create CANCELLATION debit entry (increases customer receivable / restored dues)
      const refNo = collection.reference || `PAY-${collection.id.slice(-6).toUpperCase()}`;
      await recordCustomerLedgerEntry(tx, {
        clientId: collection.clientId,
        branchId: collection.branchId,
        type: 'CANCELLATION',
        date: new Date(),
        referenceId: collection.id,
        referenceNo: refNo,
        description: `Payment Cancelled (${collection.method}) — ${reason || 'Reversal'}`,
        debit: collection.amount,
        credit: 0,
      });

      // 5. Post Financial Ledger Reversal (Credit ASSET_CASH, Debit ASSET_RECEIVABLE)
      await postCollectionCancellationLedger(tx, {
        branchId: collection.branchId,
        collectionId: collection.id,
        clientId: collection.clientId,
        date: new Date(),
        amount: collection.amount,
        method: collection.method,
        reference: refNo,
        reason: reason || 'Payment Cancellation',
      });

      // 6. Authoritative Allocation & Customer Ledger Re-reconciliation (Unrolls allocations, restores invoice balances & status, rebuilds client balance)
      const outcome = await reconcileClientBalancesAndAllocations(collection.clientId, tx);
      await updateClientCreditRating(collection.clientId, tx);

      return {
        collection: cancelledCollection,
        restoredClientBalance: outcome.clientBalance,
        reconciledAllocationsCount: outcome.reconciledAllocations,
      };
    }, { maxWait: 15000, timeout: 120000 });

    // 7. Audit Log
    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: branchId || result.collection.branchId,
      action: 'CANCEL',
      entity: 'Collection',
      entityId: id,
      newData: {
        amount: result.collection.amount,
        reason: reason || 'Payment Cancellation',
        restoredClientBalance: result.restoredClientBalance,
        status: 'CANCELLED'
      }
    });

    // 8. Invalidate Caches
    clearCollectionsCache();

    return res.json({
      success: true,
      message: `Payment of Rs ${result.collection.amount.toLocaleString()} cancelled successfully. Client outstanding restored.`,
      data: result.collection,
      restoredClientBalance: result.restoredClientBalance,
    });
  } catch (err: any) {
    console.error('[POST /api/collections/:id/cancel]', err);
    const statusCode = err.statusCode || (err.message?.includes('already been cancelled') ? 409 : err.message?.includes('not found') ? 404 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message ?? 'Failed to cancel payment collection'
    });
  }
});

// DELETE /api/collections/:id — Safe Cancellation Route
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const reason = (req.body?.reason as string) || 'Deleted via Collection Management';
  const userId = (req.headers['x-user-id'] as string) || (req.user as any)?.id || (req.user as any)?.sub || null;
  const userRole = (req.headers['x-user-role'] as string) || (req.user as any)?.role;
  const branchId = (req.headers['x-branch-id'] as string) || undefined;

  const AUTHORIZED_ROLES = ['ADMIN', 'OWNER', 'MANAGER', 'SUPER_ADMIN', 'SUPERVISOR'];
  if (userRole && !AUTHORIZED_ROLES.includes(userRole.toUpperCase())) {
    return res.status(403).json({
      success: false,
      error: 'Unauthorized: Only administrators and managers are authorized to cancel payments.'
    });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      const collection = await tx.collection.findUnique({
        where: { id, deletedAt: null },
      });

      if (!collection) {
        const err: any = new Error('Payment collection not found');
        err.statusCode = 404;
        throw err;
      }

      if (collection.status === 'CANCELLED') {
        const err: any = new Error('This payment has already been cancelled.');
        err.statusCode = 409;
        throw err;
      }

      const cancelledCollection = await tx.collection.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: userId,
          cancelReason: reason,
        },
        include: {
          client: { select: { id: true, name: true, clientId: true, currentBalance: true } },
          receivedByUser: { select: { id: true, name: true, role: true } },
          cancelledByUser: { select: { id: true, name: true, role: true } },
        }
      });

      const refNo = collection.reference || `PAY-${collection.id.slice(-6).toUpperCase()}`;
      await recordCustomerLedgerEntry(tx, {
        clientId: collection.clientId,
        branchId: collection.branchId,
        type: 'CANCELLATION',
        date: new Date(),
        referenceId: collection.id,
        referenceNo: refNo,
        description: `Payment Cancelled (${collection.method}) — ${reason}`,
        debit: collection.amount,
        credit: 0,
      });

      await postCollectionCancellationLedger(tx, {
        branchId: collection.branchId,
        collectionId: collection.id,
        clientId: collection.clientId,
        date: new Date(),
        amount: collection.amount,
        method: collection.method,
        reference: refNo,
        reason,
      });

      const outcome = await reconcileClientBalancesAndAllocations(collection.clientId, tx);
      await updateClientCreditRating(collection.clientId, tx);

      return {
        collection: cancelledCollection,
        restoredClientBalance: outcome.clientBalance,
      };
    }, { maxWait: 15000, timeout: 120000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: branchId || result.collection.branchId,
      action: 'CANCEL',
      entity: 'Collection',
      entityId: id,
      newData: {
        amount: result.collection.amount,
        reason,
        restoredClientBalance: result.restoredClientBalance,
        status: 'CANCELLED'
      }
    });

    clearCollectionsCache();

    return res.json({
      success: true,
      message: `Payment of Rs ${result.collection.amount.toLocaleString()} cancelled successfully. Client outstanding restored.`,
      data: result.collection,
      restoredClientBalance: result.restoredClientBalance,
    });
  } catch (err: any) {
    console.error('[DELETE /api/collections/:id]', err);
    const statusCode = err.statusCode || (err.message?.includes('already been cancelled') ? 409 : err.message?.includes('not found') ? 404 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message ?? 'Failed to cancel payment'
    });
  }
});

export default router;

