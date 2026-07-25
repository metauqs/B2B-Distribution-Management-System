import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /api/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const { category, availability } = req.query;

    const where: any = {};
    if (category) where.category = category;

    if (availability === 'ALL') {
      // no filter
    } else if (availability) {
      where.availability = availability;
    } else {
      where.availability = { in: ['AVAILABLE', 'SEASONAL'] };
      where.isActive = true;
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    });

    return res.json({ success: true, data: products });
  } catch (err: any) {
    console.error('Error fetching products:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to load products', data: [] });
  }
});

// POST /api/products
router.post('/', async (req: Request, res: Response) => {
  const { name, urduName, category, defaultUnit, availability, minStock, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

  try {
    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        urduName: urduName?.trim() || undefined,
        category: category ?? 'vegetable',
        defaultUnit: defaultUnit ?? 'KG',
        availability: availability ?? 'AVAILABLE',
        minStock: minStock ?? 0,
        sortOrder: sortOrder ?? 0,
        isActive: true,
      },
    });
    return res.status(201).json({ success: true, data: product });
  } catch (e: any) {
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'Product already exists' });
    return res.status(500).json({ success: false, error: 'Failed to create product' });
  }
});

// PUT /api/products/:id (Update product)
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, urduName, category, defaultUnit, availability, minStock, sortOrder, isActive } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        name: name.trim(),
        urduName: urduName?.trim() || null,
        category: category ?? undefined,
        defaultUnit: defaultUnit ?? undefined,
        availability: availability ?? undefined,
        minStock: minStock !== undefined ? Number(minStock) : undefined,
        sortOrder: sortOrder !== undefined ? Number(sortOrder) : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : undefined,
      },
    });
    return res.json({ success: true, data: product });
  } catch (e: any) {
    console.error('Error updating product:', e);
    return res.status(500).json({ success: false, error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id (Deactivate / Delete product)
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    // Check if it is used in any sale/purchase items, if so archive it, else delete it
    const [sales, purchases] = await Promise.all([
      prisma.saleItem.count({ where: { productId: id } }),
      prisma.purchaseItem.count({ where: { productId: id } }),
    ]);

    if (sales > 0 || purchases > 0) {
      const product = await prisma.product.update({
        where: { id },
        data: { isActive: false, availability: 'ARCHIVED' as any },
      });
      return res.json({ success: true, message: 'Product archived', data: product });
    } else {
      await prisma.product.delete({ where: { id } });
      return res.json({ success: true, message: 'Product deleted' });
    }
  } catch (e: any) {
    console.error('Error deleting product:', e);
    return res.status(500).json({ success: false, error: 'Failed to delete product' });
  }
});

export default router;
