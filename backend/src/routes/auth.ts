import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { signToken, authMiddleware } from '../middleware/auth';
import { config } from '../config/env';

const router = Router();
const JWT_SECRET = config.jwt.secret;

// Helper to sign access and refresh tokens
function signAuthTokens(payload: { sub: string; email: string; role: string; branchId: string; employeeId?: string }) {
  const accessToken = jwt.sign({ ...payload, type: 'access' }, JWT_SECRET, { expiresIn: '30m' });
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' });
  return { accessToken, refreshToken };
}

import { authRateLimiter } from '../middleware/rateLimiter';

// Apply auth rate limiter to login and refresh endpoints
router.use('/login', authRateLimiter);
router.use('/refresh', authRateLimiter);

// In-Memory cache for /me endpoint (30s TTL) to eliminate query storms
const ME_CACHE = new Map<string, { ts: number; user: any }>();
const ME_CACHE_TTL = 30000;

export function invalidateMeCache(userId?: string) {
  if (userId) ME_CACHE.delete(userId);
  else ME_CACHE.clear();
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { employeeId, password } = req.body;

    if (!employeeId || typeof employeeId !== 'string') {
      return res.status(400).json({ success: false, error: 'Employee ID is required' });
    }

    const trimmedId = employeeId.trim();

    // 1. Direct search by exact stored employeeId field
    let matchedEmployee = await prisma.employee.findFirst({
      where: { employeeId: trimmedId }
    });

    // 2. Fallback to phone search if not found
    if (!matchedEmployee && trimmedId.length >= 4) {
      matchedEmployee = await prisma.employee.findFirst({
        where: {
          OR: [
            { phone: { endsWith: trimmedId } },
            { whatsapp: { endsWith: trimmedId } },
          ],
          isActive: true,
        }
      });
    }

    // 3. Fail-safe admin check only if employee not found
    if (!matchedEmployee) {
      try {
        const employeeCount = await prisma.employee.count();
        if (employeeCount === 0) {
          const branch = await prisma.branch.findFirst();
          if (branch) {
            const adminPass = await bcrypt.hash(config.initialAdmin.password, 10);
            matchedEmployee = await prisma.employee.create({
              data: {
                employeeId: config.initialAdmin.employeeId,
                password: adminPass,
                name: 'System Admin (Owner)',
                role: 'ADMIN',
                phone: '03000000000',
                whatsapp: '03000000000',
                branchId: branch.id,
                isActive: true,
              }
            });
          }
        }
      } catch {}
    }

    if (!matchedEmployee) {
      console.warn(`[AUTH FAILURE] Employee not found for ID: "${trimmedId}"`);
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Check if account is active
    if (!matchedEmployee.isActive) {
      console.warn(`[AUTH BLOCKED] Inactive account attempt: "${trimmedId}"`);
      return res.status(403).json({ success: false, error: 'Your account is inactive. Please contact administrator.' });
    }

    // Strict password verification (Password is mandatory whenever employee has password configured)
    if (matchedEmployee.password) {
      if (!password || typeof password !== 'string') {
        console.warn(`[AUTH FAILURE] Missing password for Employee ID: "${trimmedId}"`);
        return res.status(401).json({ success: false, error: 'Password is required' });
      }
      const isPasswordValid = await bcrypt.compare(password, matchedEmployee.password);
      if (!isPasswordValid) {
        console.warn(`[AUTH FAILURE] Incorrect password for Employee ID: "${trimmedId}"`);
        return res.status(401).json({ success: false, error: 'Incorrect password' });
      }
    }

    console.log(`[AUTH SUCCESS] Successfully authenticated Employee ID: "${trimmedId}" (${matchedEmployee.name}, Role: ${matchedEmployee.role})`);

    // Map EmployeeRole to UserRole
    let userRole: any = 'SALESMAN';
    if (matchedEmployee.role === 'ADMIN') userRole = 'OWNER';
    else if (matchedEmployee.role === 'SUPERVISOR') userRole = 'MANAGER';
    else if (matchedEmployee.role === 'BILLING_STAFF') userRole = 'CASHIER';
    else if (matchedEmployee.role === 'PURCHASE_STAFF') userRole = 'ACCOUNTANT';
    else if (matchedEmployee.role === 'DELIVERY_STAFF') userRole = 'DELIVERY';

    // Ensure valid branchId reference before User creation/update
    let targetBranchId = matchedEmployee.branchId;
    if (targetBranchId) {
      const branchExists = await prisma.branch.findUnique({ where: { id: targetBranchId } });
      if (!branchExists) {
        const firstBranch = await prisma.branch.findFirst();
        if (firstBranch) {
          targetBranchId = firstBranch.id;
        } else {
          const newBranch = await prisma.branch.create({ data: { name: 'Main Branch' } });
          targetBranchId = newBranch.id;
        }
      }
    } else {
      const firstBranch = await prisma.branch.findFirst();
      if (firstBranch) {
        targetBranchId = firstBranch.id;
      } else {
        const newBranch = await prisma.branch.create({ data: { name: 'Main Branch' } });
        targetBranchId = newBranch.id;
      }
    }

    const userEmail = matchedEmployee.email?.trim() || `emp_${matchedEmployee.id}@sabziledger.com`;

    // Find or create User record to satisfy DB constraints
    let user = await prisma.user.findFirst({
      where: { email: userEmail },
    });

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            name: matchedEmployee.name,
            email: userEmail,
            password: matchedEmployee.password || (await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)),
            role: userRole,
            branchId: targetBranchId,
            isActive: true,
          },
        });
      } catch {
        user = (await prisma.user.findFirst({ where: { email: userEmail } }))!;
      }
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: matchedEmployee.name,
          role: userRole,
          branchId: targetBranchId,
          isActive: true,
          deletedAt: null,
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
      branchId: targetBranchId,
      employeeId: matchedEmployee.employeeId || undefined,
    });

    // Set HTTP-only Cookies
    res.cookie('sabzi_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
      path: '/',
    });

    res.cookie('sabzi_refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
    console.error('[AUTH LOGIN ERROR]', error);
    return res.status(500).json({ success: false, error: 'Employee not found or server connection issue. Please try again.' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.sabzi_refresh_token;

    if (!refreshToken) {
      return res.status(401).json({ success: false, error: 'Refresh Token required' });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ success: false, error: 'Invalid Refresh Token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub, deletedAt: null },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: 'User disabled or not found' });
    }

    const newTokens = signAuthTokens({
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      employeeId: decoded.employeeId,
    });

    res.cookie('sabzi_token', newTokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
      path: '/',
    });

    res.cookie('sabzi_refresh_token', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({
      success: true,
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    });
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired Refresh Token' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const userId = req.user.sub;
    const cached = ME_CACHE.get(userId);
    if (cached && (Date.now() - cached.ts) < ME_CACHE_TTL) {
      return res.json({ success: true, data: cached.user });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: { branch: { select: { id: true, name: true } } },
    });

    if (!user || !user.isActive) {
      ME_CACHE.delete(userId);
      return res.status(401).json({ success: false, error: 'User not found or inactive' });
    }

    const { password: _pwd, ...safeUser } = user;
    ME_CACHE.set(userId, { ts: Date.now(), user: safeUser });
    return res.json({ success: true, data: safeUser });
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  if (req.user?.sub) ME_CACHE.delete(req.user.sub);
  res.clearCookie('sabzi_token', { path: '/' });
  res.clearCookie('sabzi_refresh_token', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
