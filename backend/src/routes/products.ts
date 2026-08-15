import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { writeAuditLog, getValidUserId } from '../lib/business';

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

// GET /api/products/:id/audit-logs (Product Edit Audit History)
router.get('/:id/audit-logs', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        entity: 'Product',
        entityId: id,
      },
      include: {
        user: { select: { id: true, name: true, role: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return res.json({ success: true, data: logs });
  } catch (err: any) {
    console.error('Error fetching product audit logs:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch audit logs', data: [] });
  }
});

import { getCurrentBusinessDateRange } from '../lib/businessDate';
import path from 'path';
import fs from 'fs';

function getUploadDirectories() {
  const dirs = [
    path.resolve(__dirname, '../../uploads/products'),
    path.resolve(__dirname, '../uploads/products'),
    path.resolve(process.cwd(), 'uploads/products'),
    path.resolve(process.cwd(), '../frontend/public/uploads/products'),
  ];
  return [...new Set(dirs)];
}

function findImageFile(filename: string): string | null {
  const safeFilename = path.basename(filename);
  for (const dir of getUploadDirectories()) {
    const candidate = path.join(dir, safeFilename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// GET /api/products/image/:filename — Public product image serving
router.get('/image/:filename', (req: Request, res: Response) => {
  const { filename } = req.params;
  const filePath = findImageFile(filename);
  if (filePath) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(filePath);
  }
  return res.status(404).json({ success: false, error: 'Image not found' });
});

// GET /api/products/:id/image — Serve image by Product ID
router.get('/:id/image', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const product = await prisma.product.findUnique({ where: { id }, select: { imageUrl: true } });
    if (!product || !product.imageUrl) {
      return res.status(404).json({ success: false, error: 'No image found for product' });
    }

    if (product.imageUrl.startsWith('data:image/')) {
      const match = product.imageUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(buffer);
      }
    }

    const filename = path.basename(product.imageUrl.split('?')[0]);
    const filePath = findImageFile(filename);
    if (filePath) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(filePath);
    }

    return res.status(404).json({ success: false, error: 'Image file not found on server' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/products
router.post('/', async (req: Request, res: Response) => {
  const branchId = (req.headers['x-branch-id'] as string) || 'branch_main';
  const userId = (req.headers['x-user-id'] as string) || null;
  const { name, urduName, emoji, imageUrl, category, defaultUnit, availability, minStock, sortOrder } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, error: 'Name required' });

  // Normalize enum values — accept both 'vegetable' and 'VEGETABLE'
  const normalizedCategory = (category ?? 'VEGETABLE').toString().toUpperCase();
  const normalizedUnit = (defaultUnit ?? 'KG').toString().toUpperCase();
  const normalizedAvail = (availability ?? 'AVAILABLE').toString().toUpperCase();

  try {
    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name: name.trim(),
          urduName: urduName?.trim() || undefined,
          emoji: emoji?.trim() || undefined,
          imageUrl: imageUrl?.trim() || undefined,
          category: normalizedCategory as any,
          defaultUnit: normalizedUnit as any,
          availability: normalizedAvail as any,
          minStock: minStock ?? 0,
          sortOrder: sortOrder ?? 0,
          isActive: true,
        },
      });

      // 1. Auto-initialize Inventory record for this product
      const existingInv = await tx.inventory.findFirst({
        where: { productId: p.id, branchId }
      });
      if (!existingInv) {
        await tx.inventory.create({
          data: {
            productId: p.id,
            branchId,
            qty: 0,
            reservedQty: 0,
            minStock: minStock ?? 0,
            avgCost: 0,
            currentBuyPrice: 0,
            previousBuyPrice: 0,
          }
        });
      }

      // 2. If today's active PriceList exists, auto-attach a PriceItem
      const { start: todayStart, end: todayEnd } = getCurrentBusinessDateRange();
      const activePriceList = await tx.priceList.findFirst({
        where: {
          branchId,
          date: { gte: todayStart, lte: todayEnd },
          isActive: true,
        }
      });

      if (activePriceList) {
        await tx.priceItem.upsert({
          where: { priceListId_itemName: { priceListId: activePriceList.id, itemName: p.name } },
          update: {
            productId: p.id,
            unit: p.defaultUnit,
          },
          create: {
            priceListId: activePriceList.id,
            productId: p.id,
            itemName: p.name,
            unit: p.defaultUnit,
            buyRate: 0,
            sellRate: 0,
          }
        });
      }

      return p;
    });

    const validUser = await getValidUserId(userId);
    await writeAuditLog({
      userId: validUser ?? undefined,
      branchId,
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
      newData: { name: product.name, unit: product.defaultUnit, category: product.category, imageUrl: product.imageUrl, emoji: product.emoji }
    });

    return res.status(201).json({ success: true, data: product });
  } catch (e: any) {
    console.error('Error creating product:', e);
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'A product with this name already exists' });
    return res.status(500).json({ success: false, error: e.message ?? 'Failed to create product' });
  }
});

