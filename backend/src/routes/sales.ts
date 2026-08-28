import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { generateInvoiceNo, writeAuditLog, getClientBalance, getValidUserId, recordCustomerLedgerEntry, recalculateClientLedgerAndBalance, deriveInvoiceStatus, syncPriceListFromSale, reconcileClientBalancesAndAllocations } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { stockOut, syncInvoiceEditStock, stockReturn } from '../lib/inventoryService';
import { getBusinessDateRange, getBusinessDateString, getCurrentBusinessDateRange, parseInputDateToUtc } from '../lib/businessDate';
import { postSaleLedger, postCollectionLedger } from '../lib/financialLedgerService';

const router = Router();

/**
 * Helper to find an active editable sale for a client on the current Business Day.
 * An invoice is active & editable if:
 * - deletedAt === null
 * - status !== 'CANCELLED'
 * - isLocked !== true
 * - deliveryStatus !== 'DELIVERED' & 'FAILED'
 * - date belongs to current Business Day
 */
export async function findActiveEditableSale(clientId: string, branchId?: string, tx?: any) {
  const db = tx || prisma;
  const currentRange = getCurrentBusinessDateRange();

  const sale = await db.sale.findFirst({
    where: {
      clientId,
      deletedAt: null,
      status: { not: 'CANCELLED' },
      isLocked: false,
      deliveryStatus: { notIn: ['DELIVERED', 'FAILED'] },
      ...(branchId ? { branchId } : {}),
      date: {
        gte: currentRange.start,
        lte: currentRange.end,
      },
      deliveries: {
        none: {
          status: { in: ['DELIVERED', 'FAILED', 'RETURNED'] }
        }
      }
    },
    include: {
      client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, address: true, deliveryLocation: true, creditLimit: true, currentBalance: true } },
      items: { include: { product: { select: { id: true, name: true, urduName: true, emoji: true, imageUrl: true } } } },
      deliveries: { include: { driver: true, vehicle: true, employee: true } },
      employee: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  return sale;
}

// ── In-Memory cache for sales queries (20s TTL) ─────────────────────────────
const SALES_CACHE = new Map<string, { ts: number; data: any }>();
const SALES_CACHE_TTL = 20000;
const SALES_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearSalesCache(): void {
  SALES_CACHE.clear();
}

// GET /api/sales — List sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, status, mode, search, from, to, limit: limitQuery } = req.query;
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 1000) : (clientId || from || to ? 200 : 100);
    const normFrom = from ? getBusinessDateString(getBusinessDateRange(String(from)).start) : 'all';
    const normTo = to ? getBusinessDateString(getBusinessDateRange(String(to)).end) : 'all';
    const cacheKey = `${branchId || 'all'}_${clientId || 'all'}_${status || 'all'}_${mode || 'all'}_${search ? String(search).trim().toLowerCase() : 'all'}_${normFrom}_${normTo}_${limit}`;
    const cached = SALES_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < SALES_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (SALES_IN_FLIGHT.has(cacheKey)) {
      const coalescedSales = await SALES_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalescedSales });
    }

    const fetchSalesPromise = (async () => {
      const dateFrom = from ? getBusinessDateRange(String(from)).start : undefined;
      const dateTo = to ? getBusinessDateRange(String(to)).end : undefined;

      if (dateFrom && isNaN(dateFrom.getTime())) {
        throw new Error('Invalid from date');
      }
      if (dateTo && isNaN(dateTo.getTime())) {
        throw new Error('Invalid to date');
      }

      const where: any = {
        deletedAt: null,
        ...(branchId ? { branchId } : {}),
        ...(clientId ? { clientId: String(clientId) } : {}),
        ...(status && status !== 'all' ? { status: status as any } : { status: { not: 'CANCELLED' } }),
        ...(mode && mode !== 'all' ? { paymentMode: mode as any } : {}),
        ...(search ? {
          OR: [
            { invoiceNo: { contains: String(search), mode: 'insensitive' } },
            { client: { name: { contains: String(search), mode: 'insensitive' } } },
          ]
        } : {}),
        ...(dateFrom || dateTo ? {
          date: {
            ...(dateFrom ? { gte: dateFrom } : {}),
            ...(dateTo ? { lte: dateTo } : {}),
          },
        } : {}),
      };

      return await prisma.sale.findMany({
        where,
        select: {
          id: true,
          invoiceNo: true,
          clientId: true,
          date: true,
          subtotal: true,
          discount: true,
          deliveryCharge: true,
          previousBalance: true,
          total: true,
          paid: true,
          balance: true,
          status: true,
          paymentMode: true,
          isLocked: true,
          deliveryStatus: true,
          notes: true,
          createdAt: true,
          client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, type: true } },
          items: {
            select: {
              id: true,
              productId: true,
              itemName: true,
              unit: true,
              qty: true,
              rate: true,
              amount: true,
              costPrice: true,
              returnedQty: true,
              returnReason: true,
              product: { select: { id: true, name: true, urduName: true, emoji: true, imageUrl: true } },
            },
          },
          employee: { select: { id: true, name: true, role: true, phone: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      });
    })();

    SALES_IN_FLIGHT.set(cacheKey, fetchSalesPromise);
    try {
      const sales = await fetchSalesPromise;
      if (SALES_CACHE.size >= 50) SALES_CACHE.clear();
      SALES_CACHE.set(cacheKey, { ts: Date.now(), data: sales });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: sales });
    } finally {
      SALES_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('[GET /api/sales]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load sales', data: [] });
  }
});

