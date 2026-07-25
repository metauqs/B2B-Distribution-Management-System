import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/suppliers
router.get('/', async (req: Request, res: Response) => {
  try {
    const branchId = (req.headers['x-branch-id'] as string) || undefined;
    const suppliers = await prisma.supplier.findMany({
      where: { ...(branchId ? { branchId } : {}), deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const purchasesArr = await prisma.purchase.groupBy({
      by: ['supplierId'], where: { ...(branchId ? { branchId } : {}), deletedAt: null }, _sum: { total: true },
    });
    const paymentsArr = await prisma.supplierPayment.groupBy({
      by: ['supplierId'], where: branchId ? { branchId } : {}, _sum: { amount: true },
    });
    const purchMap = Object.fromEntries(purchasesArr.map(x => [x.supplierId, x._sum.total ?? 0]));
    const payMap = Object.fromEntries(paymentsArr.map(x => [x.supplierId, x._sum.amount ?? 0]));

    const data = suppliers.map(s => ({
      ...s,
      currentBalance: s.openingBalance + (purchMap[s.id] ?? 0) - (payMap[s.id] ?? 0),
    }));

    return res.json({ success: true, data });
  } catch (err: any) {
    console.error('Error fetching suppliers:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load suppliers', data: [] });
  }
});

// POST /api/suppliers
router.post('/', async (req: Request, res: Response) => {
  try {
    const branchId = req.headers['x-branch-id'] as string;
    if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

    const { name, phone, address, openingBalance } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

    const supplier = await prisma.supplier.create({
      data: { name: name.trim(), phone, address, openingBalance: openingBalance ?? 0, branchId },
    });
    return res.status(201).json({ success: true, data: supplier });
  } catch (err: any) {
    console.error('Error creating supplier:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to create supplier' });
  }
});

export default router;
