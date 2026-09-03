import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { writeAuditLog } from '../lib/business';
import { generateEmployeeIdFromPhone } from '../utils/employeeId';
import { SUPER_ADMIN_CONFIG, isKhizarHayatEmployee, isKhizarHayatUser, isSuperAdminRole } from '../config/superAdmin';

const router = Router();

const ALLOWED_ROLES = ['ADMIN', 'SUPERVISOR', 'BILLING_STAFF', 'PURCHASE_STAFF', 'DELIVERY_STAFF'];

function isAdminUser(req: Request): boolean {
  const role = req.user?.role || (req.headers['x-user-role'] as string);
  return role === 'OWNER' || role === 'MANAGER' || role === 'ADMIN';
}

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
    const result = await generateEmployeeIdFromPhone(
      phone as string,
      whatsapp as string,
      excludeId as string
    );
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[GET /api/employees/generate-id]', err);
    return res.status(500).json({ success: false, error: 'Failed to generate Employee ID' });
  }
});

// ── In-Memory cache for employees (60s TTL) ───────────────────────────────
const EMPLOYEE_CACHE = new Map<string, { ts: number; data: any }>();
const EMPLOYEE_CACHE_TTL = 300000;
const EMPLOYEE_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearEmployeeCache(): void {
  EMPLOYEE_CACHE.clear();
  EMPLOYEE_IN_FLIGHT.clear();
}

// GET /api/employees
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const { activeOnly } = req.query;

    const cacheKey = `list_${branchId || 'all'}_${activeOnly || 'all'}`;
    const cached = EMPLOYEE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < EMPLOYEE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (EMPLOYEE_IN_FLIGHT.has(cacheKey)) {
      const coalesced = await EMPLOYEE_IN_FLIGHT.get(cacheKey);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchEmployeesPromise = (async () => {
      const where: any = {
        ...(branchId ? { branchId } : {}),
        ...(activeOnly === 'true' ? { isActive: true } : {}),
      };

      return await prisma.employee.findMany({
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
    })();

    EMPLOYEE_IN_FLIGHT.set(cacheKey, fetchEmployeesPromise);
    try {
      const employees = await fetchEmployeesPromise;
      if (EMPLOYEE_CACHE.size >= 50) EMPLOYEE_CACHE.clear();
      EMPLOYEE_CACHE.set(cacheKey, { ts: Date.now(), data: employees });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: employees });
    } finally {
      EMPLOYEE_IN_FLIGHT.delete(cacheKey);
    }
  } catch (err: any) {
    console.error('[GET /api/employees]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load employees', data: [] });
  }
});

// GET /api/employees/:id (Detailed Profile, Payments, Deliveries)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const cacheKey = `profile_${id}`;
    const cached = EMPLOYEE_CACHE.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < EMPLOYEE_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    const employee = await prisma.employee.findFirst({
      where: {
        OR: [
          { id },
          { employeeId: id },
        ],
      },
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
          take: 20,
        },
        deliveries: {
          include: {
            sale: { select: { invoiceNo: true, total: true } },
            client: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    if (EMPLOYEE_CACHE.size >= 50) {
      const oldestKey = EMPLOYEE_CACHE.keys().next().value;
      if (oldestKey) EMPLOYEE_CACHE.delete(oldestKey);
    }
    EMPLOYEE_CACHE.set(cacheKey, { ts: Date.now(), data: employee });
    res.setHeader('X-Cache', 'MISS');
    return res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('[GET /api/employees/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load employee details' });
  }
});