// POST /api/products/:id/image (Upload / Replace product image)
router.post('/:id/image', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { imageBase64, filename } = req.body;

  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing imageBase64 payload' });
  }

  try {
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Extract base64 data and mime type
    let mimeType = 'image/png';
    let base64Data = imageBase64;
    const match = imageBase64.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1].toLowerCase();
      base64Data = match[2];
    }

    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedMimeTypes.includes(mimeType)) {
      return res.status(400).json({ success: false, error: 'Invalid image type. Only PNG, JPG, and WEBP are supported.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image size exceeds maximum allowed 5MB.' });
    }

    let ext = 'png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
    else if (mimeType.includes('webp')) ext = 'webp';

    const timestamp = Date.now();
    const newFilename = `prod_${id}_${timestamp}.${ext}`;
    const allDirs = getUploadDirectories();

    // 1. Clean up old image files across all upload directories
    if (existingProduct.imageUrl) {
      const oldFilename = path.basename(existingProduct.imageUrl.split('?')[0]);
      for (const dir of allDirs) {
        const oldPath = path.join(dir, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (err) { /* ignore */ }
        }
      }
    }

    // 2. Write file to all existing upload directories
    for (const dir of allDirs) {
      try {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const targetPath = path.join(dir, newFilename);
        fs.writeFileSync(targetPath, buffer);
      } catch (err) {
        console.warn(`Could not write image to directory ${dir}:`, err);
      }
    }

    const imageUrl = `/api/products/image/${newFilename}?v=${timestamp}`;

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: { imageUrl },
    });

    const rawUserId = (req.headers['x-user-id'] as string) || (req.headers['x-staff-id'] as string) || null;
    const validatedUserId = await getValidUserId(rawUserId);

    await writeAuditLog({
      userId: validatedUserId,
      branchId: (req.headers['x-branch-id'] as string) || undefined,
      action: 'PRODUCT_IMAGE_UPDATED',
      entity: 'Product',
      entityId: id,
      oldData: { imageUrl: existingProduct.imageUrl },
      newData: { imageUrl: updatedProduct.imageUrl },
    });

    return res.json({ success: true, data: updatedProduct, imageUrl });
  } catch (err: any) {
    console.error('Error uploading product image:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to upload product image' });
  }
});

// DELETE /api/products/:id/image (Remove product image)
router.delete('/:id/image', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    if (existingProduct.imageUrl) {
      const oldFilename = path.basename(existingProduct.imageUrl.split('?')[0]);
      for (const dir of getUploadDirectories()) {
        const oldPath = path.join(dir, oldFilename);
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath); } catch (err) { /* ignore */ }
        }
      }
    }

    const updatedProduct = await prisma.product.update({
      where: { id },
      data: { imageUrl: null },
    });

    const rawUserId = (req.headers['x-user-id'] as string) || (req.headers['x-staff-id'] as string) || null;
    const validatedUserId = await getValidUserId(rawUserId);

    await writeAuditLog({
      userId: validatedUserId,
      branchId: (req.headers['x-branch-id'] as string) || undefined,
      action: 'PRODUCT_IMAGE_REMOVED',
      entity: 'Product',
      entityId: id,
      oldData: { imageUrl: existingProduct.imageUrl },
      newData: { imageUrl: null },
    });

    return res.json({ success: true, data: updatedProduct });
  } catch (err: any) {
    console.error('Error removing product image:', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Failed to remove product image' });
  }
});

