import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { writeAuditLog } from '../lib/business';
import { generateUniqueEmployeeId } from '../utils/employeeId';

const router = Router();

const ALLOWED_ROLES = ['ADMIN', 'SUPERVISOR', 'BILLING_STAFF', 'PURCHASE_STAFF', 'DELIVERY_STAFF'];

// Helper to get branch ID safely
async function getTargetBranchId(req: Request): Promise<string> {
  const headerBranch = req.headers['x-branch-id'] as string;
  if (headerBranch) return headerBranch;
  const firstBranch = await prisma.branch.findFirst();
  return firstBranch?.id || '';
}

// GET /api/employees/generate-id?phone=...&whatsapp=...
router.get('/generate-id', async (req: Request, res: Response) => {
  try {
    const { phone, whatsapp, excludeId } = req.query;
    const generatedId = await generateUniqueEmployeeId(
      phone as string,
      whatsapp as string,
      excludeId as string
    );
    return res.json({ success: true, data: { employeeId: generatedId } });
  } catch (err: any) {
    console.error('[GET /api/employees/generate-id]', err);
    return res.status(500).json({ success: false, error: 'Failed to generate Employee ID' });
  }
});

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
      select: {
        id: true,
        employeeId: true,
        name: true,
        role: true,
        phone: true,
        salary: true,
        joiningDate: true,
        isActive: true,
        branchId: true,
        fatherName: true,
        cnic: true,
        address: true,
        whatsapp: true,
        email: true,
        paymentStructure: true,
        notes: true,
        photoUrl: true,
        createdAt: true,
      }
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

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        employeeId: true,
        name: true,
        role: true,
        phone: true,
        salary: true,
        joiningDate: true,
        isActive: true,
        branchId: true,
        fatherName: true,
        cnic: true,
        address: true,
        whatsapp: true,
        email: true,
        paymentStructure: true,
        notes: true,
        photoUrl: true,
        createdAt: true,
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

// POST /api/employees (Admin Only)
router.post('/', async (req: Request, res: Response) => {
  const branchId = await getTargetBranchId(req);
  const userId = (req.headers['x-user-id'] as string) || null;

  if (!branchId) {
    return res.status(400).json({ success: false, error: 'Missing branch credentials' });
  }

  const {
    name, role, phone, salary, joiningDate, fatherName, cnic,
    address, whatsapp, email, paymentStructure, notes, photoUrl, password
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Employee name is required' });
  }

  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid employee role. Allowed roles are: Admin, Supervisor, Billing Staff, Purchase Staff, Delivery Staff.'
    });
  }

  if (!password || typeof password !== 'string' || password.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  try {
    // Automatically generate unique Employee ID based on phone/whatsapp last 4+ digits
    const uniqueEmployeeId = await generateUniqueEmployeeId(phone, whatsapp);

    // Hash assigned password securely
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const employee = await prisma.employee.create({
      data: {
        employeeId: uniqueEmployeeId,
        password: hashedPassword,
        name: name.trim(),
        role: role ?? 'DELIVERY_STAFF',
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
      newData: { name: employee.name, role: employee.role, employeeId: employee.employeeId },
    });

    const { password: _p, ...safeEmployee } = employee;
    return res.status(201).json({ success: true, data: safeEmployee });
  } catch (err: any) {
    console.error('[POST /api/employees]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create employee' });
  }
});

// POST /api/employees/clear-all (Admin action to purge ALL employee data)
router.post('/clear-all', async (req: Request, res: Response) => {
  try {
    const userId = (req.headers['x-user-id'] as string) || null;

    // Unlink sales and deliveries
    await prisma.sale.updateMany({ data: { employeeId: null } });
    await prisma.delivery.updateMany({ data: { employeeId: null } });

    await prisma.$transaction([
      prisma.salaryPayment.deleteMany({}),
      prisma.attendance.deleteMany({}),
      prisma.employee.deleteMany({}),
      prisma.user.deleteMany({}),
    ]);

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: (req.headers['x-branch-id'] as string) || 'main',
      action: 'DELETE',
      entity: 'Employee',
      entityId: 'ALL',
      newData: { action: 'CLEAR_ALL_EMPLOYEES' },
    });

    return res.json({
      success: true,
      message: 'All employee profiles and login data have been permanently deleted.'
    });
  } catch (err: any) {
    console.error('[POST /api/employees/clear-all]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete all employees' });
  }
});

