import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

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

// GET /api/delivery
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { status, employeeId, date } = req.query;

    const filterDate = date ? new Date(String(date)) : undefined;
    const dayStart = filterDate ? new Date(filterDate) : undefined;
    if (dayStart) dayStart.setHours(0, 0, 0, 0);
    const dayEnd = filterDate ? new Date(filterDate) : undefined;
    if (dayEnd) dayEnd.setHours(23, 59, 59, 999);

    // ── Auto-Dispatch Logic for PENDING deliveries ──
    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        status: 'PENDING',
      },
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
      });
    }

    // Enforce role-scoped delivery filtering for DELIVERY_STAFF users
    const userRole = (req.headers['x-user-role'] as string) || req.user?.role;
    const userEmployeeId = (req.headers['x-employee-id'] as string) || req.user?.employeeId;

    let targetEmployeeId = employeeId ? String(employeeId) : undefined;
    if (userRole === 'DELIVERY_STAFF' && userEmployeeId) {
      targetEmployeeId = userEmployeeId;
    }

    const deliveries = await prisma.delivery.findMany({
      where: {
        ...(branchId ? { branchId } : {}),
        ...(status ? { status: status as any } : {}),
        ...(targetEmployeeId ? { employeeId: targetEmployeeId } : {}),
        ...(dayStart && dayEnd ? {
          date: {
            gte: dayStart,
            lte: dayEnd,
          }
        } : {}),
      },
      include: {
        sale: {
          select: {
            id: true,
            invoiceNo: true,
            total: true,
            deliveryDate: true,
            deliveryTime: true,
            items: { select: { id: true, itemName: true, qty: true, unit: true, rate: true, amount: true } },
          },
        },
        client: { select: { id: true, name: true, address: true, phone: true } },
        vehicle: { select: { id: true, plateNo: true, type: true } },
        driver: { select: { id: true, name: true, phone: true } },
        employee: { select: { id: true, name: true, phone: true, whatsapp: true } },
      },
      orderBy: { date: 'asc' },
      take: 100,
    });

    return res.json({ success: true, data: deliveries });
  } catch (err: any) {
    console.error('Error in GET /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to fetch deliveries' });
  }
});

// PATCH /api/delivery
router.patch('/', async (req: Request, res: Response) => {
  try {
    const { id, status, vehicleId, driverId, zone, notes, employeeId, date, scheduledTime } = req.body;

    if (!id) return res.status(400).json({ success: false, error: 'Delivery ID required' });

    let mappedStatus = status;
    if (status === 'OUT_FOR_DELIVERY' || status === 'DISPATCHED') {
      mappedStatus = 'OUT';
    }

    let deliveredAt: Date | undefined = undefined;
    if (mappedStatus === 'DELIVERED') {
      const existing = await prisma.delivery.findUnique({
        where: { id },
        select: { date: true }
      });
      if (existing) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const deliveryDate = new Date(existing.date);
        deliveryDate.setHours(0, 0, 0, 0);

        if (deliveryDate < today) {
          // Previous day's delivery completed
          const completedDate = new Date(existing.date);
          completedDate.setHours(17, 0, 0, 0); // Default to 5 PM on the scheduled day
          deliveredAt = completedDate;
        } else {
          // Today's delivery completed
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
        ...(date ? { date: new Date(date) } : {}),
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

    return res.json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('Error in PATCH /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update delivery' });
  }
});

// POST /api/delivery
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

    return res.status(201).json({ success: true, data: delivery });
  } catch (err: any) {
    console.error('Error in POST /api/delivery:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create delivery' });
  }
});

export default router;
