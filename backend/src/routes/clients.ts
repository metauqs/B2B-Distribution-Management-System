import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, generateClientId, recordCustomerLedgerEntry, recalculateClientLedgerAndBalance, reconcileClientBalancesAndAllocations, getAuthoritativeClientOutstanding } from '../lib/business';
import { Prisma } from '@prisma/client';
import { calculateClientCreditRisk, updateClientCreditRating } from '../lib/creditRisk';
import { calculateCollectionBehaviour } from '../lib/collectionBehaviour';

const router = Router();

// In-Memory cache for client listings and profiles (30s TTL)
const CLIENT_CACHE = new Map<string, { ts: number; data: any }>();
const CLIENT_PROFILE_CACHE = new Map<string, { ts: number; data: any }>();
const CLIENT_CACHE_TTL = 30000;
const CLIENT_IN_FLIGHT = new Map<string, Promise<any>>();
const CLIENT_PROFILE_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearClientCache(): void {
  CLIENT_CACHE.clear();
  CLIENT_PROFILE_CACHE.clear();
  CLIENT_IN_FLIGHT.clear();
  CLIENT_PROFILE_IN_FLIGHT.clear();
}

// GET /api/clients
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { type, status, rating, search, stats, minimal, archived } = req.query;
    const isArchived = archived === 'true';

    const cacheKey = `${branchId || 'all'}_${type || ''}_${status || ''}_${rating || ''}_${search || ''}_${stats || ''}_${minimal || ''}_${archived || ''}`;
    const cached = CLIENT_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CLIENT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (CLIENT_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await CLIENT_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchClientsPromise = (async () => {
      const where: any = { 
        ...(isArchived ? { deletedAt: { not: null } } : { deletedAt: null }),
        ...(branchId ? { branchId } : {}) 
      };
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
        return await prisma.client.findMany({
          where,
          select: {
            id: true, clientId: true, name: true, currentBalance: true, rating: true,
            phone: true, whatsapp: true, address: true, deliveryLocation: true,
            type: true, creditLimit: true, paymentTerms: true, openingBalance: true
          },
          orderBy: { name: 'asc' },
        });
      }

      const clients = await prisma.client.findMany({
        where,
        orderBy: { name: 'asc' },
      });

      if (clients.length === 0) {
        return [];
      }

      if (stats !== 'true') {
        return clients.map(c => ({
          ...c,
          totalSales: 0,
          salesCount: 0,
          lastOrderDate: null,
          totalCollected: 0,
          averageOrderValue: 0,
          calculatedCreditLimit: 50000,
          effectiveCreditLimit: c.creditLimit && c.creditLimit > 0 ? c.creditLimit : 50000,
        }));
      }

      const clientIds = clients.map(c => c.id);

      const [salesArr, collectionsArr, activeSalesArr] = await Promise.all([
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
        }),
        prisma.sale.groupBy({
          by: ['clientId'],
          where: { 
            ...(branchId ? { branchId } : {}), 
            deletedAt: null,
            status: { not: 'CANCELLED' },
            clientId: { in: clientIds }
          },
          _sum: { total: true },
          _count: { id: true },
        }),
      ]);

      const salesMap = Object.fromEntries(salesArr.map(x => [x.clientId, x]));
      const collectionsMap = Object.fromEntries(collectionsArr.map(x => [x.clientId, x]));
      const activeSalesMap = Object.fromEntries(activeSalesArr.map(x => [x.clientId, x]));

      return clients.map(c => {
        const s = salesMap[c.id];
        const col = collectionsMap[c.id];
        const activeS = activeSalesMap[c.id];

        const totalSales = s?._sum.total ?? 0;
        const totalCollected = col?._sum.amount ?? 0;
        const salesCount = activeS?._count.id ?? 0;
        const averageOrderValue = salesCount > 0 ? Math.round(totalSales / salesCount) : 0;
        const calculatedLimit = Math.max(50000, Math.round(averageOrderValue * 3));
        const effectiveLimit = c.creditLimit && c.creditLimit > 0 ? c.creditLimit : calculatedLimit;

        return {
          ...c,
          totalSales,
          salesCount,
          lastOrderDate: s?._max.date ? s._max.date.toISOString() : null,
          totalCollected,
          averageOrderValue,
          calculatedCreditLimit: calculatedLimit,
          effectiveCreditLimit: effectiveLimit,
        };
      });
    })();

    CLIENT_IN_FLIGHT.set(cacheKey, fetchClientsPromise);
    try {
      const data = await fetchClientsPromise;
      if (CLIENT_CACHE.size > 50) CLIENT_CACHE.clear();
      CLIENT_CACHE.set(cacheKey, { ts: Date.now(), data });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data });
    } finally {
      CLIENT_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error fetching clients:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load clients', data: [] });
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

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, error: 'Name is required' });
  }

  const openBal = openingBalance ? Number(openingBalance) : 0;
  if (isNaN(openBal) || openBal < 0) {
    return res.status(400).json({ success: false, error: 'Opening balance cannot be negative' });
  }

  try {
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
    }, { maxWait: 15000, timeout: 120000 });

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Client', entityId: client.id, newData: { name } });
    clearClientCache();
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

    const cacheKey = `profile_${branchId || 'all'}_${id}`;
    const cached = CLIENT_PROFILE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CLIENT_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (CLIENT_PROFILE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await CLIENT_PROFILE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchProfilePromise = (async () => {
      const client = await prisma.client.findFirst({
        where: { id, ...(branchId ? { branchId } : {}) }
      });

      if (!client) {
        return null;
      }

      const [sales, collections, deliveries, ledger] = await Promise.all([
        // Sales
        prisma.sale.findMany({
          where: { clientId: id, deletedAt: null },
          select: {
            id: true,
            invoiceNo: true,
            date: true,
            subtotal: true,
            discount: true,
            deliveryCharge: true,
            total: true,
            paid: true,
            balance: true,
            status: true,
            paymentMode: true,
            items: {
              select: {
                id: true,
                itemName: true,
                qty: true,
                unit: true,
                rate: true,
                amount: true,
              },
            },
          },
          orderBy: { date: 'desc' },
          take: 100,
        }),
        // Collections
        prisma.collection.findMany({
          where: { clientId: id, deletedAt: null },
          include: {
            receivedByUser: { select: { id: true, name: true, role: true } },
            allocations: {
              include: {
                sale: { select: { id: true, invoiceNo: true, date: true, total: true, paid: true, balance: true, status: true } }
              }
            }
          },
          orderBy: { date: 'desc' },
          take: 100,
        }),
        // Deliveries
        prisma.delivery.findMany({
          where: { sale: { clientId: id } },
          select: {
            id: true,
            status: true,
            createdAt: true,
            notes: true,
            sale: { select: { invoiceNo: true } },
            driver: { select: { id: true, name: true, phone: true } },
            vehicle: { select: { id: true, plateNo: true, type: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        // Ledger
        prisma.customerLedger.findMany({
          where: { clientId: id },
          orderBy: { date: 'asc' },
          take: 500,
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

      const invoiceOutstanding = sales.filter(s => s.status !== 'CANCELLED').reduce((sum, s) => sum + (s.balance ?? 0), 0);
      const openingBal = client.openingBalance ?? 0;
      const openingBalanceRemaining = openingBal > 0 ? Math.max(0, Math.round((client.currentBalance - invoiceOutstanding) * 100) / 100) : 0;
      const openingBalancePaid = openingBal > 0 ? Math.max(0, Math.round((openingBal - openingBalanceRemaining) * 100) / 100) : 0;
      const openingBalanceStatus: 'CLEARED' | 'UNPAID' | 'NO_OPENING' = openingBal === 0 ? 'NO_OPENING' : openingBalanceRemaining < 0.99 ? 'CLEARED' : 'UNPAID';

      const [creditRisk, collectionBehaviour] = await Promise.all([
        calculateClientCreditRisk(id),
        calculateCollectionBehaviour(id),
      ]);

      return {
        client: {
          ...client,
          openingBalanceRemaining,
          openingBalancePaid,
          openingBalanceStatus,
        },
        currentBalance: client.currentBalance,
        totalSales,
        totalCollected,
        lastOrderDate,
        outstandingInvoices,
        invoiceOutstanding,
        openingBalanceRemaining,
        openingBalancePaid,
        openingBalanceStatus,
        sales,
        collections,
        deliveries,
        ledger: finalLedger.reverse(), // newest first for ledger list
        creditRisk,
        collectionBehaviour,
      };
    })();

    CLIENT_PROFILE_IN_FLIGHT.set(cacheKey, fetchProfilePromise);
    try {
      const responsePayload = await fetchProfilePromise;
      if (!responsePayload) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      if (CLIENT_PROFILE_CACHE.size > 50) CLIENT_PROFILE_CACHE.clear();
      CLIENT_PROFILE_CACHE.set(cacheKey, { ts: Date.now(), data: responsePayload });
      res.setHeader('X-Cache', 'MISS');
      return res.json({
        success: true,
        data: responsePayload
      });
    } finally {
      CLIENT_PROFILE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error fetching client profile:', err);
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

    clearClientCache();
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

        await reconcileClientBalancesAndAllocations(id, tx);
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

    clearClientCache();
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

// Helper to check deletion permissions
async function checkClientDeletePermission(req: Request, branchId: string): Promise<{ authorized: boolean; user?: any; error?: string }> {
  const userId = (req.headers['x-user-id'] as string) || (req.user?.sub as string);
  const headerRole = (req.headers['x-user-role'] as string) || req.user?.role;
  
  if (headerRole && ['OWNER', 'MANAGER', 'ACCOUNTANT', 'ADMIN'].includes(headerRole.toUpperCase())) {
    return { authorized: true };
  }
  
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true, role: true }
    });
    if (user && ['OWNER', 'MANAGER', 'ACCOUNTANT'].includes(user.role)) {
      return { authorized: true, user };
    }
  }
  
  if (!userId && !headerRole) {
    return { authorized: true };
  }
  
  return { authorized: false, error: 'Forbidden: Only Owner, Manager, or Accountant can delete/archive clients' };
}

// GET /api/clients/:id/delete-summary — Record summary before deletion/archival
router.get('/:id/delete-summary', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branchId = (req.headers['x-branch-id'] as string) || undefined;

    const client = await prisma.client.findFirst({
      where: { id, ...(branchId ? { branchId } : {}) }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    let currentBalance = client.currentBalance;
    try {
      currentBalance = await getAuthoritativeClientOutstanding(id);
    } catch (e) {
      console.error('[delete-summary] balance error:', e);
    }

    const [salesAgg, collectionsAgg, ledgerCount, deliveryCount, chequeCount] = await Promise.all([
      prisma.sale.aggregate({
        where: { clientId: id, deletedAt: null },
        _count: { id: true },
        _sum: { total: true }
      }),
      prisma.collection.aggregate({
        where: { clientId: id, deletedAt: null },
        _count: { id: true },
        _sum: { amount: true }
      }),
      prisma.customerLedger.count({ where: { clientId: id } }),
      prisma.delivery.count({ where: { client: { id } } }),
      prisma.cheque.count({ where: { clientId: id } })
    ]);

    const invoiceCount = salesAgg._count.id || 0;
    const totalInvoiceValue = salesAgg._sum.total || 0;
    const collectionCount = collectionsAgg._count.id || 0;
    const totalCollected = collectionsAgg._sum.amount || 0;

    const hasTransactions = invoiceCount > 0 ||
      collectionCount > 0 ||
      ledgerCount > 0 ||
      deliveryCount > 0 ||
      chequeCount > 0 ||
      Math.abs(client.openingBalance) > 0.01 ||
      Math.abs(currentBalance) > 0.01;

    const isArchived = Boolean(client.deletedAt !== null || client.status === 'INACTIVE');
    const allowedAction = isArchived ? 'PERMANENT_DELETE' : (hasTransactions ? 'ARCHIVE' : 'HARD_DELETE');

    return res.json({
      success: true,
      data: {
        id: client.id,
        clientId: client.clientId || 'WH-0000',
        name: client.name,
        ownerName: client.ownerName,
        phone: client.phone,
        status: client.status,
        isArchived,
        deletedAt: client.deletedAt,
        openingBalance: client.openingBalance,
        currentBalance,
        invoiceCount,
        totalInvoiceValue,
        collectionCount,
        totalCollected,
        ledgerCount,
        deliveryCount,
        chequeCount,
        hasTransactions,
        allowedAction,
        message: hasTransactions
          ? 'This client has historical financial/transaction records and cannot be permanently deleted. It will be safely archived.'
          : 'This client has no transaction records and will be permanently deleted.'
      }
    });
  } catch (err: any) {
    console.error('[GET /api/clients/:id/delete-summary]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to get delete summary' });
  }
});

// DELETE /api/clients/:id — Safe Deletion / Archival
router.delete('/:id', async (req: Request, res: Response) => {
  const branchId = (req.headers['x-branch-id'] as string) || undefined;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const { id } = req.params;
  const { confirmationPhrase, reason, forceHard, permanent } = req.body || {};

  try {
    const authCheck = await checkClientDeletePermission(req, branchId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, error: authCheck.error });
    }

    const client = await prisma.client.findFirst({
      where: { id, branchId }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    // Check transaction history
    const [salesCount, collectionsCount, ledgerCount, deliveryCount, chequeCount] = await Promise.all([
      prisma.sale.count({ where: { clientId: id } }),
      prisma.collection.count({ where: { clientId: id } }),
      prisma.customerLedger.count({ where: { clientId: id } }),
      prisma.delivery.count({ where: { client: { id } } }),
      prisma.cheque.count({ where: { clientId: id } }),
    ]);

    const hasTransactions = salesCount > 0 ||
      collectionsCount > 0 ||
      ledgerCount > 0 ||
      deliveryCount > 0 ||
      chequeCount > 0 ||
      Math.abs(client.openingBalance) > 0.01 ||
      Math.abs(client.currentBalance) > 0.01;

    const phraseUpper = String(confirmationPhrase || '').trim().toUpperCase();

    // ─── PERMANENT PURGE (Available for archived clients or explicit purge) ────
    if (permanent === true || phraseUpper === 'DELETE PERMANENTLY') {
      if (phraseUpper !== 'DELETE PERMANENTLY') {
        return res.status(400).json({
          success: false,
          error: 'Confirmation phrase mismatch. Please type DELETE PERMANENTLY to confirm permanent removal.'
        });
      }

      await prisma.$transaction(async (tx) => {
        // 1. Find all sales for this client
        const sales = await tx.sale.findMany({
          where: { clientId: id },
          select: { id: true }
        });
        const saleIds = sales.map(s => s.id);

        // 2. Find all collections for this client
        const collections = await tx.collection.findMany({
          where: { clientId: id },
          select: { id: true }
        });
        const collectionIds = collections.map(c => c.id);

        // 3. Delete StockMovements linked to sales
        if (saleIds.length > 0) {
          await tx.stockMovement.deleteMany({
            where: {
              OR: [
                { refType: 'sale', refId: { in: saleIds } },
                { refType: 'sale_cancelled', refId: { in: saleIds } }
              ]
            }
          });
        }

        // 4. Delete Deliveries linked to sales or client
        const deliveries = await tx.delivery.findMany({
          where: {
            OR: [
              { clientId: id },
              ...(saleIds.length > 0 ? [{ saleId: { in: saleIds } }] : [])
            ]
          },
          select: { id: true }
        });
        const deliveryIds = deliveries.map(d => d.id);
        if (deliveryIds.length > 0) {
          await tx.delivery.deleteMany({
            where: { id: { in: deliveryIds } }
          });
        }

        // 5. Delete CollectionAllocations
        if (saleIds.length > 0 || collectionIds.length > 0) {
          await tx.collectionAllocation.deleteMany({
            where: {
              OR: [
                ...(saleIds.length > 0 ? [{ saleId: { in: saleIds } }] : []),
                ...(collectionIds.length > 0 ? [{ collectionId: { in: collectionIds } }] : [])
              ]
            }
          });
        }

        // 6. Delete SaleItems & Sales
        if (saleIds.length > 0) {
          await tx.saleItem.deleteMany({
            where: { saleId: { in: saleIds } }
          });
          await tx.sale.deleteMany({
            where: { id: { in: saleIds } }
          });
        }

        // 7. Delete Collections
        if (collectionIds.length > 0) {
          await tx.collection.deleteMany({
            where: { id: { in: collectionIds } }
          });
        }

        // 8. Delete Ledgers, Cheques, BroadcastRecipients
        await tx.customerLedger.deleteMany({ where: { clientId: id } });
        await tx.cheque.deleteMany({ where: { clientId: id } });
        await tx.broadcastRecipient.deleteMany({ where: { clientId: id } });

        // 9. Delete Client
        await tx.client.delete({ where: { id } });
      });

      await writeAuditLog({
        userId: userId ?? undefined,
        branchId,
        action: 'PERMANENT_PURGE_CLIENT',
        entity: 'Client',
        entityId: id,
        oldData: {
          clientId: client.clientId,
          name: client.name,
          salesPurged: salesCount,
          collectionsPurged: collectionsCount,
          ledgerPurged: ledgerCount,
          deliveriesPurged: deliveryCount,
          reason: reason || 'Archived client profile and all records permanently purged'
        }
      });

      clearClientCache();
      return res.json({
        success: true,
        action: 'PERMANENT_DELETE',
        message: 'Client and all associated records permanently purged from the database.'
      });
    }

    if (hasTransactions) {
      if (forceHard === true) {
        return res.status(400).json({
          success: false,
          error: 'This client has active financial records. Please archive the client first or type DELETE PERMANENTLY to purge.'
        });
      }

      if (phraseUpper !== 'ARCHIVE' && phraseUpper !== 'DELETE') {
        return res.status(400).json({
          success: false,
          error: 'Confirmation phrase mismatch. Please type ARCHIVE to confirm.'
        });
      }

      // Safe Soft-Delete / Archival inside Transaction
      await prisma.$transaction(async (tx) => {
        await tx.client.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            status: 'INACTIVE',
          }
        });
      });

      await writeAuditLog({
        userId: userId ?? undefined,
        branchId,
        action: 'ARCHIVE_CLIENT',
        entity: 'Client',
        entityId: id,
        oldData: {
          clientId: client.clientId,
          name: client.name,
          openingBalance: client.openingBalance,
          currentBalance: client.currentBalance,
          salesCount,
          collectionsCount,
          ledgerCount,
          deliveryCount,
          reason: reason || 'Client archived via management UI'
        }
      });

      clearClientCache();
      return res.json({
        success: true,
        action: 'ARCHIVE',
        message: 'Client archived successfully. All historical transactions remain preserved and traceable.'
      });
    } else {
      // Clean Empty Client — True Hard Delete is safe
      if (phraseUpper !== 'DELETE') {
        return res.status(400).json({
          success: false,
          error: 'Confirmation phrase mismatch. Please type DELETE to confirm.'
        });
      }

      await prisma.$transaction(async (tx) => {
        // Clean any broadcast relations if present
        await tx.broadcastRecipient.deleteMany({ where: { clientId: id } });
        // Permanently delete empty client
        await tx.client.delete({ where: { id } });
      });

      await writeAuditLog({
        userId: userId ?? undefined,
        branchId,
        action: 'HARD_DELETE_CLIENT',
        entity: 'Client',
        entityId: id,
        oldData: {
          clientId: client.clientId,
          name: client.name,
          reason: reason || 'Empty client permanently deleted'
        }
      });

      clearClientCache();
      return res.json({
        success: true,
        action: 'HARD_DELETE',
        message: 'Empty client profile permanently deleted.'
      });
    }
  } catch (err: any) {
    console.error('[DELETE /api/clients/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to process client deletion' });
  }
});

// POST /api/clients/:id/archive — Direct Archive Route
router.post('/:id/archive', async (req: Request, res: Response) => {
  const branchId = (req.headers['x-branch-id'] as string) || undefined;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });
  const { id } = req.params;
  const { reason, confirmationPhrase } = req.body || {};

  try {
    const authCheck = await checkClientDeletePermission(req, branchId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, error: authCheck.error });
    }

    const client = await prisma.client.findFirst({
      where: { id, branchId }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    const phraseUpper = String(confirmationPhrase || '').trim().toUpperCase();
    if (phraseUpper !== 'ARCHIVE' && phraseUpper !== 'DELETE') {
      return res.status(400).json({ success: false, error: 'Confirmation phrase mismatch. Please type ARCHIVE to confirm.' });
    }

    await prisma.client.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE'
      }
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'ARCHIVE_CLIENT',
      entity: 'Client',
      entityId: id,
      oldData: { clientId: client.clientId, name: client.name, reason: reason || 'Archived via direct action' }
    });

    return res.json({ success: true, message: 'Client archived successfully.' });
  } catch (err: any) {
    console.error('[POST /api/clients/:id/archive]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to archive client' });
  }
});

// POST /api/clients/:id/restore — Restore an archived client
router.post('/:id/restore', async (req: Request, res: Response) => {
  const branchId = (req.headers['x-branch-id'] as string) || undefined;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });
  const { id } = req.params;

  try {
    const authCheck = await checkClientDeletePermission(req, branchId);
    if (!authCheck.authorized) {
      return res.status(403).json({ success: false, error: authCheck.error });
    }

    const client = await prisma.client.findFirst({
      where: { id, branchId }
    });
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

    await prisma.client.update({
      where: { id },
      data: {
        deletedAt: null,
        status: 'ACTIVE'
      }
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'RESTORE_CLIENT',
      entity: 'Client',
      entityId: id,
      newData: { clientId: client.clientId, name: client.name }
    });

    return res.json({ success: true, message: 'Client restored successfully.' });
  } catch (err: any) {
    console.error('[POST /api/clients/:id/restore]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to restore client' });
  }
});

export default router;
