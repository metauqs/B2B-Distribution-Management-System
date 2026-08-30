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

// In-Memory cache for /me endpoint (5m TTL) to eliminate query storms
const ME_CACHE = new Map<string, { ts: number; user: any }>();
const ME_CACHE_TTL = 300000;
const AUTH_ME_IN_FLIGHT = new Map<string, Promise<any>>();
const AUTH_REFRESH_IN_FLIGHT = new Map<string, Promise<any>>();

// Short-lived employee lookup cache for login (60s TTL) — avoids sequential cold DB hits per login attempt
// Security note: bcrypt.compare() is ALWAYS performed; only the DB lookup is cached.
const EMPLOYEE_LOGIN_CACHE = new Map<string, { ts: number; data: any }>();
const EMPLOYEE_LOGIN_CACHE_TTL = 60000;

// 1-hour branch ID cache — branches never change during a session
let BRANCH_ID_LOGIN_CACHE: { ts: number; id: string } | null = null;
const BRANCH_ID_LOGIN_TTL = 3600000;

async function getCachedLoginBranchId(): Promise<string> {
  if (BRANCH_ID_LOGIN_CACHE && (Date.now() - BRANCH_ID_LOGIN_CACHE.ts) < BRANCH_ID_LOGIN_TTL) {
    return BRANCH_ID_LOGIN_CACHE.id;
  }
  const branch = await prisma.branch.findFirst();
  const id = branch?.id ?? '';
  if (id) BRANCH_ID_LOGIN_CACHE = { ts: Date.now(), id };
  return id;
}

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

    // Check login cache first (60s TTL — bcrypt.compare is always done even for cached entries)
    let matchedEmployee: any = null;
    const cachedEntry = EMPLOYEE_LOGIN_CACHE.get(trimmedId);
    if (cachedEntry && (Date.now() - cachedEntry.ts) < EMPLOYEE_LOGIN_CACHE_TTL) {
      matchedEmployee = cachedEntry.data;
    } else {
      // 1. Direct search by exact stored employeeId field + phone fallback in parallel
      const [byId, byPhone] = await Promise.all([
        prisma.employee.findFirst({ where: { employeeId: trimmedId } }),
        trimmedId.length >= 4
          ? prisma.employee.findFirst({
              where: {
                OR: [
                  { phone: { endsWith: trimmedId } },
                  { whatsapp: { endsWith: trimmedId } },
                ],
                isActive: true,
              },
            })
          : Promise.resolve(null),
      ]);
      matchedEmployee = byId ?? byPhone ?? null;

      if (matchedEmployee) {
        // Cache the found employee for 60s
        if (EMPLOYEE_LOGIN_CACHE.size > 200) EMPLOYEE_LOGIN_CACHE.clear();
        EMPLOYEE_LOGIN_CACHE.set(trimmedId, { ts: Date.now(), data: matchedEmployee });
      }
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

    // Ensure valid branchId reference before User creation/update (cached — branches never change)
    let targetBranchId = matchedEmployee.branchId || await getCachedLoginBranchId();

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

    // Populate fast ME_CACHE immediately
    ME_CACHE.set(user.id, {
      ts: Date.now(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branchId: targetBranchId,
        isActive: true,
        employee: {
          id: matchedEmployee.id,
          employeeId: matchedEmployee.employeeId,
          name: matchedEmployee.name,
          role: matchedEmployee.role,
          phone: matchedEmployee.phone,
          whatsapp: matchedEmployee.whatsapp,
        },
      }
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

    const userId = decoded.sub;
    if (AUTH_REFRESH_IN_FLIGHT.has(userId)) {
      const coalesced = await AUTH_REFRESH_IN_FLIGHT.get(userId);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json(coalesced);
    }

    const performRefreshPromise = (async () => {
      let user: any = null;
      const cached = ME_CACHE.get(userId);
      if (cached && (Date.now() - cached.ts) < ME_CACHE_TTL) {
        user = cached.user;
      } else {
        try {
          const rows: any[] = await prisma.$queryRaw`
            SELECT id, email, name, role, "branchId", "isActive"
            FROM users
            WHERE id = ${userId} AND "deletedAt" IS NULL
            LIMIT 1
          `;
          if (rows.length > 0 && rows[0].isActive) {
            user = rows[0];
            ME_CACHE.set(user.id, { ts: Date.now(), user });
          }
        } catch {
          // If DB is temporarily sleeping/slow, use cryptographic JWT verified claims
          if (decoded.sub && decoded.email && decoded.role) {
            user = {
              id: decoded.sub,
              email: decoded.email,
              role: decoded.role,
              branchId: decoded.branchId,
              isActive: true,
            };
          }
        }
      }

      if (!user || !user.isActive) {
        return null;
      }

      const newTokens = signAuthTokens({
        sub: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branchId,
        employeeId: decoded.employeeId,
      });

      return {
        success: true,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
      };
    })();

    AUTH_REFRESH_IN_FLIGHT.set(userId, performRefreshPromise);
    try {
      const result = await performRefreshPromise;
      if (!result) {
        return res.status(401).json({ success: false, error: 'User disabled or not found' });
      }

      res.cookie('sabzi_token', result.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 30 * 60 * 1000,
        path: '/',
      });

      res.cookie('sabzi_refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      return res.json(result);
    } finally {
      AUTH_REFRESH_IN_FLIGHT.delete(userId);
    }
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
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.user });
    }

    if (AUTH_ME_IN_FLIGHT.has(userId)) {
      const coalesced = await AUTH_ME_IN_FLIGHT.get(userId);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchMePromise = (async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          phone: true,
          branchId: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          deletedAt: true,
          branch: { select: { id: true, name: true } },
        },
      });

      if (!user || !user.isActive || user.deletedAt) {
        ME_CACHE.delete(userId);
        return null;
      }

      return user;
    })();

    AUTH_ME_IN_FLIGHT.set(userId, fetchMePromise);
    try {
      const safeUser = await fetchMePromise;
      if (!safeUser) {
        return res.status(401).json({ success: false, error: 'User not found or inactive' });
      }
      if (ME_CACHE.size > 50) ME_CACHE.clear();
      ME_CACHE.set(userId, { ts: Date.now(), user: safeUser });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: safeUser });
    } finally {
      AUTH_ME_IN_FLIGHT.delete(userId);
    }
  } catch (error) {
    console.error('[me]', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  if (req.user?.sub) ME_CACHE.delete(req.user.sub);
  res.clearCookie('sabzi_token', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.clearCookie('sabzi_refresh_token', {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  return res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
