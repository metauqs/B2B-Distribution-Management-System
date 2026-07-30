/**
 * InventoryService — Central inventory management for Halal Vegg Supplies ERP
 *
 * ALL stock movements must go through this service. Never update Inventory directly.
 *
 * Flow:
 *   Purchase  → stockIn()
 *   Sale      → stockOut()
 *   Wastage   → recordWastage()
 *   Manual    → manualAdjust()
 *
 * Each function updates Inventory + creates a StockMovement inside the same transaction.
 */

import { prisma } from './prisma';

// ── stockIn — called from Purchases ─────────────────────────────────────────

export interface StockInParams {
  productId: string;
  branchId: string;
  qty: number;
  rate: number;
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  date?: Date;
  note?: string;
}

export async function stockIn(tx: any, p: StockInParams): Promise<void> {
  const existing = await tx.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  const oldQty     = existing?.qty     ?? 0;
  const oldAvgCost = existing?.avgCost ?? 0;
  const newQty     = oldQty + p.qty;

  // Weighted average cost calculation
  const newAvgCost = (oldQty > 0)
    ? (oldQty * oldAvgCost + p.qty * p.rate) / newQty
    : p.rate;

  await tx.inventory.upsert({
    where:  { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    update: { qty: newQty, avgCost: newAvgCost },
    create: { productId: p.productId, branchId: p.branchId, qty: p.qty, avgCost: p.rate },
  });

  await tx.stockMovement.create({
    data: {
      productId: p.productId,
      branchId:  p.branchId,
      type:      'PURCHASE',
      qty:       p.qty,
      refType:   p.refType ?? 'purchase',
      refId:     p.refId   ?? undefined,
      date:      p.date    ?? new Date(),
      note:      p.note    ?? (p.refNo
        ? `Stock IN — ${p.refNo} | Qty: ${p.qty} ${p.unit ?? 'KG'} @ Rs ${p.rate}`
        : `Stock IN | Qty: ${p.qty} ${p.unit ?? 'KG'} @ Rs ${p.rate}`),
    },
  });
}

// ── stockOut — called from Sales ─────────────────────────────────────────────

export interface StockOutParams {
  productId: string;
  branchId: string;
  qty: number;
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  date?: Date;
  note?: string;
}

export async function stockOut(tx: any, p: StockOutParams): Promise<void> {
  const db = tx || prisma;
  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    select: { qty: true },
  });

  const currentQty = existing?.qty ?? 0;
  const newQty = Math.max(0, currentQty - p.qty);

  await Promise.all([
    db.inventory.upsert({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
      update: { qty: newQty },
      create: { productId: p.productId, branchId: p.branchId, qty: 0, avgCost: 0 },
    }),
    db.stockMovement.create({
      data: {
        productId: p.productId,
        branchId:  p.branchId,
        type:      'SALE',
        qty:       -p.qty,
        refType:   p.refType ?? 'sale',
        refId:     p.refId   ?? undefined,
        date:      p.date    ?? new Date(),
        note:      p.note    ?? (p.refNo
          ? `Stock OUT — ${p.refNo} | Qty: ${p.qty} ${p.unit ?? 'KG'}`
          : `Stock OUT | Qty: ${p.qty} ${p.unit ?? 'KG'}`),
      },
    }),
  ]);
}

// ── recordWastage — called from Wastage entry ─────────────────────────────────

export interface WastageParams {
  productId?: string | null;
  itemName: string;
  branchId: string;
  qty: number;
  unit?: string;
  reason?: string;
  date?: Date;
}

export interface WastageResult {
  wastageId: string;
  refNo: string;
}

