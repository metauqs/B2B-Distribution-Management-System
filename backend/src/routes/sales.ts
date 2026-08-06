import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { generateInvoiceNo, writeAuditLog, getClientBalance, getValidUserId, recordCustomerLedgerEntry, syncPriceListFromSale } from '../lib/business';
import { updateClientCreditRating } from '../lib/creditRisk';
import { stockOut } from '../lib/inventoryService';

import { getBusinessDateRange } from '../lib/businessDate';

const router = Router();

// GET /api/sales
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

// POST /api/sales
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
  } = req.body;

  if (!clientId) return res.status(400).json({ success: false, error: 'Client is required' });
  if (!items?.length) return res.status(400).json({ success: false, error: 'At least one item is required' });

  const client = await prisma.client.findUnique({ where: { id: clientId, deletedAt: null } });
  if (!client) return res.status(404).json({ success: false, error: 'Client not found' });

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

      const s = await tx.sale.create({
        data: {
          invoiceNo,
          clientId,
          branchId,
          userId: validatedUserId ?? undefined,
          date: date ? new Date(date) : new Date(),
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
          items: true,
          client: { select: { id: true, clientId: true, name: true, phone: true, whatsapp: true, address: true, deliveryLocation: true } },
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

// GET /api/sales/:id
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

// PATCH /api/sales/:id (Record additional payment on invoice)
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