// POST /api/employees (Admin Only)
router.post('/', async (req: Request, res: Response) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden: Only Admin can add employee profiles' });
  }

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

  if (role && isSuperAdminRole(role)) {
    await writeAuditLog({
      userId: userId ?? undefined,
      branchId,
      action: 'SECURITY_BLOCK_SUPER_ADMIN_CREATION',
      entity: 'Employee',
      entityId: 'NEW',
      newData: { attemptedRole: role, attemptedName: name, error: 'Only Khizar Hayat is authorized as Super Admin' }
    });
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Only Khizar Hayat is authorized to hold the Super Admin role. Creating new Super Admin accounts is strictly prohibited.'
    });
  }

  if (name && (name.trim().toLowerCase() === 'khizar hayat' || phone?.trim() === SUPER_ADMIN_CONFIG.phone || email?.trim().toLowerCase() === SUPER_ADMIN_CONFIG.email.toLowerCase())) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: An authoritative account for Khizar Hayat already exists. Duplicate Super Admin account creation is strictly prohibited.'
    });
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
    // Generate 4-digit Employee ID based on last 4 digits of phone/whatsapp
    const { employeeId: uniqueEmployeeId, isAvailable } = await generateEmployeeIdFromPhone(phone, whatsapp);

    if (!isAvailable) {
      return res.status(400).json({
        success: false,
        error: 'Employee ID already exists. Please use a different phone number.'
      });
    }

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
    clearEmployeeCache();
    return res.status(201).json({ success: true, data: safeEmployee });
  } catch (err: any) {
    console.error('[POST /api/employees]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create employee' });
  }
});

// POST /api/employees/clear-all (PERMANENTLY PROHIBITED BY SECURITY POLICY)
router.post('/clear-all', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] as string) || (req.user as any)?.sub || null;

  await writeAuditLog({
    userId: userId ?? undefined,
    branchId: (req.headers['x-branch-id'] as string) || 'main',
    action: 'DELETE_ALL_ATTEMPT_BLOCKED',
    entity: 'Employee',
    entityId: 'ALL',
    newData: { error: 'Bulk employee deletion is strictly prohibited by security policy.' }
  });

  return res.status(403).json({
    success: false,
    error: 'Forbidden: Bulk employee deletion is permanently prohibited. Employee records must be preserved permanently.'
  });
});

// PUT /api/employees/:id (Admin Only)
router.put('/:id', async (req: Request, res: Response) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden: Only Admin can edit employee profiles' });
  }

  const userId = (req.headers['x-user-id'] as string) || null;
  const { id } = req.params;

  const {
    name, role, phone, salary, joiningDate, fatherName, cnic,
    address, whatsapp, email, paymentStructure, notes, photoUrl, password
  } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: 'Employee name is required' });
  }

  if (role && isSuperAdminRole(role)) {
    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: (req.headers['x-branch-id'] as string) || 'main',
      action: 'SECURITY_BLOCK_SUPER_ADMIN_PROMOTION',
      entity: 'Employee',
      entityId: id,
      newData: { attemptedRole: role, error: 'Only Khizar Hayat is authorized as Super Admin' }
    });
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Cannot promote employee to Super Admin. Only Khizar Hayat is authorized to hold the Super Admin role.'
    });
  }

  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid employee role. Allowed roles are: Admin, Supervisor, Billing Staff, Purchase Staff, Delivery Staff.'
    });
  }

  try {
    const original = await prisma.employee.findFirst({
      where: {
        OR: [
          { id },
          { employeeId: id },
        ],
      },
    });

    if (!original) {
      console.warn(`[PUT /api/employees/${id}] Record not found in database.`);
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    const branchId = (req.headers['x-branch-id'] as string) || original.branchId;

    // Protection for Khizar Hayat's Super Admin account
    const isTargetKhizar = isKhizarHayatEmployee(original.id, original.phone, original.email);
    if (isTargetKhizar) {
      // Demotion protection: Role cannot be demoted
      if (role && role !== 'ADMIN') {
        await writeAuditLog({
          userId: userId ?? undefined,
          branchId,
          action: 'SECURITY_BLOCK_SUPER_ADMIN_DEMOTION',
          entity: 'Employee',
          entityId: original.id,
          newData: { attemptedRole: role, error: 'Cannot demote Khizar Hayat' }
        });
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Khizar Hayat\'s Super Admin role cannot be demoted.'
        });
      }

      // Modification protection: Only Khizar Hayat himself can edit his Super Admin account
      const actingEmail = req.user?.email || (req.headers['x-user-email'] as string);
      const isActingKhizar = isKhizarHayatUser(userId, actingEmail) || isKhizarHayatEmployee(req.user?.employeeId);
      if (!isActingKhizar) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Khizar Hayat\'s Super Admin profile is protected and can only be modified by Khizar Hayat himself.'
        });
      }
    }

    // Employee ID MUST REMAIN PERMANENT & UNCHANGED
    const updatedEmployeeId = original.employeeId;

    let updatedPassword = original.password;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      updatedPassword = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.employee.update({
      where: { id: original.id },
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
      entityId: original.id,
      oldData: { name: original.name, role: original.role },
      newData: { name: updated.name, role: updated.role },
    });

    const { password: _p, ...safeEmployee } = updated;
    clearEmployeeCache();
    return res.json({ success: true, data: safeEmployee });
  } catch (err: any) {
    console.error(`[PUT /api/employees/${id}] Update error:`, err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to update employee' });
  }
});

