import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, generateClientId, recordCustomerLedgerEntry, recalculateClientLedgerAndBalance } from '../lib/business';
import { Prisma } from '@prisma/client';
import { calculateClientCreditRisk, updateClientCreditRating } from '../lib/creditRisk';
import { calculateCollectionBehaviour } from '../lib/collectionBehaviour';

const router = Router();

// GET /api/clients
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { type, status, rating, search, stats, minimal } = req.query;

    const where: any = { deletedAt: null, ...(branchId ? { branchId } : {}) };
    if (type) where.type = type;
    if (status) where.status = status;
    if (rating) where.rating = rating;
    if (search) {
      const searchStr = String(search);
      where.OR = [
        { name: { contains: searchStr, mode: 'insensitive' } },
        { ownerName: { contains: searchStr, mode: 'insensitive' } },
        { phone: { contains: searchStr } },
        { address: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    if (minimal === 'true') {
      const clients = await prisma.client.findMany({
        where,
        select: {
          id: true, clientId: true, name: true, currentBalance: true, rating: true,
          phone: true, whatsapp: true, address: true, deliveryLocation: true,
          type: true, creditLimit: true, paymentTerms: true, openingBalance: true
        },
        orderBy: { name: 'asc' },
      });
      return res.json({ success: true, data: clients });
    }

    const clients = await prisma.client.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    if (clients.length === 0) {
      return res.json({ success: true, data: [] });
    }

    if (stats !== 'true') {
      const data = clients.map(c => ({
        ...c,
        totalSales: 0,
        salesCount: 0,
        lastOrderDate: null,
        totalCollected: 0,
        averageOrderValue: 0,
        calculatedCreditLimit: 50000,
        effectiveCreditLimit: c.creditLimit && c.creditLimit > 0 ? c.creditLimit : 50000,
      }));
      return res.json({ success: true, data });
    }

    const clientIds = clients.map(c => c.id);

    const [salesArr, collectionsArr] = await Promise.all([
      prisma.sale.groupBy({
        by: ['clientId'],
        where: { 
          ...(branchId ? { branchId } : {}), 
          deletedAt: null,
          clientId: { in: clientIds }
        },
        _sum: { total: true },
        _count: { id: true },
        _max: { date: true },
      }),
      prisma.collection.groupBy({
        by: ['clientId'],
        where: { 
          ...(branchId ? { branchId } : {}), 
          deletedAt: null,
          clientId: { in: clientIds }
        },
        _sum: { amount: true },
      })
    ]);

    const salesMap = Object.fromEntries(salesArr.map(x => [x.clientId, { total: x._sum.total ?? 0, count: x._count.id, lastDate: x._max.date }]));
    const collectionsMap = Object.fromEntries(collectionsArr.map(x => [x.clientId, x._sum.amount ?? 0]));

    const data = clients.map(c => {
      const sCount = salesMap[c.id]?.count ?? 0;
      const sTotal = salesMap[c.id]?.total ?? 0;
      const aov = sCount > 0 ? Math.round(sTotal / sCount) : 0;
      const calcLimit = aov > 0 ? Math.round(aov * 3) : 50000;
      const effLimit = (c.creditLimit && c.creditLimit > 0) ? c.creditLimit : calcLimit;

      return {
        ...c,
        totalSales: sTotal,
        salesCount: sCount,
        lastOrderDate: salesMap[c.id]?.lastDate ?? null,
        totalCollected: collectionsMap[c.id] ?? 0,
        currentBalance: c.currentBalance,
        averageOrderValue: aov,
        calculatedCreditLimit: calcLimit,
        effectiveCreditLimit: effLimit,
      };
    });

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('[GET /api/clients]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load clients' });
  }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const {
    name, ownerName, phone, whatsapp, address, deliveryLocation,
    type, creditLimit, paymentTerms, openingBalance, notes, rating
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Business name is required' });
  }

  try {
    const openBal = Number(openingBalance ?? 0);
    const uniqueClientId = await generateClientId(whatsapp || phone);

    const client = await prisma.$transaction(async tx => {
      const c = await tx.client.create({
        data: {
          clientId: uniqueClientId,
          name: name.trim(),
          ownerName: ownerName?.trim() || null,
          phone: phone?.trim() || null,
          whatsapp: whatsapp?.trim() || null,
          address: address?.trim() || null,
          deliveryLocation: deliveryLocation?.trim() || null,
          type: type ?? 'RETAIL',
          creditLimit: creditLimit ?? 0,
          paymentTerms: paymentTerms ?? 0,
          openingBalance: openBal,
          currentBalance: openBal,
          notes: notes?.trim() || null,
          rating: rating ?? 'NEW',
          branchId,
        },
      });

      if (openBal !== 0) {
        await recordCustomerLedgerEntry(tx, {
          clientId: c.id,
          branchId,
          type: 'ADJUSTMENT',
          description: 'Opening Balance',
          debit: openBal > 0 ? openBal : 0,
          credit: openBal < 0 ? Math.abs(openBal) : 0,
        });
      }

      await updateClientCreditRating(c.id, tx);

      return c;
    }, { maxWait: 10000, timeout: 30000 });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Client', entityId: client.id, newData: { name } });
    return res.status(201).json({ success: true, data: client });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const field = (err.meta?.target as string[])?.join(', ') ?? 'field';
      return res.status(409).json({ success: false, error: `A client with this ${field} already exists. Please use a unique value.` });
    }
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create client' });
  }
});

