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
    path.resolve(process.cwd(), 'backend/uploads/products'),
    path.resolve(process.cwd(), '../frontend/public/uploads/products'),
    path.resolve(__dirname, '../../../frontend/public/uploads/products'),
    path.resolve(__dirname, '../../../frontend/public'),
    path.resolve(process.cwd(), '../frontend/public'),
    path.resolve(process.cwd(), 'frontend/public'),
    path.resolve(process.cwd(), 'public'),
  ];
  return [...new Set(dirs)];
}

export function findImageFile(filename: string): string | null {
  const safeFilename = path.basename(filename);
  if (!safeFilename) return null;

  // 1. Direct filename match
  for (const dir of getUploadDirectories()) {
    const candidate = path.join(dir, safeFilename);
    if (fs.existsSync(candidate)) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.size > 0) return candidate;
      } catch {
        return candidate;
      }
    }
  }

  // 2. Match by Product ID prefix (e.g. prod_cms1nyk1700026vzmldlbqpfk_*)
  const prodIdMatch = safeFilename.match(/^prod_([a-zA-Z0-9]+)/) || safeFilename.match(/^([a-zA-Z0-9]{20,30})/);
  if (prodIdMatch && prodIdMatch[1]) {
    const targetId = prodIdMatch[1];
    for (const dir of getUploadDirectories()) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          const matched = files.find(f => f.startsWith(`prod_${targetId}`) || f.startsWith(targetId));
          if (matched) {
            const candidate = path.join(dir, matched);
            const stats = fs.statSync(candidate);
            if (stats.size > 0) return candidate;
          }
        } catch { /* ignore */ }
      }
    }
  }

  return null;
}

export function getProductFallbackEmoji(name: string): string {
  const n = (name || '').toLowerCase().trim();

  // Pre-mapped images / special fruits
  if (n.includes('lady finger') || n.includes('okra') || n.includes('bhindi') || n === 'ladyfinger') return '🫛';
  if (n.includes('guava') || n.includes('amrood')) return '🍏';
  if (n.includes('papaya') || n.includes('papeeta') || n.includes('papiya')) return '🍈';
  if (n.includes('pomegranate') || n.includes('anar')) return '🍎';
  if (n.includes('turnip') || n.includes('shalgam')) return '🫜';
  if (n.includes('radish') || n.includes('mooli')) return '🫜';
  if (n.includes('beetroot') || n.includes('chukandar')) return '🫜';
  if (n.includes('plum') || n.includes('alobukhara') || n.includes('alubukhara')) return '🍑';

  // Vegetables
  if (n.includes('beans') || n.includes('phali')) return '🫘';
  if (n.includes('bitter') || n.includes('karela')) return '🥒';
  if (n.includes('bottle') || n.includes('lauki') || n.includes('ghia') || n.includes('gourd') || n.includes('tori') || n.includes('turi') || n.includes('turai')) return '🥒';
  if (n.includes('brinjal') || n.includes('baingan') || n.includes('eggplant')) return '🍆';
  if (n.includes('broccoli')) return '🥦';
  if (n.includes('cabbage') || n.includes('gobhi') || n.includes('gobi')) return '🥬';
  if (n.includes('capsicum') || n.includes('shimla')) return '🫑';
  if (n.includes('carrot') || n.includes('gajar')) return '🥕';
  if (n.includes('cauliflower')) return '🥦';
  if (n.includes('coriander') || n.includes('dhaniya')) return '🌿';
  if (n.includes('corn') || n.includes('makai') || n.includes('bhutta')) return '🌽';
  if (n.includes('cucumber') || n.includes('kheera')) return '🥒';
  if (n.includes('garlic') || n.includes('lehsun')) return '🧄';
  if (n.includes('ginger') || n.includes('adrak')) return '🫚';
  if (n.includes('green chilli') || n.includes('green chili') || n.includes('hari mirch')) return '🌶️';
  if (n.includes('chilli') || n.includes('chili') || n.includes('mirch')) return '🌶️';
  if (n.includes('iceberg')) return '🥬';
  if (n.includes('lemon') || n.includes('limo') || n.includes('nimbu')) return '🍋';
  if (n.includes('lettuce')) return '🥬';
  if (n.includes('mint') || n.includes('pudina')) return '🌿';
  if (n.includes('mushroom')) return '🍄';
  if (n.includes('onion') || n.includes('piaz') || n.includes('pyaz')) return '🧅';
  if (n.includes('peas') || n.includes('matar')) return '🫛';
  if (n.includes('potato') || n.includes('aloo')) return '🥔';
  if (n.includes('pumpkin') || n.includes('kaddu')) return '🎃';
  if (n.includes('spinach') || n.includes('palak')) return '🥬';
  if (n.includes('sweet potato') || n.includes('shakarkandi')) return '🍠';
  if (n.includes('tomato') || n.includes('tamatar')) return '🍅';
  if (n.includes('spring onion') || n.includes('hari piaz')) return '🧅';
  if (n.includes('arvi')) return '🥔';

  // Fruits
  if (n.includes('apple') || n.includes('seeb')) return '🍎';
  if (n.includes('banana') || n.includes('kela')) return '🍌';
  if (n.includes('grapes') || n.includes('angoor')) return '🍇';
  if (n.includes('mango') || n.includes('aam')) return '🥭';
  if (n.includes('melon') || n.includes('kharbooza')) return '🍈';
  if (n.includes('orange') || n.includes('malta') || n.includes('kinnow')) return '🍊';
  if (n.includes('peach') || n.includes('aaroo')) return '🍑';
  if (n.includes('pear') || n.includes('nashpati')) return '🍐';
  if (n.includes('watermelon') || n.includes('tarbooz')) return '🍉';

  return '🥬';
}

