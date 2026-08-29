import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { stockReturn } from '../lib/inventoryService';
import { getBusinessDateRange, parseInputDateToUtc, getBusinessDateString } from '../lib/businessDate';
import { reconcileClientBalancesAndAllocations, deriveInvoiceStatus } from '../lib/business';

const router = Router();

function isDeliveryDue(deliveryDate: Date, scheduledTime: string | null | undefined): boolean {
  const now = new Date();
  const target = new Date(deliveryDate);
  
  let hours = 9; // Default to 9 AM
  let minutes = 0;

  if (scheduledTime) {
    const match = scheduledTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const ampm = match[3].toUpperCase();
      
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      
      hours = h;
      minutes = m;
    }
  }

  target.setHours(hours, minutes, 0, 0);
  return now >= target;
}

// ── In-Memory cache for deliveries (15s TTL) ───────────────────────────────
const DELIVERY_CACHE = new Map<string, { ts: number; data: any }>();
const DELIVERY_CACHE_TTL = 15000;
const DELIVERY_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearDeliveryCache(): void {
  DELIVERY_CACHE.clear();
  DELIVERY_IN_FLIGHT.clear();
}

let isAutoDispatchRunning = false;

async function checkAndAutoDispatch(branchId?: string, dayStart?: Date, dayEnd?: Date) {
  if (isAutoDispatchRunning) return;
  isAutoDispatchRunning = true;
  try {
    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        status: 'PENDING',
        date: dayStart && dayEnd ? { gte: dayStart, lte: dayEnd } : { gte: new Date(Date.now() - 3 * 86400000) },
      },
      select: { id: true, date: true, scheduledTime: true, saleId: true },
    });

    const toDispatch = pendingDeliveries
      .filter(d => isDeliveryDue(d.date, d.scheduledTime))
      .map(d => d.id);

    if (toDispatch.length > 0) {
      await prisma.$transaction(async (tx) => {
        await tx.delivery.updateMany({
          where: { id: { in: toDispatch } },
          data: { status: 'OUT' },
        });

        const salesToUpdate = pendingDeliveries
          .filter(d => toDispatch.includes(d.id))
          .map(d => d.saleId);

        await tx.sale.updateMany({
          where: { id: { in: salesToUpdate } },
          data: { deliveryStatus: 'OUT' },
        });
      }, { maxWait: 10000, timeout: 30000 });
      clearDeliveryCache();
    }
  } catch (err) {
    console.error('[AUTO DISPATCH ERROR]', err);
  } finally {
    isAutoDispatchRunning = false;
  }
}