// GET /api/sales/active — Check if an active editable invoice exists for a client on the current Business Day
router.get('/active', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.query;
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId parameter is required' });
    }
    const sale = await findActiveEditableSale(String(clientId), branchId);
    return res.json({ success: true, data: sale });
  } catch (err: any) {
    console.error('[GET /api/sales/active]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to check active invoice' });
  }
});

function validateSalesInput(items: any[], discount: any, deliveryCharge: any, paid?: any): string | null {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return 'At least one item is required';
  }
  for (const item of items) {
    const qty = Number(item.qty);
    const rate = Number(item.rate);
    if (isNaN(qty) || !isFinite(qty) || qty <= 0) {
      return `Invalid quantity for item "${item.itemName || item.name || 'product'}". Quantity must be greater than 0.`;
    }
    if (isNaN(rate) || !isFinite(rate) || rate < 0) {
      return `Invalid rate for item "${item.itemName || item.name || 'product'}". Rate cannot be negative.`;
    }
  }
  const numDiscount = Number(discount || 0);
  if (isNaN(numDiscount) || !isFinite(numDiscount) || numDiscount < 0) {
    return 'Discount cannot be negative';
  }
  const numDeliveryCharge = Number(deliveryCharge || 0);
  if (isNaN(numDeliveryCharge) || !isFinite(numDeliveryCharge) || numDeliveryCharge < 0) {
    return 'Delivery charge cannot be negative';
  }
  if (paid !== undefined) {
    const numPaid = Number(paid || 0);
    if (isNaN(numPaid) || !isFinite(numPaid) || numPaid < 0) {
      return 'Paid amount cannot be negative';
    }
  }
  return null;
}