export function generateProductSvgFallback(emoji: string): string {
  const cleanEmoji = (emoji && emoji.trim()) || '🥬';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" dir="ltr" direction="ltr" style="direction:ltr;unicode-bidi:isolate;background:transparent;">
  <text x="32" y="34" font-size="44" text-anchor="middle" dominant-baseline="central" alignment-baseline="central" direction="ltr" unicode-bidi="isolate" style="direction:ltr;unicode-bidi:isolate;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI Symbol',sans-serif;">${cleanEmoji}</text>
</svg>`;
}

function sendSvg(res: any, svg: string) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (typeof res.send === 'function') {
    return res.send(svg);
  }
  res.end(svg);
}

export async function serveProductImageOrFallback(filenameOrId: string, res: Response, isId = false, req?: Request) {
  const safeFilename = path.basename(filenameOrId.split('?')[0]);
  let filePath = isId ? null : findImageFile(safeFilename);

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (filePath && fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(filePath);
  }

  // Check query params if passed
  const queryEmoji = typeof req?.query?.emoji === 'string' ? req.query.emoji : null;
  const queryName = typeof req?.query?.name === 'string' ? req.query.name : null;

  // Look up product in DB to find its name/emoji
  try {
    let product: any = null;
    if (isId) {
      product = await prisma.product.findUnique({ where: { id: filenameOrId }, select: { name: true, emoji: true, imageUrl: true } });
    } else {
      product = await prisma.product.findFirst({
        where: {
          OR: [
            { imageUrl: { contains: safeFilename } },
            { id: safeFilename.replace(/\.[^/.]+$/, '') },
          ]
        },
        select: { name: true, emoji: true, imageUrl: true },
      });
    }

    if (product && product.imageUrl && product.imageUrl.startsWith('data:image/')) {
      const match = product.imageUrl.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const buffer = Buffer.from(match[2], 'base64');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        if (typeof (res as any).send === 'function') {
          return (res as any).send(buffer);
        }
        return res.end(buffer);
      }
    }

    if (product && product.imageUrl && !isId) {
      const altFile = path.basename(product.imageUrl.split('?')[0]);
      const altPath = findImageFile(altFile);
      if (altPath && fs.existsSync(altPath)) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.sendFile(altPath);
      }
    }

    // Check for pre-mapped static PNG assets by product name
    const productName = (product?.name || queryName || '').toLowerCase().trim();
    if (productName) {
      const staticImageNames: Record<string, string> = {
        'lady finger': 'ladyfinger.png',
        'ladyfinger': 'ladyfinger.png',
        'bhindi': 'ladyfinger.png',
        'okra': 'ladyfinger.png',
        'guava': 'guava.png',
        'amrood': 'guava.png',
        'papaya': 'papaya.png',
        'papeeta': 'papaya.png',
        'papiya': 'papaya.png',
        'pomegranate': 'pomegranate.png',
        'anar': 'pomegranate.png',
        'turnip': 'turnip.png',
        'shalgam': 'turnip.png',
        'shuljam': 'turnip.png',
        'radish': 'radish.png',
        'mooli': 'radish.png',
        'beetroot': 'beetroot.png',
        'chukandar': 'beetroot.png',
        'plum': 'plum.png',
        'alobukhara': 'plum.png',
        'alubukhara': 'plum.png',
      };

      for (const [key, imgFile] of Object.entries(staticImageNames)) {
        if (productName.includes(key)) {
          const staticPath = findImageFile(imgFile);
          if (staticPath && fs.existsSync(staticPath)) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.sendFile(staticPath);
          }
        }
      }
    }

    return res.status(404).send('Image not found');
  } catch (err) {
    return res.status(404).send('Image not found');
  }
}

// GET /api/products/image/:filename — Public product image serving (with 100% SVG fallback guarantee)
router.get('/image/:filename', (req: Request, res: Response) => {
  return serveProductImageOrFallback(req.params.filename, res, false, req);
});

// GET /api/products/:id/image — Serve image by Product ID (with 100% SVG fallback guarantee)
router.get('/:id/image', async (req: Request, res: Response) => {
  return serveProductImageOrFallback(req.params.id, res, true, req);
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
