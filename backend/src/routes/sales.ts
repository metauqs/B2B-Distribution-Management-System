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

// GET /api/sales — List sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { clientId, status, mode, search, from, to, limit: limitQuery } = req.query;
    const limit = limitQuery ? Math.min(parseInt(String(limitQuery)), 5000) : 200;

    const dateFrom = from ? getBusinessDateRange(String(from)).start : undefined;
    const dateTo = to ? getBusinessDateRange(String(to)).end : undefined;

    if (dateFrom && isNaN(dateFrom.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid from date', data: [] });
    }
    if (dateTo && isNaN(dateTo.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid to date', data: [] });
    }

    const where: any = {
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(clientId ? { clientId: String(clientId) } : {}),
      ...(status && status !== 'all' ? { status: status as any } : {}),
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

    const sales = await prisma.sale.findMany({
      where,
      include: {
        client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, type: true } },
        items: { include: { product: { select: { id: true, name: true, urduName: true, emoji: true, imageUrl: true } } } },
        employee: { select: { id: true, name: true, role: true, phone: true } },
      },
      orderBy: { date: 'asc' },
      take: limit,
    });

    return res.json({ success: true, data: sales });
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

  const startTime = Date.now();
  try {
    const sale = await prisma.$transaction(async tx => {
      const invoiceNo = await generateInvoiceNo(clientId, branchId, tx);
      const validatedUserId = await getValidUserId(userId, tx);

      const cRecord = await tx.client.findUnique({
        where: { id: clientId },
        select: { currentBalance: true }
      });
      const previousBalance = cRecord?.currentBalance ?? 0;
      const newClientBalance = previousBalance + total - paidAmt;

      if (client.creditLimit > 0) {
        if (newClientBalance > client.creditLimit) {
          console.warn(`Credit limit exceeded for client ${client.name}: ${newClientBalance} > ${client.creditLimit}`);
        }
      }

      const lastLedger = await tx.customerLedger.findFirst({
        where: { clientId },
        orderBy: { date: 'desc' }
      });
      const previousBalanceDate = lastLedger?.date ?? null;

      // 1. Resolve Product IDs for all items if not explicitly provided
      for (const item of items) {
        if (!item.productId && (item.itemName || item.name)) {
          const match = await tx.product.findFirst({
            where: { name: { equals: String(item.itemName || item.name).trim(), mode: 'insensitive' } },
            select: { id: true }
          });
          if (match) item.productId = match.id;
        }
      }

      // 2. Validate inventory stock availability for all items with productId
      for (const item of items) {
        if (item.productId) {
          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: item.productId, branchId } },
            select: { qty: true, reservedQty: true },
          });
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

      // Look up current inventory cost for each product item to lock cost basis
      const itemsWithCost = await Promise.all(
        items.map(async (i: any) => {
          let itemCost = 0;
          if (i.productId) {
            const inv = await tx.inventory.findUnique({
              where: { productId_branchId: { productId: i.productId, branchId } },
              select: { avgCost: true, currentBuyPrice: true },
            });
            itemCost = inv?.avgCost && inv.avgCost > 0 ? inv.avgCost : (inv?.currentBuyPrice ?? 0);
          }
          if (itemCost <= 0) {
            console.warn(`[POST /api/sales] Item '${i.itemName ?? i.name ?? 'Unknown'}' has no cost data. COGS will be recorded as 0.`);
          }
          return {
            ...i,
            costPrice: itemCost > 0 ? itemCost : 0,
          };
        })
      );

      const s = await tx.sale.create({
        data: {
          invoiceNo,
          clientId,
          branchId,
          userId: validatedUserId ?? undefined,
          date: date ? parseInputDateToUtc(date) : new Date(),
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
          deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
          deliveryTime: deliveryTime || undefined,
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
          client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, address: true, deliveryLocation: true } },
          deliveries: { include: { driver: true, vehicle: true, employee: true } },
          employee: true,
        },
      });

      // Create Delivery record
      await tx.delivery.create({
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

      // Inventory StockOuts — sequential to prevent idempotency race condition.
      // Using Promise.all() inside a single Prisma tx causes all concurrent reads
      // to see zero existing movements (uncommitted writes are invisible to parallel
      // reads in the same tx), so every call passes the idempotency check and writes,
      // producing duplicate SALE deductions. Sequential for...of guarantees each
      // stockOut's movement is committed before the next idempotency check runs.
      for (const item of items.filter((item: any) => item.productId)) {
        await stockOut(tx, {
          productId: item.productId,
          branchId,
          qty: Number(item.qty),
          unit: item.unit ?? 'KG',
          refType: 'sale',
          refId: s.id,
          refNo: invoiceNo,
          userId: validatedUserId ?? undefined,
          date: new Date(),
        });
      }

      await recordCustomerLedgerEntry(tx, {
        clientId,
        branchId,
        type: 'INVOICE',
        date: s.date,
        referenceId: s.id,
        referenceNo: s.invoiceNo,
        description: 'Invoice Generated',
        debit: total,
        credit: 0,
      });

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

        // Create CollectionAllocation to link this payment to the invoice
        await tx.collectionAllocation.create({
          data: {
            collectionId: coll.id,
            saleId: s.id,
            allocatedAmount: paidAmt,
          }
        });

        await recordCustomerLedgerEntry(tx, {
          clientId,
          branchId,
          type: 'PAYMENT',
          date: s.date,
          referenceId: coll.id,
          referenceNo: s.invoiceNo,
          description: 'Payment Received (Auto)',
          debit: 0,
          credit: paidAmt,
        });
      }

      // NOTE: Client.currentBalance is updated by recordCustomerLedgerEntry above.
      // Do NOT manually set client.currentBalance here — the ledger engine is the single source of truth.

      // Post to Financial Ledger automatically
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

      // Single Source of Truth: Reconcile client allocations, invoice statuses, customer ledger & current balance
      await reconcileClientBalancesAndAllocations(clientId, tx);

      // Final verification: recalculate ledger & balance inside the transaction
      await recalculateClientLedgerAndBalance(clientId, tx);

      return s;
    }, { maxWait: 10000, timeout: 30000 });

    // Non-blocking credit rating update outside transaction
    updateClientCreditRating(clientId).catch(err =>
      console.warn('[POST /api/sales] Async credit rating update warning:', err)
    );

    await writeAuditLog({ userId: userId ?? undefined, branchId, action: 'CREATE', entity: 'Sale', entityId: sale.id, newData: { invoiceNo: sale.invoiceNo, total } });
    return res.status(201).json({ success: true, data: sale });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    console.error('[POST /api/sales] Transaction Failed:', {
      endpoint: 'POST /api/sales',
      durationMs,
      clientId,
      error: error.message ?? String(error),
      stack: error.stack,
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
    }, { maxWait: 10000, timeout: 30000 });

    const clientToUpdate = (updatedSale as any)?.clientId;
    if (clientToUpdate) {
      updateClientCreditRating(clientToUpdate).catch(err =>
        console.warn('[PUT /api/sales/:id] Async credit rating update warning:', err)
      );
    }

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
    }, { maxWait: 10000, timeout: 30000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Sale',
      entityId: id,
      newData: { additionalPayment: amt, newBalance: result.sale.balance }
    });

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
    }, { maxWait: 10000, timeout: 30000 });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CANCEL',
      entity: 'Sale',
      entityId: id,
      newData: { reason, newStatus: 'CANCELLED' }
    });

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
