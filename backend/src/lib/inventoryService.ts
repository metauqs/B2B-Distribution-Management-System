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
import { postWastageLedger } from './financialLedgerService';

/**
 * Single Source of Truth Inventory Recalculation Engine
 * 
 * Recomputes Inventory.qty directly from the sum of all recorded StockMovements
 * for the product and branch. Guaranteed 100% mathematical consistency.
 */
export async function recalculateProductStock(
  tx: any,
  productId: string,
  branchId: string
): Promise<number> {
  const db = tx || prisma;

  const smList = await db.stockMovement.findMany({
    where: { productId, branchId },
    orderBy: [{ createdAt: 'asc' }, { date: 'asc' }],
    select: { qty: true, type: true, refType: true, newStock: true },
  });

  if (smList.length === 0) return 0;

  // Find the latest physical count adjustment or admin reset movement
  let lastBaselineIdx = -1;
  for (let i = smList.length - 1; i >= 0; i--) {
    const m = smList[i];
    const isBaseline =
      m.refType === 'admin_reset' ||
      m.refType === 'manual_adjust' ||
      m.type === 'OPENING';
    if (isBaseline) {
      lastBaselineIdx = i;
      break;
    }
  }

  let exactStock = 0;
  if (lastBaselineIdx !== -1) {
    const baselineMove = smList[lastBaselineIdx];
    const baselineQty = Math.max(0, Number(baselineMove.newStock || 0));
    const subsequentSum = smList.slice(lastBaselineIdx + 1).reduce((sum: number, m: any) => sum + Number(m.qty || 0), 0);
    exactStock = Math.max(0, Math.round((baselineQty + subsequentSum) * 1000) / 1000);
  } else {
    const sumAll = smList.reduce((sum: number, m: any) => sum + Number(m.qty || 0), 0);
    exactStock = Math.max(0, Math.round(sumAll * 1000) / 1000);
  }

  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
    select: { avgCost: true },
  });

  const avgCost = exactStock <= 0 ? 0 : (existing?.avgCost ?? 0);

  await db.inventory.upsert({
    where: { productId_branchId: { productId, branchId } },
    update: { qty: exactStock, avgCost },
    create: { productId, branchId, qty: exactStock, avgCost: 0 },
  });

  return exactStock;
}

// ── 0. recalcAvgCostFromHistory — Recomputes avgCost from StockMovements ──────
//
// Called after a Purchase is EDITED or DELETED to ensure avgCost stays accurate.
// Replays all purchase stock movements chronologically using weighted average cost.
// Only updates avgCost — never modifies qty (that is already handled by the caller).