// PUT /api/employees/:id
router.put('/:id', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] as string) || null;
  const { id } = req.params;

  const {
    name, role, phone, salary, joiningDate, fatherName, cnic,
    address, whatsapp, email, paymentStructure, notes, photoUrl, password
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Employee name is required' });
  }

  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid employee role. Allowed roles are: Admin, Supervisor, Billing Staff, Purchase Staff, Delivery Staff.'
    });
  }

  try {
    const original = await prisma.employee.findUnique({
      where: { id },
    });

    if (!original) {
      console.warn(`[PUT /api/employees/${id}] Record not found in database.`);
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const branchId = (req.headers['x-branch-id'] as string) || original.branchId;

    // Ensure employeeId exists and is unique
    let updatedEmployeeId = original.employeeId;
    if (!updatedEmployeeId || (phone && phone !== original.phone) || (whatsapp && whatsapp !== original.whatsapp)) {
      updatedEmployeeId = await generateUniqueEmployeeId(phone || original.phone, whatsapp || original.whatsapp, id);
    }

    let updatedPassword = original.password;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      updatedPassword = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: {
        employeeId: updatedEmployeeId,
        password: updatedPassword,
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

    // Synchronize linked User account role & permissions if present
    let userRole: any = 'SALESMAN';
    if (updated.role === 'ADMIN') userRole = 'OWNER';
    else if (updated.role === 'SUPERVISOR') userRole = 'MANAGER';
    else if (updated.role === 'BILLING_STAFF') userRole = 'CASHIER';
    else if (updated.role === 'PURCHASE_STAFF') userRole = 'MANAGER';
    else if (updated.role === 'DELIVERY_STAFF') userRole = 'DELIVERY';

    const userEmail = updated.email?.trim() || `emp_${updated.id}@sabziledger.com`;
    const linkedUser = await prisma.user.findFirst({
      where: { email: userEmail, deletedAt: null },
    });

    if (linkedUser) {
      await prisma.user.update({
        where: { id: linkedUser.id },
        data: {
          name: updated.name,
          role: userRole,
          ...(updatedPassword ? { password: updatedPassword } : {}),
        },
      });
    }

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'UPDATE',
      entity: 'Employee',
      entityId: id,
      oldData: { name: original.name, role: original.role },
      newData: { name: updated.name, role: updated.role },
    });

    const { password: _p, ...safeEmployee } = updated;
    return res.json({ success: true, data: safeEmployee });
  } catch (err: any) {
    console.error(`[PUT /api/employees/${id}] Update error:`, err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update employee' });
  }
});

// PATCH /api/employees/:id/toggle (Toggle Active / Inactive)
router.patch('/:id/toggle', async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const original = await prisma.employee.findUnique({ where: { id } });
    if (!original) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const updated = await prisma.employee.update({
      where: { id },
      data: { isActive: !original.isActive },
    });

    return res.json({
      success: true,
      data: updated,
      message: `Employee ${updated.isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (err: any) {
    console.error('[PATCH /api/employees/:id/toggle]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to toggle status' });
  }
});

// DELETE /api/employees/:id (Permanent Delete Single Employee)
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] as string) || null;
  const { id } = req.params;

  try {
    const original = await prisma.employee.findUnique({ where: { id } });
    if (!original) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Unlink sales and deliveries
    await prisma.sale.updateMany({ where: { employeeId: id }, data: { employeeId: null } });
    await prisma.delivery.updateMany({ where: { employeeId: id }, data: { employeeId: null } });

    // Delete payments & attendance
    await prisma.salaryPayment.deleteMany({ where: { employeeId: id } });
    await prisma.attendance.deleteMany({ where: { employeeId: id } });

    // Delete linked user account if present
    const userEmail = original.email?.trim() || `emp_${original.id}@sabziledger.com`;
    await prisma.user.deleteMany({ where: { email: userEmail } });

    // Delete employee record
    await prisma.employee.delete({ where: { id } });

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: original.branchId,
      action: 'DELETE',
      entity: 'Employee',
      entityId: id,
      oldData: { name: original.name, role: original.role },
    });

    return res.json({ success: true, message: `Employee "${original.name}" permanently deleted.` });
  } catch (err: any) {
    console.error('[DELETE /api/employees/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to delete employee profile' });
  }
});

export default router;