// PUT /api/products/:id (Update product) — also accepts PATCH
const updateProduct = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, urduName, emoji, imageUrl, category, defaultUnit, availability, minStock, sortOrder, isActive } = req.body;

  const trimmedName = name !== undefined ? name.trim() : undefined;
  if (name !== undefined && !trimmedName) {
    return res.status(400).json({ success: false, error: 'Product name cannot be empty' });
  }

  // Normalize enum values
  const normalizedCategory = category ? category.toString().toUpperCase() : undefined;
  const normalizedUnit = defaultUnit ? defaultUnit.toString().toUpperCase() : undefined;
  const normalizedAvail = availability ? availability.toString().toUpperCase() : undefined;

  try {
    const existingProduct = await prisma.product.findUnique({ where: { id } });
    if (!existingProduct) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    // Check duplicate name uniqueness if name is changed
    if (trimmedName && trimmedName !== existingProduct.name) {
      const duplicate = await prisma.product.findFirst({
        where: {
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (duplicate) {
        return res.status(409).json({ success: false, error: 'A product with this name already exists' });
      }
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...(trimmedName !== undefined && { name: trimmedName }),
        ...(urduName !== undefined && { urduName: urduName?.trim() || null }),
        ...(emoji !== undefined && { emoji: emoji?.trim() || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl?.trim() || null }),
        ...(normalizedCategory && { category: normalizedCategory as any }),
        ...(normalizedUnit && { defaultUnit: normalizedUnit as any }),
        ...(normalizedAvail && { availability: normalizedAvail as any }),
        ...(minStock !== undefined && { minStock: Number(minStock) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    // If product name changed, synchronize all PriceItems, PurchaseItems, SaleItems, and Wastages linked by productId
    if (trimmedName && trimmedName !== existingProduct.name) {
      await Promise.all([
        prisma.priceItem.updateMany({
          where: { productId: id },
          data: { itemName: trimmedName },
        }),
        prisma.purchaseItem.updateMany({
          where: { productId: id },
          data: { itemName: trimmedName },
        }),
        prisma.saleItem.updateMany({
          where: { productId: id },
          data: { itemName: trimmedName },
        }),
        prisma.wastage.updateMany({
          where: { productId: id },
          data: { itemName: trimmedName },
        }),
      ]);
    }

    // Record Audit Log for Product Update
    const rawUserId = (req.headers['x-user-id'] as string) || (req.headers['x-staff-id'] as string) || null;
    const validatedUserId = await getValidUserId(rawUserId);

    await writeAuditLog({
      userId: validatedUserId,
      branchId: (req.headers['x-branch-id'] as string) || undefined,
      action: 'PRODUCT_NAME_UPDATED',
      entity: 'Product',
      entityId: id,
      oldData: {
        name: existingProduct.name,
        urduName: existingProduct.urduName,
        emoji: existingProduct.emoji,
        imageUrl: existingProduct.imageUrl,
        category: existingProduct.category,
        defaultUnit: existingProduct.defaultUnit,
        availability: existingProduct.availability,
      },
      newData: {
        name: product.name,
        urduName: product.urduName,
        emoji: product.emoji,
        imageUrl: product.imageUrl,
        category: product.category,
        defaultUnit: product.defaultUnit,
        availability: product.availability,
      },
    });

    return res.json({ success: true, data: product });
  } catch (e: any) {
    console.error('Error updating product:', e);
    if (e.code === 'P2002') return res.status(409).json({ success: false, error: 'A product with this name already exists' });
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
