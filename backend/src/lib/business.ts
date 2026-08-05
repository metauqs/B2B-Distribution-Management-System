import prisma from './prisma';

// ─── Write an audit log entry ─────────────────────────────────────────────────

interface AuditParams {
  userId?:   string;
  branchId?: string;
  action:    'CREATE' | 'UPDATE' | 'DELETE';
  entity:    string;
  entityId?: string;
  oldData?:  object;
  newData?:  object;
  ip?:       string;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId:    params.userId,
        branchId:  params.branchId,
        action:    params.action,
        entity:    params.entity,
        entityId:  params.entityId,
        oldData:   params.oldData   as any,
        newData:   params.newData   as any,
        ipAddress: params.ip,
      },
    });
  } catch (err) {
    // Audit failure should not break main flow
    console.error('[audit]', err);
  }
}
// ─── Verify user existence to prevent FK constraint violations ─────────────────
export async function getValidUserId(userId: string | null | undefined, tx?: any): Promise<string | undefined> {
  if (!userId) return undefined;
  const db = tx || prisma;
  try {
    const user = await db.user.findUnique({
      where: { id: userId, deletedAt: null },
      select: { id: true }
    });
    return user ? user.id : undefined;
  } catch (err) {
    console.error('[verifyUser]', err);
    return undefined;
  }
}

// ─── Generate invoice number ──────────────────────────────────────────────────

export async function generateInvoiceNo(clientId: string, branchId?: string, tx?: any): Promise<string> {
  const db = tx || prisma;

  if (!clientId) {
    const totalCount = await db.sale.count();
    return `IN-0000-${String(totalCount + 1).padStart(4, '0')}`;
  }

  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true, clientId: true },
  });

  const rawCode = client?.clientId || clientId.slice(-4).toUpperCase();
  // Strip 'WH-' prefix for Option 2 (e.g. 'WH-1111' -> '1111')
  const clientCode = rawCode.replace(/^WH-/i, '').trim();

  // Find all existing sales for this specific client to calculate next incremental sequence
  const existingSales = await db.sale.findMany({
    where: { clientId },
    select: { invoiceNo: true },
  });

  let maxSeq = 0;
  for (const s of existingSales) {
    if (s.invoiceNo) {
      // Escape special characters in clientCode
      const escapedCode = clientCode.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Match IN-1111-0001, IN-WH-1111-0001, IN-0001
      const regex = new RegExp(`(?:IN-${escapedCode}-|IN-WH-${escapedCode}-|IN-|INV-)(\\d{1,5})$`, 'i');
      const match = s.invoiceNo.match(regex);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (!isNaN(seq) && seq < 10000 && seq > maxSeq) {
          maxSeq = seq;
        }
      }
    }
  }

  // Default starting sequence count if no cleanly formatted invoice exists
  if (maxSeq === 0) {
    maxSeq = existingSales.length;
  }

  const nextSeq = maxSeq + 1;
  const paddedSeq = String(nextSeq).padStart(4, '0');

  // Option 2 Format: IN-{PhoneDigits}-{Sequence} (e.g. IN-1111-0001, IN-1111-0002)
  return `IN-${clientCode}-${paddedSeq}`;
}

// ─── Generate client ID ──────────────────────────────────────────────────────

export async function generateClientId(whatsappOrPhone: string | null, tx?: any): Promise<string> {
  const db = tx || prisma;
  const cleanNum = (whatsappOrPhone || '').replace(/\D/g, '');

  if (cleanNum.length >= 4) {
    // Use last 4 digits of phone/WhatsApp as the base ID (e.g. WH-1234)
    const last4 = cleanNum.slice(-4);
    const baseId = `WH-${last4}`;

    let clientId = baseId;
    let attempt = 0;
    while (true) {
      const existing = await db.client.findFirst({ where: { clientId } });
      if (!existing) break;
      attempt++;
      clientId = `${baseId}-${attempt}`;
    }
    return clientId;
  } else {
    // No phone number — assign next available sequential WH-NNNN (WH-0001, WH-0002 …)
    // Find all existing sequential IDs and pick the next one
    const allIds = await db.client.findMany({
      where: { clientId: { startsWith: 'WH-0' } },
      select: { clientId: true },
    });
    const usedNums = new Set(
      allIds
        .map((c: { clientId: string | null }) => {
          const m = c.clientId?.match(/^WH-(\d{4})$/);
          return m ? parseInt(m[1], 10) : null;
        })
        .filter((n: number | null): n is number => n !== null)
    );
    let next = 1;
    while (usedNums.has(next)) next++;
    return `WH-${String(next).padStart(4, '0')}`;
  }
}

// ─── Customer Ledger & Client Balance Engine ─────────────────────────────────

export interface LedgerEntryParams {
  clientId:     string;
  branchId:     string;
  type:         'INVOICE' | 'PAYMENT' | 'ADJUSTMENT' | 'DEBIT_NOTE' | 'CREDIT_NOTE';
  date?:        Date;
  referenceId?: string;
  referenceNo?: string;
  description?: string;
  debit:        number;
  credit:       number;
}

