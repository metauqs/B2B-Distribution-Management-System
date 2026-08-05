/**
 * InventoryService — Central inventory management engine for Halal Vegg Supplies ERP
 *
 * ALL stock movements MUST go through this service. Inventory is the Single Source of Truth.
 *
 * Flow:
 *   Purchase  → stockIn()        (Updates stock, current/previous buy price, price history, stock movement)
 *   Sale      → stockOut()       (Validates stock, deducts stock, creates stock movement)
 *   Wastage   → recordWastage()  (Deducts stock, creates wastage record + stock movement)
 *   Manual    → manualAdjust()   (Adjusts stock with reason, remarks, user, creates stock movement)
 *   Return    → stockReturn()    (Adds returned stock back to inventory, creates stock movement)
 */

import { prisma } from './prisma';

// ── 1. stockIn — Called from Purchase Entry ────────────────────────────────────

export interface StockInParams {
  productId: string;
  branchId: string;
  qty: number;
  rate: number; // Buy price
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  supplierId?: string;
  purchaseId?: string;
  userId?: string;
  date?: Date;
  note?: string;
}

export async function stockIn(tx: any, p: StockInParams): Promise<void> {
  const db = tx || prisma;
  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  const oldQty = existing?.qty ?? 0;
  const oldAvgCost = existing?.avgCost ?? 0;
  const newQty = oldQty + p.qty;

  // Weighted average cost calculation
  const newAvgCost = oldQty > 0
    ? (oldQty * oldAvgCost + p.qty * p.rate) / newQty
    : p.rate;

  // Preserve previous buy price and update current buy price
  const existingCurrentBuy = existing?.currentBuyPrice ?? 0;
  const previousBuyPrice = existingCurrentBuy > 0
    ? existingCurrentBuy
    : (existing?.previousBuyPrice ?? p.rate);
  const currentBuyPrice = p.rate;

  // Upsert Inventory record
  await db.inventory.upsert({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    update: {
      qty: newQty,
      avgCost: newAvgCost,
      currentBuyPrice,
      previousBuyPrice,
      lastPurchaseDate: p.date ?? new Date(),
      lastPurchaseQty: p.qty,
    },
    create: {
      productId: p.productId,
      branchId: p.branchId,
      qty: p.qty,
      avgCost: p.rate,
      currentBuyPrice,
      previousBuyPrice,
      lastPurchaseDate: p.date ?? new Date(),
      lastPurchaseQty: p.qty,
    },
  });

  // Record Purchase Price History log
  await db.purchasePriceHistory.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      purchaseId: p.purchaseId ?? (p.refType === 'purchase' ? p.refId : undefined),
      supplierId: p.supplierId ?? undefined,
      buyPrice: p.rate,
      qty: p.qty,
      date: p.date ?? new Date(),
    },
  });

  // Record Stock Movement with Previous Stock and New Stock
  await db.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      type: 'PURCHASE',
      qty: p.qty,
      previousStock: oldQty,
      newStock: newQty,
      refType: p.refType ?? 'purchase',
      refId: p.refId ?? undefined,
      userId: p.userId ?? undefined,
      date: p.date ?? new Date(),
      note: p.note ?? (p.refNo
        ? `Stock IN — ${p.refNo} | Qty: +${p.qty} ${p.unit ?? 'KG'} @ Rs ${p.rate}`
        : `Stock IN | Qty: +${p.qty} ${p.unit ?? 'KG'} @ Rs ${p.rate}`),
    },
  });
}

// ── 2. stockOut — Called from Sales Invoice Checkout ────────────────────────────

export interface StockOutParams {
  productId: string;
  branchId: string;
  qty: number;
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  userId?: string;
  date?: Date;
  note?: string;
}

export async function stockOut(tx: any, p: StockOutParams): Promise<void> {
  const db = tx || prisma;
  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    select: { qty: true, reservedQty: true },
  });

  const oldQty = existing?.qty ?? 0;
  const newQty = Math.max(0, oldQty - p.qty);

  await db.inventory.upsert({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    update: { qty: newQty },
    create: { productId: p.productId, branchId: p.branchId, qty: 0, avgCost: 0 },
  });

  await db.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      type: 'SALE',
      qty: -p.qty,
      previousStock: oldQty,
      newStock: newQty,
      refType: p.refType ?? 'sale',
      refId: p.refId ?? undefined,
      userId: p.userId ?? undefined,
      date: p.date ?? new Date(),
      note: p.note ?? (p.refNo
        ? `Stock OUT — ${p.refNo} | Qty: -${p.qty} ${p.unit ?? 'KG'}`
        : `Stock OUT | Qty: -${p.qty} ${p.unit ?? 'KG'}`),
    },
  });
}

// ── 3. recordWastage — Called from Wastage Entry ─────────────────────────────

export interface WastageParams {
  productId?: string | null;
  itemName: string;
  branchId: string;
  qty: number;
  unit?: string;
  reason?: string;
  remarks?: string;
  userId?: string;
  date?: Date;
}

export interface WastageResult {
  wastageId: string;
  refNo: string;
}

