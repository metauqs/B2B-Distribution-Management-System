import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { recordCustomerLedgerEntry, writeAuditLog } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { getBusinessDateRange } from '../lib/businessDate';

const router = Router();

// GET /api/collections
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, from, to, limit: limitQuery } = req.query;
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
      ...(dateFrom || dateTo ? {
        date: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {}),
        }
      } : {}),
    };

    const collections = await prisma.collection.findMany({
      where,
      include: { client: { select: { id: true, name: true } } },
      orderBy: { date: 'asc' },
      take: limit,
    });

    if (collections.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const collectionIds = collections.map(c => c.id);
    const ledgers = await prisma.customerLedger.findMany({
      where: { referenceId: { in: collectionIds }, type: 'PAYMENT' }
    });

    const ledgerMap = Object.fromEntries(ledgers.map(l => [l.referenceId, l.balance]));

    const data = collections.map(c => ({
      ...c,
      runningBalance: ledgerMap[c.id] ?? null
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('Error in GET /api/collections:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load collections' });
  }
});

// POST /api/collections
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { clientId, saleId, amount, method = 'CASH', reference, notes, date } = req.body;

  if (!clientId || !amount || amount <= 0) {
    return res.status(400).json({ success: false, error: 'Client and amount are required' });
  }

  const validMethod = ['CASH', 'BANK', 'CHEQUE', 'ONLINE'].includes(method) ? method : 'CASH';

  const client = await prisma.client.findUnique({ where: { id: clientId, deletedAt: null } });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  try {
    const collection = await prisma.$transaction(async tx => {
      let targetSale = null;
      if (saleId) {
        targetSale = await tx.sale.findUnique({ where: { id: saleId } });
        if (targetSale && amount > targetSale.balance) {
          throw new Error(`Payment amount (Rs ${amount.toLocaleString()}) cannot exceed invoice due balance (Rs ${targetSale.balance.toLocaleString()})`);
        }
      }

      const coll = await tx.collection.create({
        data: {
          clientId,
          branchId,
          amount,
          method: validMethod as any,
          date: date ? new Date(date) : new Date(),
          reference: reference || (targetSale ? `INV-${targetSale.invoiceNo}` : undefined),
          notes: notes || (targetSale ? `Payment for Invoice ${targetSale.invoiceNo}` : undefined),
        },
        include: { client: { select: { id: true, name: true } } },
      });

      await recordCustomerLedgerEntry(tx, {
        clientId,
        branchId,
        type: 'PAYMENT',
        date: coll.date,
        referenceId: coll.id,
        referenceNo: targetSale ? targetSale.invoiceNo : `PAY-${coll.id.slice(-6).toUpperCase()}`,
        description: targetSale ? `Payment for Invoice ${targetSale.invoiceNo}` : `Payment Received (${coll.method})`,
        debit: 0,
        credit: amount,
      });

      let remaining = amount;
      if (targetSale && ['PENDING', 'PARTIAL'].includes(targetSale.status)) {
        const toApply = Math.min(remaining, targetSale.balance);
        const newPaid = targetSale.paid + toApply;
        const newBal = targetSale.total - newPaid;
        const newStatus = newBal <= 0 ? 'PAID' : 'PARTIAL';
        await tx.sale.update({
          where: { id: targetSale.id },
          data: { paid: newPaid, balance: newBal, status: newStatus as any }
        });
        remaining -= toApply;
      }

      if (remaining > 0) {
        const unpaidSales = await tx.sale.findMany({
          where: { clientId, branchId, status: { in: ['PENDING', 'PARTIAL'] }, deletedAt: null, id: saleId ? { not: saleId } : undefined },
          orderBy: { date: 'asc' },
        });

        for (const sale of unpaidSales) {
          if (remaining <= 0) break;
          const toApply = Math.min(remaining, sale.balance);
          const newPaid = sale.paid + toApply;
          const newBal = sale.total - newPaid;
          const newStatus = newBal <= 0 ? 'PAID' : 'PARTIAL';

          await tx.sale.update({
            where: { id: sale.id },
            data: { paid: newPaid, balance: newBal, status: newStatus as any },
          });
          remaining -= toApply;
        }
      }

      await updateClientCreditRating(clientId, tx);

      return coll;
    }, { maxWait: 10000, timeout: 30000 });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Collection', entityId: collection.id, newData: { clientId, amount } });
    return res.status(201).json({ success: true, data: collection });
  } catch (err: any) {
    console.error('[POST /api/collections]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

export default router;