export async function recordWastage(tx: any, p: WastageParams): Promise<WastageResult> {
  const count = await tx.wastage.count();
  const refNo = `WST-${String(count + 1).padStart(4, '0')}`;

  const wastage = await tx.wastage.create({
    data: {
      productId: p.productId ?? undefined,
      itemName:  p.itemName,
      qty:       p.qty,
      unit:      (p.unit ?? 'KG') as any,
      reason:    p.reason ?? undefined,
      date:      p.date ?? new Date(),
      branchId:  p.branchId,
    },
  });

  if (p.productId) {
    const existing = await tx.inventory.findUnique({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    });

    const currentQty = existing?.qty ?? 0;
    const newQty = Math.max(0, currentQty - p.qty);

    if (existing) {
      await tx.inventory.update({
        where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
        data:  { qty: newQty },
      });
    } else {
      await tx.inventory.create({
        data: { productId: p.productId, branchId: p.branchId, qty: 0, avgCost: 0 },
      });
    }

    await tx.stockMovement.create({
      data: {
        productId: p.productId,
        branchId:  p.branchId,
        type:      'WASTAGE',
        qty:       -p.qty,
        refType:   'wastage',
        refId:     wastage.id,
        date:      p.date ?? new Date(),
        note:      `${refNo} | ${p.reason ?? 'Wastage recorded'} | Qty: ${p.qty} ${p.unit ?? 'KG'}`,
      },
    });
  }

  return { wastageId: wastage.id, refNo };
}

// ── manualAdjust — called from Manual Adjustment form ─────────────────────────

export interface AdjustParams {
  productId: string;
  branchId: string;
  systemQty: number;
  adjustedQty: number;
  reason?: string;
}

export interface AdjustResult {
  refNo: string;
  delta: number;
  previousQty: number;
  newQty: number;
}

export async function manualAdjust(tx: any, p: AdjustParams): Promise<AdjustResult> {
  const adjCount = await tx.stockMovement.count({ where: { type: 'ADJUSTMENT' } });
  const refNo = `ADJ-${String(adjCount + 1).padStart(4, '0')}`;
  const delta = p.adjustedQty - p.systemQty;

  const existing = await tx.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  if (existing) {
    await tx.inventory.update({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
      data:  { qty: Math.max(0, p.adjustedQty) },
    });
  } else {
    await tx.inventory.create({
      data: { productId: p.productId, branchId: p.branchId, qty: Math.max(0, p.adjustedQty), avgCost: 0 },
    });
  }

  await tx.stockMovement.create({
    data: {
      productId: p.productId,
      branchId:  p.branchId,
      type:      'ADJUSTMENT',
      qty:       delta,
      refType:   'adjustment',
      refId:     refNo,
      date:      new Date(),
      note:      `${refNo} | System: ${p.systemQty} → Physical: ${p.adjustedQty} (${delta >= 0 ? '+' : ''}${delta}) | ${p.reason ?? 'Manual adjustment'}`,
    },
  });

  return { refNo, delta, previousQty: p.systemQty, newQty: p.adjustedQty };
}

// ── stockReturn — called from Delivery Failures & Partial Customer Returns ────

export interface StockReturnParams {
  productId: string;
  branchId: string;
  qty: number;
  unit?: string;
  refType?: string;
  refId?: string;
  refNo?: string;
  reason?: string;
  date?: Date;
  note?: string;
}

export async function stockReturn(tx: any, p: StockReturnParams): Promise<void> {
  const db = tx || prisma;
  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    select: { qty: true },
  });

  const currentQty = existing?.qty ?? 0;
  const newQty = currentQty + p.qty;

  await Promise.all([
    db.inventory.upsert({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
      update: { qty: newQty },
      create: { productId: p.productId, branchId: p.branchId, qty: p.qty, avgCost: 0 },
    }),
    db.stockMovement.create({
      data: {
        productId: p.productId,
        branchId:  p.branchId,
        type:      'ADJUSTMENT',
        qty:       p.qty,
        refType:   p.refType ?? 'return',
        refId:     p.refId   ?? undefined,
        date:      p.date    ?? new Date(),
        note:      p.note    ?? (p.refNo
          ? `Stock Return — ${p.refNo} | Qty: +${p.qty} ${p.unit ?? 'KG'}${p.reason ? ` | ${p.reason}` : ''}`
          : `Stock Return | Qty: +${p.qty} ${p.unit ?? 'KG'}${p.reason ? ` | ${p.reason}` : ''}`),
      },
    }),
  ]);
}