// POST /api/sales — Create sale
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Branch not found in token' });
  }

  const {
    clientId, items, paid = 0, discount = 0,
    deliveryCharge = 0, paymentMode = 'CREDIT',
    notes, date,
    employeeId, deliveryDate, deliveryTime,
    forceNew = false,
  } = req.body;

  if (!clientId) return res.status(400).json({ success: false, error: 'Client is required' });
  
  const validationError = validateSalesInput(items, discount, deliveryCharge, paid);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const client = await prisma.client.findUnique({ where: { id: clientId, deletedAt: null } });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

  // Check if an active editable invoice already exists for this client today
  if (!forceNew) {
    const activeSale = await findActiveEditableSale(clientId, branchId);
    if (activeSale) {
      return res.status(409).json({
        success: false,
        activeSaleExists: true,
        activeSale,
        message: `An active editable invoice ${activeSale.invoiceNo} already exists for ${client.name} today.`,
      });
    }
  }

  const rawSubtotal = items.reduce((s: number, i: any) => s + (Number(i.qty) * Number(i.rate)), 0);
  const subtotal = Math.round(rawSubtotal);
  const rawTotal = subtotal - Number(discount) + Number(deliveryCharge);
  const total = Math.max(0, Math.round(rawTotal));
  const paidAmt = Math.round(Number(paid));

  if (paidAmt > total) {
    return res.status(400).json({
      success: false,
      error: `Amount paid (Rs ${paidAmt.toLocaleString()}) cannot exceed invoice total (Rs ${total.toLocaleString()})`
    });
  }

  const rawBal = total - paidAmt;
  const balance = Math.abs(rawBal) < 1.0 ? 0 : Math.max(0, Math.round(rawBal));
  const status = deriveInvoiceStatus(total, paidAmt);

  // ── Belt-and-Suspenders Idempotency Guard ─────────────────────────────────
  // Even if the global middleware replayed the response, this ensures the
  // business layer never executes the invoice creation transaction twice for
  // the same logical submission. Reads the same header the middleware uses.
  const rawIdempKey = (req.headers['idempotency-key'] as string)?.trim();
  if (rawIdempKey) {
    const windowStart = new Date(Date.now() - 5 * 60 * 1000); // 5-minute window
    const existingSale = await prisma.sale.findFirst({
      where: {
        clientId,
        branchId,
        createdAt: { gte: windowStart },
        idempotencyKey: rawIdempKey,
      },
      include: {
        items: { include: { product: true } },
        client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, address: true, deliveryLocation: true } },
        deliveries: { include: { driver: true, vehicle: true, employee: true } },
        employee: true,
      },
    });
    if (existingSale) {
      console.log(`[POST /api/sales] Idempotency replay: returning existing invoice ${existingSale.invoiceNo} for key ${rawIdempKey}`);
      return res.status(200).json({ success: true, data: existingSale, replayed: true });
    }
  }

  const startTime = Date.now();
  try {
    const sale = await prisma.$transaction(async tx => {
      const t0 = Date.now();
      // 1. Parallelize Initial Reads (Invoice No, User Validation, Client, Last Ledger)
      const [invoiceNo, validatedUserId, cRecord, lastLedger] = await Promise.all([
        generateInvoiceNo(clientId, branchId, tx),
        getValidUserId(userId, tx),
        tx.client.findUnique({
          where: { id: clientId },
          select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, address: true, deliveryLocation: true, currentBalance: true, creditLimit: true }
        }),
        tx.customerLedger.findFirst({
          where: { clientId },
          orderBy: { date: 'desc' },
          select: { date: true }
        }),
      ]);
      const t_initReads = Date.now() - t0;

      const previousBalance = cRecord?.currentBalance ?? 0;
      const newClientBalance = Math.max(0, Math.round(previousBalance + total - paidAmt));
      const previousBalanceDate = lastLedger?.date ?? null;

      // 2. Batch-resolve product IDs & fetch all inventory records in parallel
      const t1 = Date.now();
      const missingNameItems = items.filter((i: any) => !i.productId && (i.itemName || i.name));
      if (missingNameItems.length > 0) {
        const itemNames = missingNameItems.map((i: any) => String(i.itemName || i.name).trim());
        const matchedProducts = await tx.product.findMany({
          where: { name: { in: itemNames, mode: 'insensitive' } },
          select: { id: true, name: true }
        });
        const nameMap = new Map(matchedProducts.map((p: any) => [p.name.toLowerCase(), p.id]));
        for (const item of items) {
          if (!item.productId && (item.itemName || item.name)) {
            const foundId = nameMap.get(String(item.itemName || item.name).trim().toLowerCase());
            if (foundId) item.productId = foundId;
          }
        }
      }

      const productIds = items.map((i: any) => i.productId).filter(Boolean);
      const invRecords = await tx.inventory.findMany({
        where: { productId: { in: productIds }, branchId },
        select: { productId: true, qty: true, reservedQty: true, avgCost: true, currentBuyPrice: true }
      });
      const invMap = new Map(invRecords.map((r: any) => [r.productId, r]));

      // 3. Validate stock availability & lock cost basis in-memory
      for (const item of items) {
        if (item.productId) {
          const inv: any = invMap.get(item.productId);
          const currentQty = inv?.qty ?? 0;
          const reserved = inv?.reservedQty ?? 0;
          const available = Math.max(0, currentQty - reserved);
          const requestedQty = Number(item.qty);

          if (requestedQty > available) {
            const prodName = item.itemName ?? item.name ?? 'Product';
            throw new Error(`Insufficient inventory stock for ${prodName}. Available: ${available} ${item.unit ?? 'KG'}, Requested: ${requestedQty} ${item.unit ?? 'KG'}`);
          }
        }
      }

      const itemsWithCost = items.map((i: any) => {
        let itemCost = 0;
        if (i.productId) {
          const inv: any = invMap.get(i.productId);
          itemCost = inv?.avgCost && inv.avgCost > 0 ? inv.avgCost : (inv?.currentBuyPrice ?? 0);
        }
        return {
          ...i,
          costPrice: itemCost > 0 ? itemCost : 0,
        };
      });
      const t_inv = Date.now() - t1;

      // 4. Lean Sale Creation (Omit heavy nested joins inside transaction)
      const t2 = Date.now();
      const saleDate = parseInputDateToUtc(date);
      const s = await tx.sale.create({
        data: {
          invoiceNo,
          clientId,
          branchId,
          userId: validatedUserId ?? undefined,
          date: saleDate,
          subtotal,
          discount: Number(discount),
          deliveryCharge: Number(deliveryCharge),
          previousBalance,
          previousBalanceDate,
          total,
          paid: paidAmt,
          balance,
          status: status as any,
          paymentMode,
          notes: notes?.trim() ?? undefined,
          employeeId: employeeId || undefined,
          deliveryDate: deliveryDate ? parseInputDateToUtc(deliveryDate) : undefined,
          deliveryTime: deliveryTime || undefined,
          idempotencyKey: rawIdempKey || undefined,
          items: {
            create: itemsWithCost.map((i: any) => ({
              productId: i.productId || undefined,
              itemName: i.itemName ?? i.name ?? 'Item',
              qty: Number(i.qty),
              unit: i.unit ?? 'KG',
              rate: Number(i.rate),
              amount: Number(i.qty) * Number(i.rate),
              costPrice: Number(i.costPrice),
            })),
          },
        },
        include: {
          items: { include: { product: true } },
        },
      });
      const t_saleCreate = Date.now() - t2;

      // 5. Create Delivery Record
      const t3 = Date.now();
      const delivRecord = await tx.delivery.create({
        data: {
          saleId: s.id,
          clientId,
          branchId,
          employeeId: employeeId || undefined,
          date: deliveryDate ? new Date(deliveryDate) : s.date,
          scheduledTime: deliveryTime || undefined,
          status: 'PENDING',
        }
      });
      const t_delivCreate = Date.now() - t3;

      // 6. Parallel Inventory Updates & Stock Movements
      const t4 = Date.now();
      const stockMovementsToCreate: any[] = [];
      const invUpdatePromises: Promise<any>[] = [];

      for (const item of items.filter((item: any) => item.productId)) {
        const inv: any = invMap.get(item.productId);
        const oldQty = inv?.qty ?? 0;
        const requestedQty = Number(item.qty);
        const newQty = Math.max(0, oldQty - requestedQty);
        const newAvgCost = newQty <= 0 ? 0 : (inv?.avgCost ?? 0);

        if (inv) {
          inv.qty = newQty;
          inv.avgCost = newAvgCost;
        }

        invUpdatePromises.push(
          tx.inventory.updateMany({
            where: { productId: item.productId, branchId },
            data: { qty: newQty, avgCost: newAvgCost },
          })
        );

        stockMovementsToCreate.push({
          productId: item.productId,
          branchId,
          type: 'SALE',
          qty: -requestedQty,
          previousStock: oldQty,
          newStock: newQty,
          refType: 'sale',
          refId: s.id,
          userId: validatedUserId ?? undefined,
          date: new Date(),
          note: `Stock OUT — ${invoiceNo} | Qty: -${requestedQty} ${item.unit ?? 'KG'}`,
        });
      }

      await Promise.all([
        ...invUpdatePromises,
        stockMovementsToCreate.length > 0
          ? tx.stockMovement.createMany({ data: stockMovementsToCreate })
          : Promise.resolve(),
      ]);
      const t_stockOut = Date.now() - t4;

      // 7. Bulk Customer Ledger & Auto-Collection
      const t5 = Date.now();
      const invoiceBal = previousBalance + total;
      const ledgerEntries: any[] = [
        {
          clientId,
          branchId,
          type: 'INVOICE',
          date: s.date,
          referenceId: s.id,
          referenceNo: s.invoiceNo,
          description: 'Invoice Generated',
          debit: total,
          credit: 0,
          balance: invoiceBal,
        }
      ];

      if (paidAmt > 0) {
        const coll = await tx.collection.create({
          data: {
            clientId,
            branchId,
            amount: paidAmt,
            method: paymentMode === 'CASH' ? 'CASH' : paymentMode === 'ONLINE' ? 'ONLINE' : 'BANK',
            date: s.date,
            reference: `Auto payment for ${s.invoiceNo}`,
            notes: 'Created automatically via sales checkout',
            receivedByUserId: validatedUserId ?? undefined,
          }
        });

        await tx.collectionAllocation.create({
          data: {
            collectionId: coll.id,
            saleId: s.id,
            allocatedAmount: paidAmt,
          }
        });

        ledgerEntries.push({
          clientId,
          branchId,
          type: 'PAYMENT',
          date: s.date,
          referenceId: coll.id,
          referenceNo: s.invoiceNo,
          description: 'Payment Received (Auto)',
          debit: 0,
          credit: paidAmt,
          balance: newClientBalance,
        });
      }

      await tx.customerLedger.createMany({
        data: ledgerEntries,
      });

      await tx.client.update({
        where: { id: clientId },
        data: { currentBalance: newClientBalance },
      });
      const t_custLedger = Date.now() - t5;

      // 8. Financial Ledger Bulk Post
      const t6 = Date.now();
      const totalCogs = s.items.reduce((sum, item) => sum + (item.qty * item.costPrice), 0);
      await postSaleLedger(tx, {
        branchId,
        saleId: s.id,
        invoiceNo: s.invoiceNo,
        clientId,
        date: s.date,
        total: s.total,
        paid: s.paid,
        cogs: totalCogs,
        deliveryCharge: s.deliveryCharge,
      });
      const t_finLedger = Date.now() - t6;

      console.log(`⏱️ [POST /api/sales Breakdown] initReads:${t_initReads}ms inv:${t_inv}ms saleCreate:${t_saleCreate}ms deliv:${t_delivCreate}ms stockOut:${t_stockOut}ms custLedger:${t_custLedger}ms finLedger:${t_finLedger}ms | totalTx:${Date.now() - startTime}ms`);

      return {
        ...s,
        client: cRecord,
        deliveries: [delivRecord],
      };
    }, { maxWait: 15000, timeout: 120000 });

    // Non-blocking asynchronous updates outside transaction
    updateClientCreditRating(clientId).catch(() => {});
    writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Sale', entityId: sale.id, newData: { invoiceNo: sale.invoiceNo, total } }).catch(() => {});
    clearSalesCache();

    return res.status(201).json({ success: true, data: sale });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[POST /api/sales] Transaction Failed:', {
      endpoint: 'POST /api/sales',
      durationMs,
      clientId,
      error: error.message ?? String(error),
    });
    return res.status(500).json({ success: false, error: error.message ?? 'Invoice generation failed. Please try again.' });
  }
});

