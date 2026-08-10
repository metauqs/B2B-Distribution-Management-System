import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { recordCustomerLedgerEntry, writeAuditLog, recalculateClientLedgerAndBalance } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { getBusinessDateRange, getBusinessDateString, formatPKTDateTime, parseInputDateToUtc } from '../lib/businessDate';
import { postCollectionLedger } from '../lib/financialLedgerService';

const router = Router();

// GET /api/collections/daily-history — Server-Side 5 AM Business Day Aggregation & Payment List
router.get('/daily-history', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { date, employeeId, method, clientId, search } = req.query;

    const targetDateStr = date ? String(date) : undefined;
    const range = getBusinessDateRange(targetDateStr);

    const where: any = {
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      date: {
        gte: range.start,
        lte: range.end,
      },
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(employeeId && employeeId !== 'all' ? { receivedByUserId: String(employeeId) } : {}),
      ...(method && method !== 'all' ? { method: String(method).toUpperCase() } : {}),
      ...(search ? {
        OR: [
          { reference: { contains: String(search), mode: 'insensitive' } },
          { notes: { contains: String(search), mode: 'insensitive' } },
          { client: { name: { contains: String(search), mode: 'insensitive' } } },
        ]
      } : {}),
    };

    const collections = await prisma.collection.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, clientId: true } },
        receivedByUser: { select: { id: true, name: true, role: true } },
        allocations: {
          include: {
            sale: { select: { id: true, invoiceNo: true } }
          }
        }
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });

    const collectionIds = collections.map(c => c.id);
    const ledgers = collectionIds.length > 0 ? await prisma.customerLedger.findMany({
      where: { referenceId: { in: collectionIds }, type: 'PAYMENT' }
    }) : [];

    const ledgerMap = Object.fromEntries(ledgers.map(l => [l.referenceId, l.balance]));

    let totalAmount = 0;
    let cashAmount = 0;
    let bankAmount = 0;
    let onlineAmount = 0;
    let chequeAmount = 0;
    let otherAmount = 0;

    const byMethod: Record<string, number> = {};
    const byEmployee: Record<string, number> = {};

    const formattedTransactions = collections.map((col: any, index: number) => {
      const amt = col.amount || 0;
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
      const rawRemBal = (clientCurrBal <= 0) ? 0 : (col.remainingBalance ?? ledgerMap[col.id] ?? null);
      const remBal = (rawRemBal !== null && rawRemBal !== undefined && Math.abs(rawRemBal) < 1.0) ? 0 : rawRemBal;

      return {
        seqNo: index + 1,
        id: col.id,
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
        status: 'COMPLETED',
      };
    });

    return res.json({
      success: true,
      businessDate: range.businessDateStr,
      summary: {
        totalTransactions: collections.length,
        totalCollected: totalAmount,
        cashCollected: cashAmount,
        bankCollected: bankAmount,
        onlineCollected: onlineAmount,
        chequeCollected: chequeAmount,
        otherCollected: otherAmount,
        byMethod,
        byEmployee,
      },
      transactions: formattedTransactions,
    });
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
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 500) : 100;

    const dateFrom = from ? getBusinessDateRange(String(from)).start : undefined;
    const dateTo = to ? getBusinessDateRange(String(to)).end : undefined;

    if (dateFrom && isNaN(dateFrom.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid from date' });
    }
    if (dateTo && isNaN(dateTo.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid to date' });
    }

    const where: any = {
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(employeeId ? { receivedByUserId: String(employeeId) } : {}),
      ...(method && method !== 'all' ? { method: String(method).toUpperCase() } : {}),
      ...(search ? {
        OR: [
          { reference: { contains: String(search), mode: 'insensitive' } },
          { notes: { contains: String(search), mode: 'insensitive' } },
          { client: { name: { contains: String(search), mode: 'insensitive' } } },
        ]
      } : {}),
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {}),
        }
      } : {}),
    };

    const collections = await prisma.collection.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, clientId: true } },
        receivedByUser: { select: { id: true, name: true, role: true } },
        allocations: {
          include: {
            sale: { select: { id: true, invoiceNo: true, date: true, total: true, paid: true, balance: true, status: true } }
          }
        }
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    if (collections.length === 0) {
      return res.json({
        success: true,
        data: [],
        summary: { totalAmount: 0, count: 0, byMethod: {}, byEmployee: {} }
      });
    }

    const collectionIds = collections.map(c => c.id);
    const ledgers = await prisma.customerLedger.findMany({
      where: { referenceId: { in: collectionIds }, type: 'PAYMENT' }
    });

    const ledgerMap = Object.fromEntries(ledgers.map(l => [l.referenceId, l.balance]));

    const data = collections.map(c => {
      const rawRemBal = c.remainingBalance ?? ledgerMap[c.id] ?? null;
      const remBal = (rawRemBal !== null && rawRemBal !== undefined && Math.abs(rawRemBal) < 1.0) ? 0 : rawRemBal;
      return {
        ...c,
        remainingBalance: remBal,
        runningBalance: remBal
      };
    });

    const totalAmount = collections.reduce((sum, c) => sum + c.amount, 0);
    const count = collections.length;
    const byMethod: { [key: string]: number } = {};
    const byEmployee: { [key: string]: number } = {};

    collections.forEach(c => {
      byMethod[c.method] = (byMethod[c.method] || 0) + c.amount;
      const empName = c.receivedByUser?.name || 'Unrecorded (Historical)';
      byEmployee[empName] = (byEmployee[empName] || 0) + c.amount;
    });

    return res.json({
      success: true,
      data,
      summary: {
        totalAmount,
        count,
        byMethod,
        byEmployee,
      }
    });
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

    const previousBalance = client.currentBalance;
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
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
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
      const currentClient = await tx.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, currentBalance: true }
      });

      let targetSale = null;
      if (saleId && String(saleId).trim()) {
        targetSale = await tx.sale.findUnique({ where: { id: String(saleId) } });
      }

      const previousBalance = currentClient?.currentBalance ?? 0;
      const currentBillAmount = targetSale ? targetSale.balance : 0;
      const totalPayable = Math.max(0, previousBalance);
      const amountReceived = numAmount;
      const remainingBalance = Math.max(0, totalPayable - amountReceived);
      const excessPayment = Math.max(0, amountReceived - totalPayable);

      // Determine receivedByUserId strictly from authenticated user token (No hardcoded fallback!)
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

      // Payment Allocations (FIFO by default, or manual allocations if specified)
      let unpaidSales = await tx.sale.findMany({
        where: {
          clientId,
          branchId,
          status: { in: ['PENDING', 'PARTIAL'] },
          deletedAt: null,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      });

      let remainingPayment = numAmount;
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

      if (Array.isArray(manualAllocations) && manualAllocations.length > 0) {
        // Manual Allocation Mode
        for (const item of manualAllocations) {
          if (remainingPayment <= 0) break;
          const sId = String(item.saleId);
          const requestedAlloc = Math.max(0, Number(item.amount || 0));
          if (requestedAlloc <= 0) continue;

          const sale = unpaidSales.find(s => s.id === sId) || await tx.sale.findUnique({ where: { id: sId } });
          if (!sale) continue;

          const toApply = Math.min(remainingPayment, sale.balance, requestedAlloc);
          if (toApply <= 0) continue;

          const newPaid = sale.paid + toApply;
          const rawBal = sale.total - newPaid;
          const newBal = rawBal < 1.0 ? 0 : Math.max(0, rawBal);
          const newStatus = newBal <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : sale.status);

          await tx.sale.update({
            where: { id: sale.id },
            data: { paid: newPaid, balance: newBal, status: newStatus as any }
          });

          await tx.collectionAllocation.create({
            data: {
              collectionId: coll.id,
              saleId: sale.id,
              allocatedAmount: toApply,
            }
          });

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
      } else {
        // Automatic FIFO Allocation Mode
        for (const sale of unpaidSales) {
          if (remainingPayment <= 0) break;
          const toApply = Math.min(remainingPayment, sale.balance);
          const newPaid = sale.paid + toApply;
          const rawBal = sale.total - newPaid;
          const newBal = rawBal < 1.0 ? 0 : Math.max(0, rawBal);
          const newStatus = newBal <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : sale.status);

          await tx.sale.update({
            where: { id: sale.id },
            data: { paid: newPaid, balance: newBal, status: newStatus as any }
          });

          await tx.collectionAllocation.create({
            data: {
              collectionId: coll.id,
              saleId: sale.id,
              allocatedAmount: toApply,
            }
          });

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
      }

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
        allocations,
      };
    }, { maxWait: 10000, timeout: 30000 });

    // Self-healing trigger: Ensure client balance & running ledger are perfectly recalculated and synced
    try {
      await recalculateClientLedgerAndBalance(clientId);
    } catch (e) {
      console.error('[POST /api/collections] Self-heal error:', e);
    }

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CREATE',
      entity: 'Collection',
      entityId: result.collection.id,
      newData: { clientId, amount: numAmount, summary: result.summary, allocationsCount: result.allocations.length }
    });

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
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

export default router;