// GET /api/delivery
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { status, employeeId, date } = req.query;

    const userRole = (req.headers['x-user-role'] as string) || req.user?.role;
    const userEmployeeId = (req.headers['x-employee-id'] as string) || req.user?.employeeId;

    let targetEmployeeId = employeeId ? String(employeeId) : undefined;
    if (userRole === 'DELIVERY_STAFF' && userEmployeeId) {
      targetEmployeeId = userEmployeeId;
    }

    const cacheKey = `${branchId || 'all'}_${status || 'all'}_${targetEmployeeId || 'all'}_${date || 'all'}`;
    const cached = DELIVERY_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < DELIVERY_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (DELIVERY_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await DELIVERY_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const filterRange = date ? getBusinessDateRange(String(date)) : undefined;
    const dayStart = filterRange?.start;
    const dayEnd = filterRange?.end;

    // Trigger non-blocking auto-dispatch in background without stalling the read response
    setImmediate(() => {
      checkAndAutoDispatch(branchId, dayStart, dayEnd).catch(() => {});
    });

    const fetchDeliveryPromise = (async () => {
      const rawBranchId = branchId || '';
      const rawStatus = status ? String(status) : '';
      const rawEmployeeId = targetEmployeeId || '';

      const deliveries = await prisma.$queryRaw<any[]>`
        SELECT 
          d.id,
          d."saleId",
          d."clientId",
          d.status,
          d.zone,
          d."scheduledTime",
          d."employeeId",
          d."vehicleId",
          d."driverId",
          d.notes,
          d."failureReason",
          d.date,
          d."branchId",
          d."createdAt",
          d."updatedAt",
          CASE WHEN s.id IS NOT NULL THEN json_build_object(
            'id', s.id,
            'invoiceNo', s."invoiceNo",
            'subtotal', s.subtotal::float,
            'discount', s.discount::float,
            'deliveryCharge', s."deliveryCharge"::float,
            'total', s.total::float,
            'paid', s.paid::float,
            'balance', s.balance::float,
            'status', s.status,
            'deliveryStatus', s."deliveryStatus",
            'failureReason', s."failureReason",
            'deliveryDate', s."deliveryDate",
            'deliveryTime', s."deliveryTime",
            'items', COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', si.id,
                    'productId', si."productId",
                    'itemName', si."itemName",
                    'qty', si.qty::float,
                    'unit', si.unit,
                    'rate', si.rate::float,
                    'amount', si.amount::float,
                    'returnedQty', si."returnedQty"::float,
                    'returnReason', si."returnReason"
                  )
                )
                FROM sale_items si
                WHERE si."saleId" = s.id
              ),
              '[]'::json
            )
          ) ELSE NULL END as sale,
          CASE WHEN cl.id IS NOT NULL THEN json_build_object(
            'id', cl.id,
            'name', cl.name,
            'address', cl.address,
            'phone', cl.phone,
            'currentBalance', cl."currentBalance"::float
          ) ELSE NULL END as client,
          CASE WHEN v.id IS NOT NULL THEN json_build_object(
            'id', v.id,
            'plateNo', v."plateNo",
            'type', v.type
          ) ELSE NULL END as vehicle,
          CASE WHEN dr.id IS NOT NULL THEN json_build_object(
            'id', dr.id,
            'name', dr.name,
            'phone', dr.phone
          ) ELSE NULL END as driver,
          CASE WHEN emp.id IS NOT NULL THEN json_build_object(
            'id', emp.id,
            'name', emp.name,
            'phone', emp.phone,
            'whatsapp', emp.whatsapp
          ) ELSE NULL END as employee
        FROM deliveries d
        LEFT JOIN sales s ON s.id = d."saleId"
        LEFT JOIN clients cl ON cl.id = d."clientId"
        LEFT JOIN vehicles v ON v.id = d."vehicleId"
        LEFT JOIN drivers dr ON dr.id = d."driverId"
        LEFT JOIN employees emp ON emp.id = d."employeeId"
        WHERE (${rawBranchId} = '' OR d."branchId" = ${rawBranchId})
          AND (${rawStatus} = '' OR d.status::text = ${rawStatus})
          AND (${rawEmployeeId} = '' OR d."employeeId" = ${rawEmployeeId})
          ${dayStart && dayEnd ? Prisma.sql`AND d.date >= ${dayStart} AND d.date <= ${dayEnd}` : Prisma.empty}
        ORDER BY d.date ASC, d."createdAt" ASC
        LIMIT 200
      `;

      return deliveries;
    })();

    DELIVERY_IN_FLIGHT.set(cacheKey, fetchDeliveryPromise);

    try {
      const deliveries = await fetchDeliveryPromise;
      if (DELIVERY_CACHE.size >= 50) DELIVERY_CACHE.clear();
      DELIVERY_CACHE.set(cacheKey, { ts: Date.now(), data: deliveries });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: deliveries });
    } finally {
      DELIVERY_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('Error in GET /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to fetch deliveries' });
  }
});