// GET /api/sales/:id — Get sale details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const sale = await prisma.sale.findUnique({
      where: { id, deletedAt: null },
      include: {
        client: true,
        items: { include: { product: true } },
        deliveries: { include: { driver: true, vehicle: true, employee: true } },
        employee: true,
      },
    });
    if (!sale) {
      return res.status(404).json({ success: false, error: 'Invoice not found' });
    }
    return res.json({ success: true, data: sale });
  } catch (err: any) {
    console.error('[GET /api/sales/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load invoice details' });
  }
});

// GET /api/sales/:id/audit-trail — Get audit history of an invoice
router.get('/:id/audit-trail', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = await prisma.auditLog.findMany({
      where: {
        entity: 'Sale',
        entityId: id,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json({ success: true, data: logs });
  } catch (err: any) {
    console.error('[GET /api/sales/:id/audit-trail]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load audit trail' });
  }
});

// PUT /api/sales/:id — Edit an existing invoice (Same-Day Editable Invoice Workflow)
router.put('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Branch not found in token' });
  }

  const { id } = req.params;
  const {
    items, discount = 0, deliveryCharge = 0,
    notes, employeeId, deliveryDate, deliveryTime, reason,
  } = req.body;

  const validationError = validateSalesInput(items, discount, deliveryCharge);
  if (validationError) {
    return res.status(400).json({ success: false, error: validationError });
  }

  const rawSubtotal = items.reduce((s: number, i: any) => s + (Number(i.qty) * Number(i.rate)), 0);
  const subtotal = Math.round(rawSubtotal);
  const rawTotal = subtotal - Number(discount) + Number(deliveryCharge);
  const total = Math.max(0, Math.round(rawTotal));

  try {
    const updatedSale = await prisma.$transaction(async tx => {
      // 1. Authoritative baseline: Fetch current persisted invoice inside the transaction
      const existingSale = await tx.sale.findUnique({
        where: { id, deletedAt: null },
        include: {
          items: { include: { product: true } },
          client: true,
          deliveries: true,
        }
      });

      if (!existingSale) {
        throw new Error('Invoice not found');
      }

      if (existingSale.status === 'CANCELLED') {
        throw new Error('Cannot edit invoice: Invoice is cancelled.');
      }

      if (existingSale.isLocked) {
        throw new Error('Cannot edit invoice: Invoice is locked.');
      }

      const paidAmt = Math.round(Number(existingSale.paid));
      if (paidAmt > total) {
        throw new Error(`Amount paid so far (Rs ${paidAmt.toLocaleString()}) exceeds the new invoice total (Rs ${total.toLocaleString()}). Please adjust discount/charges or refund excess payment.`);
      }

      const rawBal = total - paidAmt;
      const balance = Math.abs(rawBal) < 1.0 ? 0 : Math.max(0, Math.round(rawBal));
      const status = deriveInvoiceStatus(total, paidAmt);
      const validatedUserId = await getValidUserId(userId, tx);

      // 2. Resolve Product IDs and determine costPrice for each submitted line item
      const resolvedNewItems = await Promise.all(
        items.map(async (i: any) => {
          let pid = i.productId && String(i.productId).trim() ? String(i.productId).trim() : null;
          const itemName = i.itemName ?? i.name ?? 'Item';
          if (!pid && itemName) {
            const match = await tx.product.findFirst({
              where: { name: { equals: itemName.trim(), mode: 'insensitive' } },
              select: { id: true }
            });
            if (match) pid = match.id;
          }

          // Retain existing costPrice if unchanged product, or lookup from current inventory
          let costBasis = 0;
          if (pid) {
            const existingLine = existingSale.items.find(oldI => oldI.productId === pid);
            if (existingLine && existingLine.costPrice > 0) {
              costBasis = existingLine.costPrice;
            } else {
              const inv = await tx.inventory.findUnique({
                where: { productId_branchId: { productId: pid, branchId } },
                select: { avgCost: true, currentBuyPrice: true }
              });
              costBasis = inv?.avgCost && inv.avgCost > 0 ? inv.avgCost : (inv?.currentBuyPrice ?? 0);
            }
          }

          return {
            productId: pid,
            itemName,
            qty: Number(i.qty),
            unit: i.unit ?? 'KG',
            rate: Number(i.rate),
            amount: Number(i.qty) * Number(i.rate),
            costPrice: costBasis,
          };
        })
      );

      // 3. Difference-based stock synchronization (calculates exact delta per product)
      await syncInvoiceEditStock(tx, {
        saleId: existingSale.id,
        invoiceNo: existingSale.invoiceNo,
        branchId,
        userId: validatedUserId ?? undefined,
        oldItems: existingSale.items.map(i => ({
          productId: i.productId || '',
          qty: i.qty - (i.returnedQty || 0),
          unit: i.unit,
          itemName: i.itemName,
        })),
        newItems: resolvedNewItems.map(i => ({
          productId: i.productId || '',
          qty: i.qty,
          unit: i.unit,
          itemName: i.itemName,
        })),
      });

      // 4. Replace SaleItems and update Sale record
      await tx.saleItem.deleteMany({ where: { saleId: existingSale.id } });

      const updated = await tx.sale.update({
        where: { id: existingSale.id },
        data: {
          subtotal,
          discount: Number(discount),
          deliveryCharge: Number(deliveryCharge),
          total,
          balance,
          status: status as any,
          notes: notes?.trim() ?? undefined,
          employeeId: employeeId || undefined,
          deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
          deliveryTime: deliveryTime || undefined,
          items: {
            create: resolvedNewItems.map(i => ({
              productId: i.productId || undefined,
              itemName: i.itemName,
              qty: i.qty,
              unit: i.unit,
              rate: i.rate,
              amount: i.amount,
              costPrice: i.costPrice,
            })),
          },
        },
        include: {
          items: { include: { product: true } },
          client: true,
          deliveries: { include: { driver: true, vehicle: true, employee: true } },
          employee: true,
        }
      });

      // 5. Update linked delivery record if present
      if (existingSale.deliveries.length > 0) {
        await tx.delivery.updateMany({
          where: { saleId: existingSale.id },
          data: {
            employeeId: employeeId || undefined,
            date: deliveryDate ? parseInputDateToUtc(deliveryDate) : existingSale.date,
            scheduledTime: deliveryTime || undefined,
          }
        });
      }

      // 6. Update Customer Ledger entry for this invoice
      const ledgerEntry = await tx.customerLedger.findFirst({
        where: {
          clientId: existingSale.clientId,
          type: 'INVOICE',
          referenceId: existingSale.id,
        }
      });

      if (ledgerEntry) {
        await tx.customerLedger.update({
          where: { id: ledgerEntry.id },
          data: {
            debit: total,
            description: `Invoice Updated (#${existingSale.invoiceNo})`,
          }
        });
      } else {
        await recordCustomerLedgerEntry(tx, {
          clientId: existingSale.clientId,
          branchId,
          type: 'INVOICE',
          date: existingSale.date,
          referenceId: existingSale.id,
          referenceNo: existingSale.invoiceNo,
          description: `Invoice Updated (#${existingSale.invoiceNo})`,
          debit: total,
          credit: 0,
        });
      }

      // 7. Single Source of Truth: Reconcile client allocations, invoice statuses, customer ledger & current balance
      await reconcileClientBalancesAndAllocations(existingSale.clientId, tx);

      // 8. Synchronize Financial Ledger double-entry records for this edited invoice
      let updatedCogs = 0;
      for (const item of updated.items) {
        const costBasis = (item as any).costPrice > 0 ? (item as any).costPrice : 0;
        updatedCogs += item.qty * costBasis;
      }

      await tx.financialLedger.deleteMany({
        where: { referenceId: existingSale.id, referenceType: 'sale' },
      });

      await postSaleLedger(tx, {
        branchId,
        saleId: existingSale.id,
        invoiceNo: existingSale.invoiceNo,
        clientId: existingSale.clientId,
        date: existingSale.date,
        total,
        paid: paidAmt,
        cogs: updatedCogs,
        deliveryCharge: Number(deliveryCharge),
      });

      // 9. Build structured changes summary for audit log
      const oldItemsMap = new Map(existingSale.items.map(i => [i.productId || i.itemName.toLowerCase(), i]));
      const newItemsMap = new Map(resolvedNewItems.map(i => [i.productId || i.itemName.toLowerCase(), i]));

      const changesSummary: string[] = [];

      for (const [key, newItem] of Array.from(newItemsMap.entries())) {
        const oldItem = oldItemsMap.get(key);
        if (!oldItem) {
          changesSummary.push(`+ ${newItem.itemName} ${newItem.qty} ${newItem.unit} @ Rs ${newItem.rate}`);
        } else if (Number(oldItem.qty) !== Number(newItem.qty) || Number(oldItem.rate) !== Number(newItem.rate)) {
          changesSummary.push(`${oldItem.itemName}: ${oldItem.qty} ${oldItem.unit} → ${newItem.qty} ${newItem.unit} @ Rs ${newItem.rate}`);
        }
      }

      for (const [key, oldItem] of Array.from(oldItemsMap.entries())) {
        if (!newItemsMap.has(key)) {
          changesSummary.push(`- ${oldItem.itemName} (${oldItem.qty} ${oldItem.unit}) removed`);
        }
      }

      if (existingSale.total !== total) {
        changesSummary.push(`Total: Rs ${existingSale.total.toLocaleString()} → Rs ${total.toLocaleString()}`);
      }

      // 10. Record Audit Log
      await tx.auditLog.create({
        data: {
          userId: validatedUserId ?? undefined,
          branchId,
          action: 'EDIT_INVOICE',
          entity: 'Sale',
          entityId: existingSale.id,
          oldData: {
            subtotal: existingSale.subtotal,
            total: existingSale.total,
            items: existingSale.items.map(i => ({ name: i.itemName, qty: i.qty, rate: i.rate, amount: i.amount })),
            notes: existingSale.notes,
          },
          newData: {
            subtotal,
            total,
            items: resolvedNewItems.map(i => ({ name: i.itemName, qty: i.qty, rate: i.rate, amount: i.amount })),
            notes,
            reason: reason || undefined,
            changesSummary,
          }
        }
      });

      return updated;
    }, { maxWait: 15000, timeout: 120000 });

    const clientToUpdate = (updatedSale as any)?.clientId;
    if (clientToUpdate) {
      updateClientCreditRating(clientToUpdate).catch(err =>
        console.warn('[PUT /api/sales/:id] Async credit rating update warning:', err)
      );
    }

    clearSalesCache();
    return res.json({ success: true, data: updatedSale });
  } catch (error: any) {
    console.error('[PUT /api/sales/:id] Error editing invoice:', error);
    return res.status(error.message?.includes('Insufficient') || error.message?.includes('Cannot edit') ? 400 : 500).json({
      success: false,
      error: error.message ?? 'Failed to edit invoice.'
    });
  }
});

