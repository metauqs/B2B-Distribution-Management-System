import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/settings/users
router.get('/users', async (req: Request, res: Response) => {
  const role = req.headers['x-user-role'] as string;
  if (role !== 'OWNER' && role !== 'MANAGER' && role !== 'ADMIN') {
    return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions to view system users' });
  }

  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const users = await prisma.user.findMany({
      where: { branchId, deletedAt: null },
      select: { id: true, name: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, data: users });
  } catch (err: any) {
    console.error('Error fetching users:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load users' });
  }
});

// POST /api/settings/users
router.post('/users', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const role = req.headers['x-user-role'] as string;

  if (role !== 'OWNER') {
    return res.status(403).json({ success: false, error: 'Only owner can add users' });
  }

  const { name, email, password, role: userRole } = req.body;

  if (!name || !email || !password || !branchId) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { name, email, password: hashed, role: userRole ?? 'SALESMAN', branchId },
      select: { id: true, name: true, email: true, role: true },
    });

    return res.json({ success: true, data: user });
  } catch (err: any) {
    console.error('Error creating user:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create user' });
  }
});

export default router;
