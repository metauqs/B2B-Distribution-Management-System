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

  // Normalize enum values — accept both 'vegetable' and 'VEGETABLE'
  const normalizedCategory = (category ?? 'VEGETABLE').toString().toUpperCase();
  const normalizedUnit = (defaultUnit ?? 'KG').toString().toUpperCase();
  const normalizedAvail = (availability ?? 'AVAILABLE').toString().toUpperCase();

  try {
    const product = await prisma.product.create({
      data: {
        name: name.trim(),
        urduName: urduName?.trim() || undefined,
        category: normalizedCategory as any,
        defaultUnit: normalizedUnit as any,
        availability: normalizedAvail as any,
        minStock: minStock ?? 0,
        sortOrder: sortOrder ?? 0,
        isActive: true,
      },
    });
    return res.status(201).json({ success: true, data: product });
  } catch (e: any) {
    console.error('Error creating product:', e);
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'A product with this name already exists' });
    return res.status(500).json({ success: false, error: e.message ?? 'Failed to create product' });
  }
});

// PUT /api/products/:id (Update product) — also accepts PATCH
const updateProduct = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, urduName, category, defaultUnit, availability, minStock, sortOrder, isActive } = req.body;
  if (name !== undefined && !name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

  // Normalize enum values
  const normalizedCategory = category ? category.toString().toUpperCase() : undefined;
  const normalizedUnit = defaultUnit ? defaultUnit.toString().toUpperCase() : undefined;
  const normalizedAvail = availability ? availability.toString().toUpperCase() : undefined;

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(urduName !== undefined && { urduName: urduName?.trim() || null }),
        ...(normalizedCategory && { category: normalizedCategory as any }),
        ...(normalizedUnit && { defaultUnit: normalizedUnit as any }),
        ...(normalizedAvail && { availability: normalizedAvail as any }),
        ...(minStock !== undefined && { minStock: Number(minStock) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });
    return res.json({ success: true, data: product });
  } catch (e: any) {
    console.error('Error updating product:', e);
    return res.status(500).json({ success: false, error: e.message ?? 'Failed to update product' });
  }
};

router.put('/:id', updateProduct);
router.patch('/:id', updateProduct);

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