export async function recordWastage(tx: any, p: WastageParams): Promise<WastageResult> {
  const db = tx || prisma;
  const count = await db.wastage.count();
  const refNo = `WST-${String(count + 1).padStart(4, '0')}`;

  const wastageReason = [p.reason, p.remarks].filter(Boolean).join(' - ') || 'Wastage recorded';

  const wastage = await db.wastage.create({
    data: {
      productId: p.productId ?? undefined,
      itemName: p.itemName,
      qty: p.qty,
      unit: (p.unit ?? 'KG') as any,
      reason: wastageReason,
      date: p.date ?? new Date(),
      branchId: p.branchId,
    },
  });

  if (p.productId) {
    const existing = await db.inventory.findUnique({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    });

    const oldQty = existing?.qty ?? 0;
    const newQty = Math.max(0, oldQty - p.qty);

    if (existing) {
      await db.inventory.update({
        where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
        data: { qty: newQty },
      });
    } else {
      await db.inventory.create({
        data: { productId: p.productId, branchId: p.branchId, qty: 0, avgCost: 0 },
      });
    }

    await db.stockMovement.create({
      data: {
        productId: p.productId,
        branchId: p.branchId,
        type: 'WASTAGE',
        qty: -p.qty,
        previousStock: oldQty,
        newStock: newQty,
        refType: 'wastage',
        refId: wastage.id,
        userId: p.userId ?? undefined,
        date: p.date ?? new Date(),
        note: `${refNo} | ${wastageReason} | Qty: -${p.qty} ${p.unit ?? 'KG'}`,
      },
    });
  }

  return { wastageId: wastage.id, refNo };
}

// ── 4. manualAdjust — Called from Manual Stock Adjustment Form ──────────────────

export interface AdjustParams {
  productId: string;
  branchId: string;
  systemQty: number;
  adjustedQty: number; // For SET: final count; For INCREASE/DECREASE: adjustment amount
  adjustmentType?: 'SET' | 'INCREASE' | 'DECREASE';
  reason?: string;
  remarks?: string;
  userId?: string;
}

export interface AdjustResult {
  refNo: string;
  delta: number;
  previousQty: number;
  newQty: number;
}

export async function manualAdjust(tx: any, p: AdjustParams): Promise<AdjustResult> {
  const db = tx || prisma;
  const adjCount = await db.stockMovement.count({ where: { type: 'ADJUSTMENT' } });
  const refNo = `ADJ-${String(adjCount + 1).padStart(4, '0')}`;

  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  const previousQty = existing?.qty ?? p.systemQty;
  let newQty = previousQty;

  const adjType = p.adjustmentType ?? 'SET';
  if (adjType === 'INCREASE') {
    newQty = previousQty + Math.abs(p.adjustedQty);
  } else if (adjType === 'DECREASE') {
    newQty = Math.max(0, previousQty - Math.abs(p.adjustedQty));
  } else {
    // SET physical count
    newQty = Math.max(0, p.adjustedQty);
  }

  const delta = newQty - previousQty;
  const reasonText = [p.reason, p.remarks].filter(Boolean).join(' - ') || 'Manual adjustment';

  if (existing) {
    await db.inventory.update({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
      data: { qty: newQty },
    });
  } else {
    await db.inventory.create({
      data: { productId: p.productId, branchId: p.branchId, qty: newQty, avgCost: 0 },
    });
  }

  await db.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      type: 'ADJUSTMENT',
      qty: delta,
      previousStock: previousQty,
      newStock: newQty,
      refType: 'adjustment',
      refId: refNo,
      userId: p.userId ?? undefined,
      date: new Date(),
      note: `${refNo} | Stock: ${previousQty} → ${newQty} (${delta >= 0 ? '+' : ''}${delta}) | ${reasonText}`,
    },
  });

  return { refNo, delta, previousQty, newQty };
}

// ── 5. stockReturn — Called from Delivery Failure or Customer Return ───────────

export interface StockReturnParams {
  productId: string;
  branchId: string;
  qty: number;
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  reason?: string;
  userId?: string;
  date?: Date;
  note?: string;
}

export async function stockReturn(tx: any, p: StockReturnParams): Promise<void> {
  const db = tx || prisma;
  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    select: { qty: true },
  });

  const oldQty = existing?.qty ?? 0;
  const newQty = oldQty + p.qty;

  await db.inventory.upsert({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    update: { qty: newQty },
    create: { productId: p.productId, branchId: p.branchId, qty: p.qty, avgCost: 0 },
  });

  await db.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      type: 'ADJUSTMENT',
      qty: p.qty,
      previousStock: oldQty,
      newStock: newQty,
      refType: p.refType ?? 'return',
      refId: p.refId ?? undefined,
      userId: p.userId ?? undefined,
      date: p.date ?? new Date(),
      note: p.note ?? (p.refNo
        ? `Stock Return — ${p.refNo} | Qty: +${p.qty} ${p.unit ?? 'KG'}${p.reason ? ` | ${p.reason}` : ''}`
        : `Stock Return | Qty: +${p.qty} ${p.unit ?? 'KG'}${p.reason ? ` | ${p.reason}` : ''}`),
    },
  });
}