// PATCH /api/sales/:id — Record additional payment on invoice
router.patch('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  const { id } = req.params;
  const { additionalPayment } = req.body;
  const amt = Number(additionalPayment);

  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Valid payment amount is required' });
  }

  try {
    const result = await prisma.$transaction(async tx => {
      const sale = await tx.sale.findUnique({
        where: { id, deletedAt: null },
        include: { client: true }
      });
      if (!sale) throw new Error('Invoice not found');

      if (amt > sale.balance + 0.001) {
        const err: any = new Error(`Payment (Rs ${amt.toLocaleString()}) cannot exceed remaining balance (Rs ${sale.balance.toLocaleString()})`);
        err.statusCode = 422;
        err.code = 'PAYMENT_EXCEEDS_OUTSTANDING';
        err.outstanding = sale.balance;
        err.attempted = amt;
        throw err;
      }

      const newPaid = sale.paid + amt;
      const rawBal = sale.balance - amt;
      const newBalance = rawBal < 1.0 ? 0 : Math.max(0, rawBal);
      const newStatus = deriveInvoiceStatus(sale.total, newPaid);

      const updatedSale = await tx.sale.update({
        where: { id },
        data: {
          paid: newPaid,
          balance: newBalance,
          status: newStatus,
        },
        include: {
          items: { include: { product: true } },
          client: true,
          deliveries: { include: { driver: true, vehicle: true } }
        }
      });

      // Resolve receivedByUserId from authenticated user token (same pattern as POST /api/sales)
      const receivedByUserId = await getValidUserId(userId, tx);

      // Record collection
      const coll = await tx.collection.create({
        data: {
          clientId: sale.clientId,
          branchId,
          amount: amt,
          method: 'CASH', // default
          date: new Date(),
          reference: `Payment for ${sale.invoiceNo}`,
          notes: `Additional payment recorded against invoice`,
          receivedByUserId,
        }
      });

      // Create CollectionAllocation to properly link payment to invoice
      await tx.collectionAllocation.create({
        data: {
          collectionId: coll.id,
          saleId: sale.id,
          allocatedAmount: amt,
        }
      });

      // Record customer ledger entry — this updates Client.currentBalance as the single source of truth
      await recordCustomerLedgerEntry(tx, {
        clientId: sale.clientId,
        branchId,
        type: 'PAYMENT',
        date: new Date(),
        referenceId: coll.id,
        referenceNo: sale.invoiceNo,
        description: `Payment Received for ${sale.invoiceNo}`,
        debit: 0,
        credit: amt,
      });

      // NOTE: Client.currentBalance is updated by recordCustomerLedgerEntry above.
      // Do NOT manually decrement client.currentBalance here — the ledger engine is the single source of truth.

      // Post to Financial Ledger
      await postCollectionLedger(tx, {
        branchId,
        collectionId: coll.id,
        clientId: sale.clientId,
        date: coll.date,
        amount: amt,
        method: coll.method,
        reference: coll.reference || undefined,
      });

      await updateClientCreditRating(sale.clientId, tx);

      // Final verification: recalculate ledger & balance inside the transaction
      await recalculateClientLedgerAndBalance(sale.clientId, tx);

      return { sale: updatedSale, collection: coll };
    }, { maxWait: 15000, timeout: 120000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Sale',
      entityId: id,
      newData: { additionalPayment: amt, newBalance: result.sale.balance }
    });

    clearSalesCache();
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[PATCH /api/sales/:id]', err);
    const status = err.statusCode || (err.code === 'PAYMENT_EXCEEDS_OUTSTANDING' ? 422 : 500);
    return res.status(status).json({
      success: false,
      code: err.code || 'UPDATE_PAYMENT_ERROR',
      error: err.message ?? 'Failed to update invoice payment',
      outstanding: err.outstanding,
      attempted: err.attempted,
    });
  }
});

