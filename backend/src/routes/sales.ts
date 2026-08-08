import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { generateInvoiceNo, writeAuditLog, getClientBalance, getValidUserId, recordCustomerLedgerEntry, recalculateClientLedgerAndBalance, syncPriceListFromSale } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { stockOut } from '../lib/inventoryService';
import { getBusinessDateRange, getBusinessDateString, getCurrentBusinessDateRange, parseInputDateToUtc } from '../lib/businessDate';
import { postSaleLedger } from '../lib/financialLedgerService';

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
      items: { include: { product: { select: { id: true, name: true, urduName: true } } } },
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
    const limit = Math.min(parseInt(String(limitQuery ?? '100')), 500);

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
        items: { include: { product: { select: { id: true, name: true, urduName: true } } } },
        employee: true,
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
  if (!items?.length) return res.status(400).json({ success: false, error: 'At least one item is required' });

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

  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.qty) * Number(i.rate)), 0);
  const total = Math.max(0, subtotal - Number(discount) + Number(deliveryCharge));
  const paidAmt = Number(paid);

  if (paidAmt > total) {
    return res.status(400).json({
      success: false,
      error: `Amount paid (Rs ${paidAmt.toLocaleString()}) cannot exceed invoice total (Rs ${total.toLocaleString()})`
    });
  }

  const balance = Math.max(0, total - paidAmt);
  const status = paidAmt >= total ? 'PAID' : paidAmt > 0 ? 'PARTIAL' : 'PENDING';

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

      // Validate inventory stock availability for all items with productId
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
          return {
            ...i,
            costPrice: itemCost > 0 ? itemCost : (Number(i.rate) * 0.75),
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

      // Execute Delivery assignment, Inventory StockOuts, and Ledger in parallel
      await Promise.all([
        tx.delivery.create({
          data: {
            saleId: s.id,
            clientId,
            branchId,
            employeeId: employeeId || undefined,
            date: deliveryDate ? new Date(deliveryDate) : s.date,
            scheduledTime: deliveryTime || undefined,
            status: 'PENDING',
          }
        }),
        Promise.all(
          items
            .filter((item: any) => item.productId)
            .map((item: any) =>
              stockOut(tx, {
                productId: item.productId,
                branchId,
                qty: Number(item.qty),
                unit: item.unit ?? 'KG',
                refType: 'sale',
                refId: s.id,
                refNo: invoiceNo,
                userId: validatedUserId ?? undefined,
                date: s.date,
              })
            )
        )
      ]);

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

      await tx.client.update({
        where: { id: clientId },
        data: { currentBalance: newClientBalance }
      });

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

  if (!items?.length) return res.status(400).json({ success: false, error: 'At least one item is required' });

  const existingSale = await prisma.sale.findUnique({
    where: { id, deletedAt: null },
    include: {
      items: { include: { product: true } },
      client: true,
      deliveries: true,
    }
  });

  if (!existingSale) {
    return res.status(404).json({ success: false, error: 'Invoice not found' });
  }

  // Permission Checks:
  if (existingSale.status === 'CANCELLED') {
    return res.status(400).json({ success: false, error: 'Cannot edit invoice: Invoice is cancelled.' });
  }

  if (existingSale.isLocked) {
    return res.status(400).json({ success: false, error: 'Cannot edit invoice: Invoice is locked.' });
  }

  const subtotal = items.reduce((s: number, i: any) => s + (Number(i.qty) * Number(i.rate)), 0);
  const total = Math.max(0, subtotal - Number(discount) + Number(deliveryCharge));
  const paidAmt = Number(existingSale.paid);

  if (paidAmt > total) {
    return res.status(400).json({
      success: false,
      error: `Amount paid so far (Rs ${paidAmt.toLocaleString()}) exceeds the new invoice total (Rs ${total.toLocaleString()}). Please adjust discount/charges or refund excess payment.`
    });
  }

  const balance = Math.max(0, total - paidAmt);
  const status = paidAmt >= total ? 'PAID' : paidAmt > 0 ? 'PARTIAL' : 'PENDING';

  try {
    const updatedSale = await prisma.$transaction(async tx => {
      const validatedUserId = await getValidUserId(userId, tx);

      // 1. Revert stock for OLD items
      for (const oldItem of existingSale.items) {
        if (oldItem.productId) {
          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: oldItem.productId, branchId } },
            select: { qty: true }
          });
          const currentQty = inv?.qty ?? 0;
          const restoredQty = currentQty + oldItem.qty;

          await tx.inventory.upsert({
            where: { productId_branchId: { productId: oldItem.productId, branchId } },
            update: { qty: restoredQty },
            create: { productId: oldItem.productId, branchId, qty: restoredQty, avgCost: 0 }
          });

          await tx.stockMovement.create({
            data: {
              productId: oldItem.productId,
              branchId,
              type: 'ADJUSTMENT',
              qty: oldItem.qty,
              previousStock: currentQty,
              newStock: restoredQty,
              refType: 'sale_edit_reversal',
              refId: existingSale.id,
              userId: validatedUserId ?? undefined,
              date: new Date(),
              note: `Invoice Edit Stock Reversal — ${existingSale.invoiceNo} | Restored +${oldItem.qty} ${oldItem.unit}`,
            }
          });
        }
      }

      // 2. Validate & deduct stock for NEW items
      for (const newItem of items) {
        if (newItem.productId) {
          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: newItem.productId, branchId } },
            select: { qty: true, reservedQty: true }
          });
          const currentQty = inv?.qty ?? 0;
          const reserved = inv?.reservedQty ?? 0;
          const available = Math.max(0, currentQty - reserved);
          const requestedQty = Number(newItem.qty);

          if (requestedQty > available) {
            const prodName = newItem.itemName ?? newItem.name ?? 'Product';
            throw new Error(`Insufficient inventory stock for ${prodName}. Available: ${available} ${newItem.unit ?? 'KG'}, Requested: ${requestedQty} ${newItem.unit ?? 'KG'}`);
          }
        }
      }

      for (const newItem of items) {
        if (newItem.productId) {
          const inv = await tx.inventory.findUnique({
            where: { productId_branchId: { productId: newItem.productId, branchId } },
            select: { qty: true }
          });
          const currentQty = inv?.qty ?? 0;
          const newQty = Math.max(0, currentQty - Number(newItem.qty));

          await tx.inventory.upsert({
            where: { productId_branchId: { productId: newItem.productId, branchId } },
            update: { qty: newQty },
            create: { productId: newItem.productId, branchId, qty: 0, avgCost: 0 }
          });

          await tx.stockMovement.create({
            data: {
              productId: newItem.productId,
              branchId,
              type: 'SALE',
              qty: -Number(newItem.qty),
              previousStock: currentQty,
              newStock: newQty,
              refType: 'sale',
              refId: existingSale.id,
              userId: validatedUserId ?? undefined,
              date: existingSale.date,
              note: `Invoice Edit Stock Out — ${existingSale.invoiceNo} | Qty: -${newItem.qty} ${newItem.unit ?? 'KG'}`,
            }
          });
        }
      }

      // 3. Replace SaleItems and update Sale record
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
            create: items.map((i: any) => ({
              productId: i.productId || undefined,
              itemName: i.itemName ?? i.name ?? 'Item',
              qty: Number(i.qty),
              unit: i.unit ?? 'KG',
              rate: Number(i.rate),
              amount: Number(i.qty) * Number(i.rate),
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

      // 4. Update linked delivery record if present
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

      // 5. Update Customer Ledger entry for this invoice
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

      // Recalculate client running balance chronologically
      await recalculateClientLedgerAndBalance(existingSale.clientId, tx);

      // Build structured changes summary for audit log
      const oldItemsMap = new Map(existingSale.items.map(i => [i.itemName.toLowerCase(), i]));
      const newItemsMap = new Map(items.map((i: any) => [(i.itemName ?? i.name ?? '').toLowerCase(), i]));

      const changesSummary: string[] = [];

      for (const [name, newItemRaw] of Array.from(newItemsMap.entries())) {
        const newItem = newItemRaw as any;
        const oldItem = oldItemsMap.get(String(name));
        if (!oldItem) {
          changesSummary.push(`+ ${newItem.itemName ?? newItem.name} ${newItem.qty} ${newItem.unit ?? 'KG'} @ Rs ${newItem.rate}`);
        } else if (Number(oldItem.qty) !== Number(newItem.qty) || Number(oldItem.rate) !== Number(newItem.rate)) {
          changesSummary.push(`${oldItem.itemName}: ${oldItem.qty} ${oldItem.unit} → ${newItem.qty} ${newItem.unit ?? 'KG'} @ Rs ${newItem.rate}`);
        }
      }

      for (const [name, oldItem] of Array.from(oldItemsMap.entries())) {
        if (!newItemsMap.has(String(name))) {
          changesSummary.push(`- ${oldItem.itemName} (${oldItem.qty} ${oldItem.unit}) removed`);
        }
      }

      if (existingSale.total !== total) {
        changesSummary.push(`Total: Rs ${existingSale.total.toLocaleString()} → Rs ${total.toLocaleString()}`);
      }

      // Record Audit Log
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
            items: items.map((i: any) => ({ name: i.itemName ?? i.name, qty: i.qty, rate: i.rate, amount: Number(i.qty) * Number(i.rate) })),
            notes,
            reason: reason || undefined,
            changesSummary,
          }
        }
      });

      return updated;
    }, { maxWait: 10000, timeout: 30000 });

    updateClientCreditRating(existingSale.clientId).catch(err =>
      console.warn('[PUT /api/sales/:id] Async credit rating update warning:', err)
    );

    return res.json({ success: true, data: updatedSale });
  } catch (error: any) {
    console.error('[PUT /api/sales/:id] Error editing invoice:', error);
    return res.status(500).json({ success: false, error: error.message ?? 'Failed to edit invoice.' });
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

      if (amt > sale.balance) {
        throw new Error(`Payment (Rs ${amt.toLocaleString()}) cannot exceed remaining balance (Rs ${sale.balance.toLocaleString()})`);
      }

      const newPaid = sale.paid + amt;
      const newBalance = Math.max(0, sale.balance - amt);
      const newStatus = newBalance <= 0 ? 'PAID' : 'PARTIAL';

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
        }
      });

      // Record customer ledger entry
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

      // Update client's balance
      await tx.client.update({
        where: { id: sale.clientId },
        data: {
          currentBalance: {
            decrement: amt
          }
        }
      });

      await updateClientCreditRating(sale.clientId, tx);

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
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update invoice payment' });
  }
});

export default router;