export async function recordCustomerLedgerEntry(
  tx: any,
  params: LedgerEntryParams
): Promise<{ ledger: any; balance: number }> {
  const db = tx || prisma;
  const entryDate = params.date ? new Date(params.date) : new Date(Date.now() - 5 * 60 * 60 * 1000);

  // 1. Fetch predecessor ledger entry (latest chronological entry BEFORE the new entry's date)
  const predecessor = await db.customerLedger.findFirst({
    where: {
      clientId: params.clientId,
      OR: [
        { date: { lt: entryDate } },
        {
          date: entryDate,
          createdAt: { lt: new Date() } // Fallback for same-day sorting order
        }
      ]
    },
    orderBy: [
      { date: 'desc' },
      { createdAt: 'desc' }
    ],
    select: { balance: true }
  });

  let previousBalance = 0;
  if (predecessor) {
    previousBalance = predecessor.balance;
  } else {
    // Fallback to client openingBalance if no ledger entry exists yet
    const client = await db.client.findUnique({
      where: { id: params.clientId },
      select: { openingBalance: true }
    });
    previousBalance = client?.openingBalance ?? 0;
  }

  const debitAmt  = Number(params.debit || 0);
  const creditAmt = Number(params.credit || 0);
  const newBalance = previousBalance + debitAmt - creditAmt;

  // 2. Insert CustomerLedger row
  const ledger = await db.customerLedger.create({
    data: {
      clientId:    params.clientId,
      branchId:    params.branchId,
      type:        params.type,
      date:        entryDate,
      referenceId: params.referenceId,
      referenceNo: params.referenceNo,
      description: params.description,
      debit:       debitAmt,
      credit:      creditAmt,
      balance:     newBalance,
    }
  });

  // 3. Recalculate and update all subsequent ledger entries to maintain running balance integrity
  const subsequentEntries = await db.customerLedger.findMany({
    where: {
      clientId: params.clientId,
      id: { not: ledger.id },
      OR: [
        { date: { gt: entryDate } },
        {
          date: entryDate,
          createdAt: { gt: ledger.createdAt }
        }
      ]
    },
    orderBy: [
      { date: 'asc' },
      { createdAt: 'asc' }
    ]
  });

  let currentRunning = newBalance;
  for (const sub of subsequentEntries) {
    currentRunning = currentRunning + sub.debit - sub.credit;
    await db.customerLedger.update({
      where: { id: sub.id },
      data: { balance: currentRunning }
    });
  }

  // 4. Keep Client.currentBalance 100% in sync with the final running balance of the chronologically latest entry
  await db.client.update({
    where: { id: params.clientId },
    data:  { currentBalance: currentRunning }
  });

  return { ledger, balance: newBalance };
}

export async function getClientBalance(clientId: string, tx?: any): Promise<number> {
  const db = tx || prisma;
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { currentBalance: true, openingBalance: true }
  });
  if (!client) return 0;
  
  const lastLedger = await db.customerLedger.findFirst({
    where: { clientId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: { balance: true }
  });

  return lastLedger ? lastLedger.balance : client.currentBalance;
}

// ─── Update inventory (used in sales & purchases) ─────────────────────────────

export async function adjustInventory(
  productId: string,
  branchId:  string,
  deltaQty:  number,       // positive = add, negative = deduct
  newRate?:  number,       // for purchases: update avg cost
): Promise<void> {
  const existing = await prisma.inventory.findUnique({
    where: { productId_branchId: { productId, branchId } },
  });

  if (!existing) {
    await prisma.inventory.create({
      data: {
        productId,
        branchId,
        qty:     Math.max(0, deltaQty),
        avgCost: newRate ?? 0,
      },
    });
    return;
  }

  let newAvgCost = existing.avgCost;
  if (newRate && deltaQty > 0) {
    // Weighted average cost for purchases
    const totalQty  = existing.qty + deltaQty;
    newAvgCost = totalQty > 0
      ? (existing.qty * existing.avgCost + deltaQty * newRate) / totalQty
      : newRate;
  }

  await prisma.inventory.update({
    where: { productId_branchId: { productId, branchId } },
    data: {
      qty:     { increment: deltaQty },
      avgCost: newAvgCost,
    },
  });
}
// ─── Sync today's Price List buy rates from a Purchase (transaction-aware) ─────
//
// Rules:
//  1. Finds or creates the PriceList for (date, branchId).
//  2. For each item WITH a productId:
//     - Looks up the PriceItem by (priceListId, productId) — FK-based dedup.
//     - If found  → updates ONLY buyRate (never touches sellRate).
//     - If missing → creates new PriceItem with sellRate = 0.
//  3. For each item WITHOUT a productId (free-text items):
//     - Falls back to (priceListId, itemName) lookup.
//     - Same update/create logic.
// The function is idempotent: calling it multiple times with the same data
// (e.g., two purchases of the same product in one day) is safe.

export interface PurchaseItemForSync {
  productId?: string | null;
  itemName:   string;
  unit:       string;
  rate:       number;
}

export async function syncPriceListFromPurchase(
  tx:          any,
  branchId:    string,
  userId:      string | null | undefined,
  purchaseDate: Date,
  items:       PurchaseItemForSync[],
): Promise<string> {
  // Inventory is now the Single Source of Truth for Buy Prices and Stock.
  // Purchase updates Inventory directly. Price List loads rates from Inventory.
  return '';
}

export interface SaleItemForSync {
  productId?: string | null;
  itemName:   string;
  unit:       string;
  rate:       number;
}

export async function syncPriceListFromSale(
  tx:       any,
  branchId: string,
  userId:   string | null | undefined,
  saleDate: Date,
  items:    SaleItemForSync[],
): Promise<string> {
  // Sales consume stock directly from Inventory and do not mutate Price List.
  return '';
}