export async function recalcAvgCostFromHistory(
  tx: any,
  productId: string,
  branchId: string,
): Promise<void> {
  const db = tx || prisma;

  // Fetch current inventory stock level
  const currentInv = await db.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
    select: { qty: true },
  });

  // If current stock is 0 or negative, reset avgCost to 0 immediately
  if (!currentInv || currentInv.qty <= 0) {
    await db.inventory.updateMany({
      where: { productId, branchId },
      data: { avgCost: 0 },
    });
    return;
  }

  // Find the timestamp of the latest zero-stock reset (if any)
  const latestZeroStockMove = await db.stockMovement.findFirst({
    where: {
      productId,
      branchId,
      newStock: 0,
    },
    orderBy: [{ createdAt: 'desc' }, { date: 'desc' }],
    select: { createdAt: true, date: true },
  });

  const resetDate = latestZeroStockMove ? (latestZeroStockMove.createdAt ?? latestZeroStockMove.date) : null;

  // Fetch all PURCHASE price history for this product since the latest zero-stock reset
  const purchaseMoves = await db.purchasePriceHistory.findMany({
    where: {
      productId,
      branchId,
      ...(resetDate ? { createdAt: { gte: resetDate } } : {}),
      OR: [
        { purchaseId: null },
        {
          purchase: { deletedAt: null },
        },
      ],
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { qty: true, buyPrice: true, purchaseId: true },
  });

  if (purchaseMoves.length === 0) {
    // If no purchase history after reset, fallback to currentBuyPrice
    const invRecord = await db.inventory.findUnique({
      where: { productId_branchId: { productId, branchId } },
      select: { currentBuyPrice: true }
    });
    const fallbackCost = invRecord?.currentBuyPrice && invRecord.currentBuyPrice > 0 ? invRecord.currentBuyPrice : 0;
    await db.inventory.updateMany({
      where: { productId, branchId },
      data: { avgCost: fallbackCost },
    });
    return;
  }

  // Replay moving weighted average cost chronologically
  let runningQty = 0;
  let runningAvg = 0;

  for (const move of purchaseMoves) {
    const q = move.qty;
    const r = move.buyPrice;
    if (q <= 0 || r <= 0) continue;

    if (runningQty <= 0 || runningAvg <= 0) {
      runningAvg = r;
    } else {
      const totalQty = runningQty + q;
      runningAvg = totalQty > 0
        ? ((runningQty * runningAvg) + (q * r)) / totalQty
        : r;
    }
    runningQty = runningQty + q;
  }

  if (runningAvg > 0) {
    await db.inventory.updateMany({
      where: { productId, branchId },
      data: { avgCost: runningAvg },
    });
  }
}


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

  // Idempotency Check: Prevent duplicate StockMovement for the same purchase/transaction
  if (p.refType && p.refId) {
    const existingMovement = await db.stockMovement.findFirst({
      where: {
        productId: p.productId,
        branchId: p.branchId,
        refType: p.refType,
        refId: p.refId,
        type: 'PURCHASE',
      }
    });
    if (existingMovement) {
      console.log(`[stockIn] Movement already logged for ${p.refType}:${p.refId} product ${p.productId}. Skipping duplicate.`);
      return;
    }
  }

  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  const oldQty = Math.max(0, existing?.qty ?? 0);
  const oldAvgCost = (existing?.avgCost && existing.avgCost > 0) ? existing.avgCost : 0;

  const newQty = oldQty + p.qty;

  // Moving Weighted Average Cost & Zero-Stock Cost Reset Rule:
  // IF CURRENT STOCK <= 0 (or oldAvgCost <= 0):
  //   New Average Cost = Today's Purchase Unit Price (p.rate)
  // IF CURRENT STOCK > 0:
  //   New Average Cost = ( (oldQty * oldAvgCost) + (p.qty * p.rate) ) / (oldQty + p.qty)
  let newAvgCost: number;

  if (oldQty <= 0 || oldAvgCost <= 0) {
    newAvgCost = p.rate;
  } else {
    const existingValue = oldQty * oldAvgCost;
    const purchaseValue = p.qty * p.rate;
    newAvgCost = newQty > 0 ? (existingValue + purchaseValue) / newQty : p.rate;
  }

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

  let validPurchaseId: string | undefined = p.purchaseId ?? undefined;
  if (!validPurchaseId && p.refType === 'purchase' && p.refId) {
    const pExists = await db.purchase.findUnique({ where: { id: p.refId }, select: { id: true } });
    if (pExists) validPurchaseId = pExists.id;
  }

  // Record Purchase Price History log
  await db.purchasePriceHistory.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      purchaseId: validPurchaseId,
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

  // Idempotency Check: Prevent duplicate StockMovement for the same sale/checkout.
  // IMPORTANT: refType is included in the filter so that 'sale' and 'sale_edit'
  // are treated as separate idempotency domains — an edit-increase on the same
  // saleId must not be blocked by the original 'sale' movement.
  if (p.refType && p.refId) {
    const existingMovement = await db.stockMovement.findFirst({
      where: {
        productId: p.productId,
        branchId: p.branchId,
        refType: p.refType,   // 'sale' vs 'sale_edit' are distinct domains
        refId: p.refId,
        type: 'SALE',
      }
    });
    if (existingMovement) {
      console.log(`[stockOut] Movement already logged for ${p.refType}:${p.refId} product ${p.productId}. Skipping duplicate.`);
      return;
    }
  }

  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    select: { qty: true, avgCost: true, reservedQty: true },
  });

  const oldQty = existing?.qty ?? 0;
  const newQty = Math.max(0, oldQty - p.qty);
  // Zero-Stock Cost Reset Rule: When stock reaches zero or less, reset avgCost to 0 immediately
  const newAvgCost = newQty <= 0 ? 0 : (existing?.avgCost ?? 0);

  await db.inventory.upsert({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
    update: { qty: newQty, avgCost: newAvgCost },
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

// ── 2b. syncInvoiceEditStock — Difference-Based Invoice Edit Engine ─────────────

export interface InvoiceEditItemSync {
  productId?: string | null;
  itemName: string;
  qty: number;
  unit?: string;
}

export async function syncInvoiceEditStock(
  tx: any,
  params: {
    saleId: string;
    invoiceNo: string;
    branchId: string;
    userId?: string;
    oldItems: InvoiceEditItemSync[];
    newItems: InvoiceEditItemSync[];
  }
): Promise<void> {
  const db = tx || prisma;
  const { saleId, invoiceNo, branchId, userId, oldItems, newItems } = params;

  // Helper to normalize and resolve productId
  const resolveProductId = async (item: InvoiceEditItemSync): Promise<string | null> => {
    if (item.productId && item.productId.trim()) return item.productId.trim();
    if (item.itemName && item.itemName.trim()) {
      const prod = await db.product.findFirst({
        where: {
          name: { equals: item.itemName.trim(), mode: 'insensitive' }
        },
        select: { id: true }
      });
      if (prod) return prod.id;
    }
    return null;
  };

  // Group and sum old finalized quantities by productId
  const oldMap = new Map<string, { productId: string; itemName: string; unit: string; qty: number }>();
  for (const item of oldItems) {
    const pid = await resolveProductId(item);
    if (!pid) continue;
    const existing = oldMap.get(pid);
    if (existing) {
      existing.qty += Number(item.qty);
    } else {
      oldMap.set(pid, {
        productId: pid,
        itemName: item.itemName,
        unit: item.unit || 'KG',
        qty: Number(item.qty),
      });
    }
  }

  // Group and sum new quantities by productId
  const newMap = new Map<string, { productId: string; itemName: string; unit: string; qty: number }>();
  for (const item of newItems) {
    const pid = await resolveProductId(item);
    if (!pid) continue;
    const existing = newMap.get(pid);
    if (existing) {
      existing.qty += Number(item.qty);
    } else {
      newMap.set(pid, {
        productId: pid,
        itemName: item.itemName,
        unit: item.unit || 'KG',
        qty: Number(item.qty),
      });
    }
  }

  const allProductIds = new Set<string>([...oldMap.keys(), ...newMap.keys()]);

  for (const productId of allProductIds) {
    const oldEntry = oldMap.get(productId);
    const newEntry = newMap.get(productId);

    const oldQty = oldEntry ? oldEntry.qty : 0;
    const newQty = newEntry ? newEntry.qty : 0;
    const delta = newQty - oldQty; // positive = quantity increased (deduct stock), negative = quantity decreased (restore stock)

    if (Math.abs(delta) < 0.0001) continue; // Case A: No change — 0 inventory movement

    const unit = newEntry?.unit || oldEntry?.unit || 'KG';
    const itemName = newEntry?.itemName || oldEntry?.itemName || 'Item';

    const existing = await db.inventory.findUnique({
      where: { productId_branchId: { productId, branchId } },
      select: { qty: true, avgCost: true, reservedQty: true }
    });

    const currentQty = existing?.qty ?? 0;
    const reserved = existing?.reservedQty ?? 0;
    const available = Math.max(0, currentQty - reserved);

    if (delta > 0) {
      // Case B / C / F: Quantity INCREASED or NEW product added — system must deduct delta from stock
      if (delta > available) {
        throw new Error(`Insufficient inventory stock for ${itemName}. Available: ${available} ${unit}, Additional Required: ${delta} ${unit}`);
      }

      const finalQty = Math.max(0, currentQty - delta);
      const finalAvgCost = finalQty <= 0 ? 0 : (existing?.avgCost ?? 0);

      await db.inventory.upsert({
        where: { productId_branchId: { productId, branchId } },
        update: { qty: finalQty, avgCost: finalAvgCost },
        create: { productId, branchId, qty: 0, avgCost: 0 }
      });

      await db.stockMovement.create({
        data: {
          productId,
          branchId,
          type: 'SALE',
          qty: -delta,
          previousStock: currentQty,
          newStock: finalQty,
          refType: 'sale_edit',           // standardized: deduction from invoice edit
          refId: saleId,
          userId: userId ?? undefined,
          date: new Date(),
          note: `Invoice Edit Stock Out — ${invoiceNo} | Qty: ${oldQty} → ${newQty} (−${delta} ${unit})`,
        }
      });
    } else {
      // Case D / E / F: Quantity DECREASED or item removed — system must restore Math.abs(delta) to stock
      const restoreQty = Math.abs(delta);
      const finalQty = currentQty + restoreQty;

      await db.inventory.upsert({
        where: { productId_branchId: { productId, branchId } },
        update: { qty: finalQty },
        create: { productId, branchId, qty: restoreQty, avgCost: 0 }
      });

      await db.stockMovement.create({
        data: {
          productId,
          branchId,
          type: 'ADJUSTMENT',
          qty: restoreQty,
          previousStock: currentQty,
          newStock: finalQty,
          refType: 'sale_edit_restore',   // standardized: restoration from invoice edit
          refId: saleId,
          userId: userId ?? undefined,
          date: new Date(),
          note: `Invoice Edit Stock Restore — ${invoiceNo} | Qty: ${oldQty} → ${newQty} (+${restoreQty} ${unit})`,
        }
      });
    }
  }
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
    // Zero-Stock Cost Reset Rule: When stock reaches zero or less, reset avgCost to 0 immediately
    const newAvgCost = newQty <= 0 ? 0 : (existing?.avgCost ?? 0);

    if (existing) {
      await db.inventory.update({
        where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
        data: { qty: newQty, avgCost: newAvgCost },
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

    await postWastageLedger(db, {
      branchId: p.branchId,
      wastageId: wastage.id,
      productId: p.productId,
      itemName: p.itemName,
      qty: p.qty,
      rate: existing?.avgCost && existing.avgCost > 0 ? existing.avgCost : (existing?.currentBuyPrice ?? 0),
      date: p.date ?? new Date(),
    });
  }

  return { wastageId: wastage.id, refNo };
}

// ── 4. manualAdjust — Called from Manual Stock Adjustment Form ──────────────────

export interface AdjustParams {
  productId: string;
  branchId: string;
  systemQty: number;
  adjustedQty: number; // For SET/OPENING: final count; For INCREASE/DECREASE/WASTAGE/DAMAGE/SUPPLIER_RETURN: adjustment amount
  adjustmentType?: 'SET' | 'INCREASE' | 'DECREASE' | 'WASTAGE' | 'DAMAGE' | 'SUPPLIER_RETURN' | 'OPENING';
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
  const adjCount = await db.stockMovement.count();
  const refNo = `ADJ-${String(adjCount + 1).padStart(4, '0')}`;

  const existing = await db.inventory.findUnique({
    where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
  });

  const previousQty = existing?.qty ?? p.systemQty;
  let newQty = previousQty;
  let moveType: 'ADJUSTMENT' | 'WASTAGE' | 'TRANSFER_OUT' | 'OPENING' = 'ADJUSTMENT';

  const adjType = p.adjustmentType ?? 'SET';
  if (adjType === 'INCREASE') {
    newQty = previousQty + Math.abs(p.adjustedQty);
    moveType = 'ADJUSTMENT';
  } else if (adjType === 'DECREASE') {
    newQty = Math.max(0, previousQty - Math.abs(p.adjustedQty));
    moveType = 'ADJUSTMENT';
  } else if (adjType === 'WASTAGE') {
    newQty = Math.max(0, previousQty - Math.abs(p.adjustedQty));
    moveType = 'WASTAGE';
  } else if (adjType === 'DAMAGE') {
    newQty = Math.max(0, previousQty - Math.abs(p.adjustedQty));
    moveType = 'WASTAGE';
  } else if (adjType === 'SUPPLIER_RETURN') {
    newQty = Math.max(0, previousQty - Math.abs(p.adjustedQty));
    moveType = 'TRANSFER_OUT';
  } else if (adjType === 'OPENING') {
    newQty = Math.max(0, p.adjustedQty);
    moveType = 'OPENING';
  } else {
    // SET physical count
    newQty = Math.max(0, p.adjustedQty);
    moveType = 'ADJUSTMENT';
  }

  const delta = newQty - previousQty;
  const modeLabels: Record<string, string> = {
    SET: 'Physical Count Correction',
    INCREASE: 'Stock Increase',
    DECREASE: 'Stock Reduction',
    WASTAGE: 'Recorded Wastage',
    DAMAGE: 'Recorded Damaged Stock',
    SUPPLIER_RETURN: 'Supplier Return',
    OPENING: 'Opening Balance Correction',
  };
  const modeTitle = modeLabels[adjType] ?? 'Stock Adjustment';
  const reasonText = [p.reason, p.remarks].filter(Boolean).join(' - ') || modeTitle;

  // Zero-Stock Cost Reset Rule: When stock reaches zero or less, reset avgCost to 0 immediately
  const newAvgCost = newQty <= 0 ? 0 : (existing?.avgCost ?? 0);

  if (existing) {
    await db.inventory.update({
      where: { productId_branchId: { productId: p.productId, branchId: p.branchId } },
      data: { qty: newQty, avgCost: newAvgCost },
    });
  } else {
    await db.inventory.create({
      data: { productId: p.productId, branchId: p.branchId, qty: newQty, avgCost: newAvgCost },
    });
  }

  await db.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      type: moveType,
      qty: delta,
      previousStock: previousQty,
      newStock: newQty,
      refType: 'adjustment',
      refId: refNo,
      userId: p.userId ?? undefined,
      date: new Date(),
      note: `${refNo} | [${modeTitle}] Stock: ${previousQty} → ${newQty} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)}) | ${reasonText}`,
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

  // Idempotency Check: Prevent double-restoration on network retries or repeated
  // failed-delivery calls. A return movement with the same refType+refId+productId
  // should only ever be recorded once.
  if (p.refType && p.refId) {
    const existingReturn = await db.stockMovement.findFirst({
      where: {
        productId: p.productId,
        branchId: p.branchId,
        refType: p.refType,
        refId: p.refId,
        qty: { gt: 0 },
      }
    });
    if (existingReturn) {
      console.log(`[stockReturn] Return already logged for ${p.refType}:${p.refId} product ${p.productId}. Skipping duplicate.`);
      return;
    }
  }

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