// GET /api/clients/:id (Get Client Profile)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branchId = (req.headers['x-branch-id'] as string) || undefined;

    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null, ...(branchId ? { branchId } : {}) }
    });

    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const [sales, collections, deliveries, ledger] = await Promise.all([
      // Sales
      prisma.sale.findMany({
        where: { clientId: id, deletedAt: null },
        include: { items: { include: { product: true } } },
        orderBy: { date: 'desc' },
      }),
      // Collections
      prisma.collection.findMany({
        where: { clientId: id, deletedAt: null },
        orderBy: { date: 'desc' },
      }),
      // Deliveries
      prisma.delivery.findMany({
        where: { sale: { clientId: id } },
        include: {
          sale: { select: { invoiceNo: true } },
          driver: true,
          vehicle: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Ledger
      prisma.customerLedger.findMany({
        where: { clientId: id },
        orderBy: { date: 'asc' },
      }),
    ]);

    const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
    const totalCollected = collections.reduce((sum, c) => sum + c.amount, 0);
    const lastOrderDate = sales[0]?.date ?? null;
    const outstandingInvoices = sales.filter(s => s.balance > 0 && s.status !== 'CANCELLED');

    // Build ledger entries formatted for UI from DB customerLedger
    const sortedDbLedger = ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const mappedLedger = sortedDbLedger.map(entry => ({
      id: entry.id,
      type: entry.type.toLowerCase(),
      date: entry.date.toISOString(),
      description: entry.description,
      ref: entry.referenceNo || '—',
      debit: entry.debit,
      credit: entry.credit,
      runningBalance: entry.balance,
    }));

    let finalLedger = mappedLedger;
    if (mappedLedger.length === 0 && client.openingBalance !== 0) {
      finalLedger = [{
        id: 'opening-bal',
        type: 'opening',
        date: client.createdAt.toISOString(),
        description: 'Opening Balance',
        ref: '—',
        debit: client.openingBalance > 0 ? client.openingBalance : 0,
        credit: client.openingBalance < 0 ? Math.abs(client.openingBalance) : 0,
        runningBalance: client.openingBalance,
      }];
    }

    return res.json({
      success: true,
      data: {
        client,
        currentBalance: client.currentBalance,
        totalSales,
        totalCollected,
        lastOrderDate,
        outstandingInvoices,
        sales,
        collections,
        deliveries,
        ledger: finalLedger.reverse(), // newest first for ledger list
        creditRisk: await calculateClientCreditRisk(id),
        collectionBehaviour: await calculateCollectionBehaviour(id),
      }
    });
  } catch (err: any) {
    console.error('[GET /api/clients/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load client profile' });
  }
});

