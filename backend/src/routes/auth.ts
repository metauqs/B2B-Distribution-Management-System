import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { signToken, authMiddleware } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    // Ensure at least one admin employee exists to prevent lockout
    const employeeCount = await prisma.employee.count();
    if (employeeCount === 0) {
      const branch = await prisma.branch.findFirst();
      if (branch) {
        await prisma.employee.create({
          data: {
            name: 'Ahmad Raza (Owner)',
            role: 'ADMIN',
            phone: '1234',
            whatsapp: '1234',
            branchId: branch.id,
            isActive: true,
          }
        });
      }
    }

    // Load all active employees
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
    });

    // Find the one matching the 4-digit Employee ID
    const matchedEmployee = employees.find(emp => {
      const phone = emp.phone?.trim() || '';
      const whatsapp = emp.whatsapp?.trim() || '';
      let derivedId = '';
      
      if (phone && whatsapp && phone === whatsapp) {
        derivedId = phone.slice(-4);
      } else if (whatsapp) {
        derivedId = whatsapp.slice(-4);
      } else if (phone) {
        derivedId = phone.slice(-4);
      }
      
      return derivedId === String(employeeId).trim();
    });

    if (!matchedEmployee) {
      return res.status(401).json({ success: false, error: 'Invalid Employee ID' });
    }

    // Map EmployeeRole to UserRole
    let userRole: any = 'SALESMAN';
    if (matchedEmployee.role === 'ADMIN') userRole = 'OWNER';
    else if (matchedEmployee.role === 'BILLING_STAFF') userRole = 'CASHIER';
    else if (matchedEmployee.role === 'PURCHASE_STAFF') userRole = 'MANAGER';
    else if (matchedEmployee.role === 'DELIVERY_STAFF') userRole = 'DELIVERY';

    const userEmail = matchedEmployee.email?.trim() || `emp_${matchedEmployee.id}@sabziledger.com`;

    // Find or create User record to satisfy DB constraints
    let user = await prisma.user.findFirst({
      where: { email: userEmail, deletedAt: null },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: matchedEmployee.name,
          email: userEmail,
          password: 'employee_hashed_login_unusable_pass', // dummy unusable password
          role: userRole,
          branchId: matchedEmployee.branchId,
          isActive: true,
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: matchedEmployee.name,
          role: userRole,
          branchId: matchedEmployee.branchId,
          isActive: true,
        },
      });
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Sign Token
    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
    });

    // Set cookie
    res.cookie('sabzi_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return res.json({ success: true, data: { user } });
  } catch (error: any) {
    console.error('[login]', error);
    return res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('sabzi_token', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully' });
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.sub, deletedAt: null },
      include: { branch: { select: { id: true, name: true } } },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'User not found or inactive' });
    }

    const { password: _pwd, ...safeUser } = user;
    return res.json({ success: true, data: safeUser });
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