// PATCH /api/employees/:id/toggle (Toggle Active / Inactive - Admin Only)
router.patch('/:id/toggle', async (req: Request, res: Response) => {
  if (!isAdminUser(req)) {
    return res.status(403).json({ success: false, error: 'Forbidden: Only Admin can change employee status' });
  }

  const userId = (req.headers['x-user-id'] as string) || (req.user as any)?.sub || null;
  const { id } = req.params;

  try {
    const original = await prisma.employee.findFirst({
      where: {
        OR: [
          { id },
          { employeeId: id },
        ],
      },
    });

    if (!original) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Protection for Khizar Hayat's Super Admin account: cannot be deactivated
    const isTargetKhizar = isKhizarHayatEmployee(original.id, original.phone, original.email);
    if (isTargetKhizar) {
      await writeAuditLog({
        userId: userId ?? undefined,
        branchId: original.branchId,
        action: 'SECURITY_BLOCK_SUPER_ADMIN_DEACTIVATION',
        entity: 'Employee',
        entityId: original.id,
        newData: { error: 'Attempted to deactivate Khizar Hayat' }
      });
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Khizar Hayat\'s Super Admin account is permanently active and cannot be deactivated or suspended.'
      });
    }

    const newStatus = !original.isActive;

    const updated = await prisma.employee.update({
      where: { id: original.id },
      data: { isActive: newStatus },
    });

    // Synchronize linked User account so login is prevented immediately if deactivated
    const userEmail = original.email?.trim() || `emp_${original.id}@sabziledger.com`;
    const linkedUser = await prisma.user.findFirst({ where: { email: userEmail, deletedAt: null } });
    if (linkedUser) {
      await prisma.user.update({
        where: { id: linkedUser.id },
        data: { isActive: newStatus },
      });
    }

    await writeAuditLog({
      userId: userId ?? undefined,
      branchId: original.branchId,
      action: 'STATUS_TOGGLE',
      entity: 'Employee',
      entityId: original.id,
      oldData: { isActive: original.isActive },
      newData: { isActive: newStatus, name: original.name },
    });

    clearEmployeeCache();
    return res.json({
      success: true,
      data: updated,
      message: `Employee "${updated.name}" ${updated.isActive ? 'activated' : 'deactivated'} successfully.`
    });
  } catch (err: any) {
    console.error('[PATCH /api/employees/:id/toggle]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to toggle status' });
  }
});

// DELETE /api/employees/:id (PERMANENTLY PROHIBITED BY SECURITY POLICY)
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] as string) || (req.user as any)?.sub || null;
  const { id } = req.params;

  await writeAuditLog({
    userId: userId ?? undefined,
    branchId: (req.headers['x-branch-id'] as string) || 'main',
    action: 'DELETE_ATTEMPT_BLOCKED',
    entity: 'Employee',
    entityId: id,
    newData: { error: 'Employee deletion is strictly prohibited by security policy.' }
  });

  return res.status(403).json({
    success: false,
    error: 'Forbidden: Employee deletion is permanently prohibited. Employee records cannot be deleted. Use employee status (Active / Inactive) to manage access.'
  });
});

export default router;