// PUT /api/clients/:id (Update Client)
router.put('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const { id } = req.params;
  const {
    name, ownerName, phone, whatsapp, address, deliveryLocation,
    type, creditLimit, paymentTerms, openingBalance, openingBalanceReason, notes, rating
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Business name is required' });
  }

  try {
    const original = await prisma.client.findFirst({
      where: { id, deletedAt: null, branchId }
    });
    if (!original) return res.status(404).json({ success: false, error: 'Client not found' });

    let newOpeningBalance = original.openingBalance;
    let diff = 0;
    let updatedCurrentBalance = original.currentBalance;

    if (openingBalance !== undefined && openingBalance !== null) {
      newOpeningBalance = Number(openingBalance);
      if (isNaN(newOpeningBalance) || newOpeningBalance < 0) {
        return res.status(400).json({ success: false, error: 'Opening balance cannot be negative' });
      }
      diff = newOpeningBalance - original.openingBalance;
    }

    if (diff !== 0) {
      updatedCurrentBalance = Math.max(0, original.currentBalance + diff);
    }

    const updated = await prisma.$transaction(async tx => {
      const c = await tx.client.update({
        where: { id },
        data: {
          name: name.trim(),
          ownerName: ownerName?.trim() || null,
          phone: phone?.trim() || null,
          whatsapp: whatsapp?.trim() || null,
          address: address?.trim() || null,
          deliveryLocation: deliveryLocation?.trim() || null,
          type: type ?? original.type,
          creditLimit: creditLimit ?? original.creditLimit,
          paymentTerms: paymentTerms ?? original.paymentTerms,
          openingBalance: newOpeningBalance,
          currentBalance: updatedCurrentBalance,
          notes: notes?.trim() || null,
          rating: rating ?? original.rating,
        }
      });

      if (diff !== 0) {
        const openingEntry = await tx.customerLedger.findFirst({
          where: { clientId: id, type: 'ADJUSTMENT', description: { contains: 'Opening Balance', mode: 'insensitive' } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
        });

        if (openingEntry) {
          await tx.customerLedger.update({
            where: { id: openingEntry.id },
            data: {
              debit: newOpeningBalance > 0 ? newOpeningBalance : 0,
              credit: newOpeningBalance < 0 ? Math.abs(newOpeningBalance) : 0,
            }
          });
        } else if (newOpeningBalance !== 0) {
          await recordCustomerLedgerEntry(tx, {
            clientId: id,
            branchId,
            type: 'ADJUSTMENT',
            description: 'Opening Balance',
            debit: newOpeningBalance > 0 ? newOpeningBalance : 0,
            credit: newOpeningBalance < 0 ? Math.abs(newOpeningBalance) : 0,
          });
        }

        await recalculateClientLedgerAndBalance(id, tx);
      }

      await updateClientCreditRating(id, tx);
      return c;
    });

    if (diff !== 0) {
      const reasonStr = openingBalanceReason ? String(openingBalanceReason).trim() : 'Manual Opening Balance Adjustment';
      await writeAuditLog({
        userId: userId ?? undefined,
        branchId,
        action: 'UPDATE_OPENING_BALANCE',
        entity: 'ClientOpeningBalance',
        entityId: id,
        oldData: {
          clientName: original.name,
          openingBalance: original.openingBalance,
          currentBalance: original.currentBalance,
        },
        newData: {
          clientName: updated.name,
          openingBalance: newOpeningBalance,
          currentBalance: updatedCurrentBalance,
          difference: diff,
          reason: reasonStr,
        }
      });
    } else {
      await writeAuditLog({
        userId: userId ?? undefined,
        branchId,
        action: 'UPDATE',
        entity: 'Client',
        entityId: id,
        newData: { name: updated.name }
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[PUT /api/clients/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update client' });
  }
});

// PATCH /api/clients/:id (Partial or full Update Client)
router.patch('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  const { id } = req.params;
  const {
    name, ownerName, phone, whatsapp, address, deliveryLocation,
    type, creditLimit, paymentTerms, openingBalance, openingBalanceReason, notes, rating, status
  } = req.body;

  try {
    const original = await prisma.client.findUnique({
      where: { id }
    });
    if (!original) return res.status(404).json({ success: false, error: 'Client not found' });

    let newOpeningBalance = original.openingBalance;
    let diff = 0;
    let updatedCurrentBalance = original.currentBalance;

    if (openingBalance !== undefined && openingBalance !== null) {
      newOpeningBalance = Number(openingBalance);
      if (isNaN(newOpeningBalance) || newOpeningBalance < 0) {
        return res.status(400).json({ success: false, error: 'Opening balance cannot be negative' });
      }
      diff = newOpeningBalance - original.openingBalance;
    }

    if (diff !== 0) {
      updatedCurrentBalance = Math.max(0, original.currentBalance + diff);
    }

    const updated = await prisma.$transaction(async tx => {
      const c = await tx.client.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name: name.trim() } : {}),
          ...(ownerName !== undefined ? { ownerName: ownerName?.trim() || null } : {}),
          ...(phone !== undefined ? { phone: phone?.trim() || null } : {}),
          ...(whatsapp !== undefined ? { whatsapp: whatsapp?.trim() || null } : {}),
          ...(address !== undefined ? { address: address?.trim() || null } : {}),
          ...(deliveryLocation !== undefined ? { deliveryLocation: deliveryLocation?.trim() || null } : {}),
          ...(type !== undefined ? { type } : {}),
          ...(creditLimit !== undefined ? { creditLimit: Number(creditLimit) } : {}),
          ...(paymentTerms !== undefined ? { paymentTerms: Number(paymentTerms) } : {}),
          ...(openingBalance !== undefined ? { openingBalance: newOpeningBalance, currentBalance: updatedCurrentBalance } : {}),
          ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
          ...(rating !== undefined ? { rating } : {}),
          ...(status !== undefined ? { status } : {}),
        }
      });

      if (diff !== 0) {
        const openingEntry = await tx.customerLedger.findFirst({
          where: { clientId: id, type: 'ADJUSTMENT', description: { contains: 'Opening Balance', mode: 'insensitive' } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }]
        });

        if (openingEntry) {
          await tx.customerLedger.update({
            where: { id: openingEntry.id },
            data: {
              debit: newOpeningBalance > 0 ? newOpeningBalance : 0,
              credit: newOpeningBalance < 0 ? Math.abs(newOpeningBalance) : 0,
            }
          });
        } else if (newOpeningBalance !== 0) {
          await recordCustomerLedgerEntry(tx, {
            clientId: id,
            branchId: original.branchId,
            type: 'ADJUSTMENT',
            description: 'Opening Balance',
            debit: newOpeningBalance > 0 ? newOpeningBalance : 0,
            credit: newOpeningBalance < 0 ? Math.abs(newOpeningBalance) : 0,
          });
        }

        await recalculateClientLedgerAndBalance(id, tx);
      }

      await updateClientCreditRating(id, tx);
      return c;
    });

    if (diff !== 0) {
      const reasonStr = openingBalanceReason ? String(openingBalanceReason).trim() : 'Manual Opening Balance Adjustment';
      await writeAuditLog({
        userId: userId ?? undefined,
        branchId: branchId || original.branchId,
        action: 'UPDATE_OPENING_BALANCE',
        entity: 'ClientOpeningBalance',
        entityId: id,
        oldData: {
          clientName: original.name,
          openingBalance: original.openingBalance,
          currentBalance: original.currentBalance,
        },
        newData: {
          clientName: updated.name,
          openingBalance: newOpeningBalance,
          currentBalance: updatedCurrentBalance,
          difference: diff,
          reason: reasonStr,
        }
      });
    } else {
      await writeAuditLog({
        userId: userId ?? undefined,
        branchId: branchId || updated.branchId,
        action: 'UPDATE',
        entity: 'Client',
        entityId: id,
        newData: { rating, status, creditLimit, paymentTerms }
      });
    }

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[PATCH /api/clients/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update client' });
  }
});

// GET /api/clients/:id/audit-trail (Opening Balance Audit Trail)
router.get('/:id/audit-trail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: {
        entityId: id,
        entity: { in: ['Client', 'ClientOpeningBalance'] }
      },
      include: {
        user: { select: { id: true, name: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: logs });
  } catch (err: any) {
    console.error('[GET /api/clients/:id/audit-trail]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load audit logs' });
  }
});

// DELETE /api/clients/:id (Soft delete)
router.delete('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const { id } = req.params;

  try {
    const client = await prisma.client.findFirst({
      where: { id, deletedAt: null, branchId }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    await prisma.client.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'DELETE',
      entity: 'Client',
      entityId: id,
      oldData: { name: client.name }
    });

    return res.json({ success: true, message: 'Client deleted successfully' });
  } catch (err: any) {
    console.error('[DELETE /api/clients/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete client' });
  }
});

export default router;