// PATCH /api/delivery — Update delivery status, assign vehicle/driver/staff or mark FAILED
router.patch('/', async (req: Request, res: Response) => {
  try {
    const { id, status, vehicleId, driverId, zone, notes, failureReason, employeeId, date, scheduledTime } = req.body;

    if (!id) return res.status(400).json({ success: false, error: 'Delivery ID required' });

    let mappedStatus = status;
    if (status === 'OUT_FOR_DELIVERY' || status === 'DISPATCHED') {
      mappedStatus = 'OUT';
    }

    // ── Handle FAILED DELIVERY ──
    if (mappedStatus === 'FAILED') {
      const result = await prisma.$transaction(async (tx) => {
        const existingDelivery = await tx.delivery.findUnique({
          where: { id },
          include: {
            sale: {
              include: { items: true }
            },
            client: true
          }
        });

        if (!existingDelivery) throw new Error('Delivery not found');

        const reason = failureReason || notes || 'Delivery Failed';

        // 1. Update Delivery Status
        const updatedDelivery = await tx.delivery.update({
          where: { id },
          data: {
            status: 'FAILED',
            failureReason: reason,
            ...(notes ? { notes } : {}),
          },
          include: {
            client: { select: { id: true, name: true } },
            sale: { select: { id: true, invoiceNo: true, total: true } },
          }
        });

        // 2. If Sale was not already CANCELLED, cancel sale & restore stock
        if (existingDelivery.sale.status !== 'CANCELLED') {
          // Restore stock for all items
          for (const item of existingDelivery.sale.items) {
            const netQty = item.qty - (item.returnedQty || 0);
            if (netQty > 0 && item.productId) {
              await stockReturn(tx, {
                productId: item.productId,
                branchId: existingDelivery.branchId,
                qty: netQty,
                unit: item.unit,
                refType: 'delivery_failed',
                refId: existingDelivery.sale.id,
                refNo: existingDelivery.sale.invoiceNo,
                reason: `Delivery Failed: ${reason}`,
              });
            }
          }

          // Update Sale status to CANCELLED & zero out balance
          const previousBalance = existingDelivery.sale.balance;
          await tx.sale.update({
            where: { id: existingDelivery.saleId },
            data: {
              status: 'CANCELLED',
              deliveryStatus: 'FAILED',
              failureReason: reason,
              balance: 0,
            }
          });

          // Adjust Customer Ledger & Client currentBalance
          if (previousBalance > 0) {
            await tx.customerLedger.create({
              data: {
                clientId: existingDelivery.clientId,
                branchId: existingDelivery.branchId,
                type: 'ADJUSTMENT',
                referenceId: existingDelivery.sale.id,
                referenceNo: existingDelivery.sale.invoiceNo,
                description: `Delivery Failed - Invoice ${existingDelivery.sale.invoiceNo} Cancelled`,
                debit: 0,
                credit: previousBalance,
                balance: Math.max(0, existingDelivery.client.currentBalance - previousBalance),
              }
            });

            await tx.client.update({
              where: { id: existingDelivery.clientId },
              data: {
                currentBalance: Math.max(0, existingDelivery.client.currentBalance - previousBalance)
              }
            });
          }

          // Audit Log
          await tx.auditLog.create({
            data: {
              userId: (req.user as any)?.id || req.user?.sub || undefined,
              branchId: existingDelivery.branchId,
              action: 'DELIVERY_FAILED',
              entity: 'Delivery',
              entityId: id,
              oldData: { status: existingDelivery.status, saleBalance: previousBalance },
              newData: { status: 'FAILED', failureReason: reason, saleStatus: 'CANCELLED' }
            }
          });
        }

        return updatedDelivery;
      }, { maxWait: 15000, timeout: 120000 });

      return res.json({ success: true, data: result });
    }

    // ── Handle Normal Delivery Updates (DELIVERED, OUT, PENDING) ──
    let deliveredAt: Date | undefined = undefined;
    if (mappedStatus === 'DELIVERED') {
      const existing = await prisma.delivery.findUnique({
        where: { id },
        select: { date: true }
      });
      if (existing) {
        const todayBStr = getBusinessDateString(new Date());
        const deliveryBStr = getBusinessDateString(existing.date);

        if (deliveryBStr < todayBStr) {
          deliveredAt = parseInputDateToUtc(existing.date);
        } else {
          deliveredAt = new Date();
        }
      } else {
        deliveredAt = new Date();
      }
    }

    const delivery = await prisma.delivery.update({
      where: { id },
      data: {
        ...(mappedStatus ? { status: mappedStatus as any } : {}),
        ...(vehicleId !== undefined ? { vehicleId: vehicleId || null } : {}),
        ...(driverId !== undefined ? { driverId: driverId || null } : {}),
        ...(employeeId !== undefined ? { employeeId: employeeId || null } : {}),
        ...(zone ? { zone } : {}),
        ...(notes ? { notes } : {}),
        ...(date ? { date: parseInputDateToUtc(date) } : {}),
        ...(scheduledTime ? { scheduledTime } : {}),
        ...(deliveredAt ? { deliveredAt } : {}),
      },
      include: {
        client: { select: { name: true } },
        sale: { select: { invoiceNo: true } },
        employee: { select: { id: true, name: true, phone: true } },
      },
    });

    if (mappedStatus) {
      await prisma.sale.update({
        where: { id: delivery.saleId },
        data: { deliveryStatus: mappedStatus as any },
      });
    }

    clearDeliveryCache();
    return res.json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('Error in PATCH /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update delivery' });
  }
});