// POST /api/sales/:id/cancel - Cancel an invoice
router.post('/:id/cancel', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;
  const { id } = req.params;
  const { reason } = req.body;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch' });
  }

  try {
    const updatedSale = await prisma.$transaction(async tx => {
      const sale = await tx.sale.findUnique({
        where: { id, deletedAt: null },
        include: { items: { include: { product: true } }, client: true }
      });

      if (!sale) throw new Error('Invoice not found');
      if (sale.status === 'CANCELLED') throw new Error('Invoice is already cancelled');

      for (const item of sale.items) {
        if (item.productId) {
          await stockReturn(tx, {
            productId: item.productId,
            branchId,
            qty: Number(item.qty) - Number((item as any).returnedQty || 0),
            unit: item.unit || 'KG',
            refType: 'sale_cancelled',
            refId: sale.id,
            refNo: sale.invoiceNo,
            reason: 'Invoice Cancelled' + (reason ? ` - ${reason}` : '')
          });
        }
      }

      const cancelledSale = await tx.sale.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          balance: 0,
        },
        include: {
          items: { include: { product: true } },
          client: true,
        }
      });

      if (sale.balance > 0) {
        await recordCustomerLedgerEntry(tx, {
          clientId: sale.clientId,
          branchId,
          type: 'CANCELLATION',
          date: new Date(),
          referenceId: sale.id,
          referenceNo: sale.invoiceNo,
          description: 'Invoice Cancelled',
          debit: 0,
          credit: sale.balance
        });
        await reconcileClientBalancesAndAllocations(sale.clientId, tx);
      }

      return cancelledSale;
    }, { maxWait: 15000, timeout: 120000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CANCEL',
      entity: 'Sale',
      entityId: id,
      newData: { reason, newStatus: 'CANCELLED' }
    });

    clearSalesCache();
    return res.json({ success: true, data: updatedSale });
  } catch (err: any) {
    console.error('[POST /api/sales/:id/cancel]', err);
    return res.status(err.message === 'Invoice is already cancelled' ? 400 : 500).json({
      success: false,
      error: err.message ?? 'Failed to cancel invoice'
    });
  }
});

export default router;
