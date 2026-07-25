import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog } from '../lib/business';

const router = Router();

// GET /api/employees
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { activeOnly } = req.query;

    const where: any = {
      ...(branchId ? { branchId } : {}),
      ...(activeOnly === 'true' ? { isActive: true } : {}),
    };

    const employees = await prisma.employee.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return res.json({ success: true, data: employees });
  } catch (err: any) {
    console.error('[GET /api/employees]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load employees', data: [] });
  }
});

// GET /api/employees/:id (Detailed Profile, Payments, Deliveries)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const branchId = (req.headers['x-branch-id'] as string) || undefined;

    const employee = await prisma.employee.findFirst({
      where: { id, ...(branchId ? { branchId } : {}) },
      include: {
        salaryPayments: {
          orderBy: { paidOn: 'desc' },
        },
        deliveries: {
          include: {
            sale: { select: { invoiceNo: true, total: true } },
            client: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    return res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[GET /api/employees/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load employee details' });
  }
});

// POST /api/employees
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch credentials' });
  }

  const {
    name, role, phone, salary, joiningDate, fatherName, cnic,
    address, whatsapp, email, paymentStructure, notes, photoUrl
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Employee name is required' });
  }

  try {
    const employee = await prisma.employee.create({
      data: {
        name: name.trim(),
        role: role ?? 'STAFF',
        phone: phone?.trim() || null,
        salary: salary ? Number(salary) : 0,
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        fatherName: fatherName?.trim() || null,
        cnic: cnic?.trim() || null,
        address: address?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        email: email?.trim() || null,
        paymentStructure: paymentStructure?.trim() || null,
        notes: notes?.trim() || null,
        photoUrl: photoUrl?.trim() || null,
        branchId,
        isActive: true,
      },
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CREATE',
      entity: 'Employee',
      entityId: employee.id,
      newData: { name: employee.name, role: employee.role },
    });

    return res.status(201).json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[POST /api/employees]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create employee' });
  }
});

// PUT /api/employees/:id
router.put('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch credentials' });
  }

  const { id } = req.params;
  const {
    name, role, phone, salary, joiningDate, fatherName, cnic,
    address, whatsapp, email, paymentStructure, notes, photoUrl
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Employee name is required' });
  }

  try {
    const original = await prisma.employee.findFirst({
      where: { id, branchId },
    });

    if (!original) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        name: name.trim(),
        role: role ?? original.role,
        phone: phone?.trim() || null,
        salary: salary ? Number(salary) : 0,
        joiningDate: joiningDate ? new Date(joiningDate) : original.joiningDate,
        fatherName: fatherName?.trim() || null,
        cnic: cnic?.trim() || null,
        address: address?.trim() || null,
        whatsapp: whatsapp?.trim() || null,
        email: email?.trim() || null,
        paymentStructure: paymentStructure?.trim() || null,
        notes: notes?.trim() || null,
        photoUrl: photoUrl?.trim() || null,
      },
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Employee',
      entityId: id,
      newData: { name: updated.name, role: updated.role },
    });

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[PUT /api/employees/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update employee' });
  }
});

// PATCH /api/employees/:id/toggle (Activate/Deactivate)
router.patch('/:id/toggle', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch credentials' });
  }

  const { id } = req.params;

  try {
    const original = await prisma.employee.findFirst({
      where: { id, branchId },
    });

    if (!original) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        isActive: !original.isActive,
      },
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Employee',
      entityId: id,
      newData: { isActive: updated.isActive },
    });

    return res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[PATCH /api/employees/:id/toggle]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to toggle employee status' });
  }
});

// POST /api/employees/:id/payments (Record salary payment)
router.post('/:id/payments', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch credentials' });
  }

  const { id } = req.params;
  const { month, amount, method, notes } = req.body;

  if (!month?.trim() || !amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Month and valid amount are required' });
  }

  try {
    const employee = await prisma.employee.findFirst({
      where: { id, branchId },
    });

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const payment = await prisma.salaryPayment.create({
      data: {
        employeeId: id,
        month: month.trim(),
        amount: Number(amount),
        method: method ?? 'CASH',
        notes: notes?.trim() || null,
        paidOn: new Date(),
      },
    });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'CREATE',
      entity: 'SalaryPayment',
      entityId: payment.id,
      newData: { employeeId: id, month: payment.month, amount: payment.amount },
    });

    return res.status(201).json({ success: true, data: payment });
  } catch (err: any) {
    console.error('[POST /api/employees/:id/payments]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to record salary payment' });
  }
});

export default router;
