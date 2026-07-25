import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import {
  signAuthTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  extractRefreshToken,
  authMiddleware
} from '../middleware/auth';
import { generateUniqueEmployeeId } from '../utils/employeeId';

const router = Router();

// Simple in-memory brute force protection tracker
interface AttemptRecord {
  count: number;
  blockedUntil: number;
}
const loginAttempts = new Map<string, AttemptRecord>();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 15 * 60 * 1000; // 15 minutes

function isRateLimited(key: string): boolean {
  const record = loginAttempts.get(key);
  if (!record) return false;
  if (Date.now() < record.blockedUntil) return true;
  if (Date.now() >= record.blockedUntil && record.count >= MAX_ATTEMPTS) {
    loginAttempts.delete(key);
    return false;
  }
  return false;
}

function recordFailedAttempt(key: string): void {
  const record = loginAttempts.get(key) || { count: 0, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = Date.now() + BLOCK_DURATION;
  }
  loginAttempts.set(key, record);
}

function clearFailedAttempts(key: string): void {
  loginAttempts.delete(key);
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { employeeId, password } = req.body;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const trimmedId = employeeId.trim();
    const rateKey = `login_${req.ip}_${trimmedId}`;

    if (isRateLimited(rateKey)) {
      return res.status(429).json({
        success: false,
        error: 'Too many failed login attempts. Please try again in 15 minutes.'
      });
    }

    // Ensure at least one admin employee exists to prevent lockout
    const employeeCount = await prisma.employee.count();
    if (employeeCount === 0) {
      const branch = await prisma.branch.findFirst();
      if (branch) {
        const adminPass = await bcrypt.hash('admin123', 10);
        await prisma.employee.create({
          data: {
            employeeId: '1234',
            password: adminPass,
            name: 'Ahmad Raza (Owner)',
            role: 'ADMIN',
            phone: '03001231234',
            whatsapp: '03001231234',
            branchId: branch.id,
            isActive: true,
          }
        });
      }
    }

    // 1. Find employee by exact stored employeeId
    let matchedEmployee = await prisma.employee.findFirst({
      where: {
        employeeId: trimmedId,
        isActive: true
      }
    });

    // 2. Fallback lookup for legacy employees without employeeId field
    if (!matchedEmployee) {
      const allActive = await prisma.employee.findMany({ where: { isActive: true } });
      matchedEmployee = allActive.find(emp => {
        const phone = emp.phone?.trim() || '';
        const whatsapp = emp.whatsapp?.trim() || '';
        let derivedId = '';
        if (phone && whatsapp && phone === whatsapp) derivedId = phone.slice(-4);
        else if (whatsapp) derivedId = whatsapp.slice(-4);
        else if (phone) derivedId = phone.slice(-4);
        return derivedId === trimmedId;
      }) ?? null;

      // If matched legacy employee lacks explicit employeeId, save derived ID
      if (matchedEmployee && !matchedEmployee.employeeId) {
        const uniqueId = await generateUniqueEmployeeId(matchedEmployee.phone, matchedEmployee.whatsapp, matchedEmployee.id);
        matchedEmployee = await prisma.employee.update({
          where: { id: matchedEmployee.id },
          data: { employeeId: uniqueId }
        });
      }
    }

    if (!matchedEmployee) {
      recordFailedAttempt(rateKey);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password' });
    }

    // Check Password
    let isPasswordValid = false;
    if (matchedEmployee.password) {
      isPasswordValid = await bcrypt.compare(password, matchedEmployee.password);
    } else {
      // Legacy fallback: if admin employee has no password set yet, allow initial setup password 'admin123' or '1234'
      if (matchedEmployee.role === 'ADMIN' && (password === 'admin123' || password === '1234')) {
        isPasswordValid = true;
        const hashed = await bcrypt.hash(password, 10);
        await prisma.employee.update({
          where: { id: matchedEmployee.id },
          data: { password: hashed }
        });
      }
    }

    if (!isPasswordValid) {
      recordFailedAttempt(rateKey);
      return res.status(401).json({ success: false, error: 'Invalid Employee ID or password' });
    }

    // Success - clear rate limit counter
    clearFailedAttempts(rateKey);

    // Map EmployeeRole to UserRole
    let userRole: any = 'SALESMAN';
    if (matchedEmployee.role === 'ADMIN') userRole = 'OWNER';
    else if (matchedEmployee.role === 'SUPERVISOR') userRole = 'MANAGER';
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
          password: matchedEmployee.password || 'employee_hashed_login_pass',
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

    // Issue 30m Access Token & 7d Refresh Token
    const { accessToken, refreshToken } = signAuthTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      employeeId: matchedEmployee.employeeId || undefined,
    });

    // Set HTTP-only Cookies
    res.cookie('sabzi_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000, // 30 minutes
      path: '/',
    });

    res.cookie('sabzi_refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      data: {
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          employeeId: matchedEmployee.employeeId,
        }
      }
    });
  } catch (error: any) {
    console.error('[login]', error);
    return res.status(500).json({ success: false, error: error.message ?? 'Internal server error' });
  }
});

// POST /api/auth/refresh (Automatic Silent Refresh Token Rotation)
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = extractRefreshToken(req);

    if (!refreshToken) {
      return res.status(401).json({ success: false, error: 'Refresh token is required' });
    }

    const newTokens = rotateRefreshToken(refreshToken);

    if (!newTokens) {
      return res.status(401).json({
        success: false,
        error: 'Invalid, expired, or revoked refresh token. Please log in again.'
      });
    }

    // Set updated cookies
    res.cookie('sabzi_token', newTokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000, // 30 minutes
      path: '/',
    });

    res.cookie('sabzi_refresh_token', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    return res.json({
      success: true,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    });
  } catch (error: any) {
    console.error('[refresh]', error);
    return res.status(500).json({ success: false, error: 'Failed to refresh token' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  const refreshToken = extractRefreshToken(req);
  if (refreshToken) {
    revokeRefreshToken(refreshToken);
  }

  res.clearCookie('sabzi_token', { path: '/' });
  res.clearCookie('sabzi_refresh_token', { path: '/' });
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