// POST /api/delivery/return — Process Partial Customer Product Returns
router.post('/return', async (req: Request, res: Response) => {
  try {
    const { deliveryId, returns } = req.body; // returns: Array<{ itemId: string, returnedQty: number, reason?: string }>

    if (!deliveryId || !Array.isArray(returns) || returns.length === 0) {
      return res.status(400).json({ success: false, error: 'deliveryId and returns array are required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const delivery = await tx.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          sale: {
            include: { items: true }
          },
          client: true
        }
      });

      if (!delivery) throw new Error('Delivery not found');
      if (delivery.sale.status === 'CANCELLED') throw new Error('Cannot process returns on a cancelled sale');

      let totalReturnedValueDelta = 0;

      for (const ret of returns) {
        const item = delivery.sale.items.find(i => i.id === ret.itemId);
        if (!item) continue;

        const targetReturnedQty = Math.min(item.qty, Math.max(0, Number(ret.returnedQty) || 0));
        const additionalReturn = targetReturnedQty - item.returnedQty;

        if (additionalReturn > 0) {
          const itemReturnReason = ret.reason || item.returnReason || 'Partial Return';
          const returnItemValue = additionalReturn * item.rate;
          totalReturnedValueDelta += returnItemValue;

          // Update SaleItem
          await tx.saleItem.update({
            where: { id: item.id },
            data: {
              returnedQty: targetReturnedQty,
              returnReason: itemReturnReason,
              amount: Math.max(0, (item.qty - targetReturnedQty) * item.rate)
            }
          });

          // Restore stock in Inventory
          if (item.productId) {
            await stockReturn(tx, {
              productId: item.productId,
              branchId: delivery.branchId,
              qty: additionalReturn,
              unit: item.unit,
              refType: 'customer_return',
              refId: delivery.sale.id,
              refNo: delivery.sale.invoiceNo,
              reason: itemReturnReason,
            });
          }
        }
      }

      if (totalReturnedValueDelta > 0) {
        // Recalculate Sale totals
        const updatedItems = await tx.saleItem.findMany({ where: { saleId: delivery.saleId } });
        const netSubtotal = updatedItems.reduce((sum, i) => sum + i.amount, 0);
        const newTotal = Math.max(0, netSubtotal - delivery.sale.discount + delivery.sale.deliveryCharge);

        await tx.sale.update({
          where: { id: delivery.saleId },
          data: {
            subtotal: netSubtotal,
            total: newTotal,
          }
        });

        // Synchronize client ledger, return credit notes, FIFO payment allocations and client balance
        await reconcileClientBalancesAndAllocations(delivery.clientId, tx);

        // Mark Delivery returnedAt timestamp
        await tx.delivery.update({
          where: { id: deliveryId },
          data: { returnedAt: new Date() }
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            userId: (req.user as any)?.id || req.user?.sub || undefined,
            branchId: delivery.branchId,
            action: 'PARTIAL_RETURN',
            entity: 'Delivery',
            entityId: deliveryId,
            oldData: { total: delivery.sale.total, balance: delivery.sale.balance },
            newData: { total: newTotal, returnedValue: totalReturnedValueDelta }
          }
        });
      }

      // Return updated delivery record
      return await tx.delivery.findUnique({
        where: { id: deliveryId },
        include: {
          sale: {
            include: { items: true }
          },
          client: true,
          employee: true
        }
      });
    }, { maxWait: 15000, timeout: 120000 });

    clearDeliveryCache();
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Error in POST /api/delivery/return:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to process product returns' });
  }
});

// POST /api/delivery — Create new delivery
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { saleId, clientId, vehicleId, driverId, zone, notes, employeeId, date, scheduledTime } = req.body;

    if (!saleId || !clientId) {
      return res.status(400).json({ success: false, error: 'Sale and client are required' });
    }

    const delivery = await prisma.delivery.create({
      data: {
        saleId, clientId, branchId,
        vehicleId: vehicleId ?? undefined,
        driverId: driverId ?? undefined,
        employeeId: employeeId ?? undefined,
        zone: zone ?? undefined,
        notes: notes ?? undefined,
        date: date ? new Date(date) : undefined,
        scheduledTime: scheduledTime ?? undefined,
      },
    });

    clearDeliveryCache();
    return res.status(201).json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('Error in POST /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create delivery' });
  }
});

export default router;
