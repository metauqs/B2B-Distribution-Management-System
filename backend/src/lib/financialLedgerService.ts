import prisma from './prisma';

export interface FinancialLedgerEntryParams {
  branchId: string;
  date?: Date;
  transactionType: string;
  entryType: 'DEBIT' | 'CREDIT';
  accountCategory: 'REVENUE' | 'COGS' | 'ASSET_RECEIVABLE' | 'ASSET_CASH' | 'ASSET_INVENTORY' | 'LIABILITY_PAYABLE' | 'EXPENSE_OPERATING' | 'EXPENSE_WASTAGE' | 'DIRECT_COST';
  accountName: string;
  debit?: number;
  credit?: number;
  referenceType?: string;
  referenceId?: string;
  referenceNo?: string;
  entityId?: string;
  entityType?: string;
  notes?: string;
}

export async function createLedgerEntry(tx: any, p: FinancialLedgerEntryParams): Promise<void> {
  const db = tx || prisma;
  try {
    await db.financialLedger.create({
      data: {
        branchId: p.branchId,
        date: p.date ?? new Date(),
        transactionType: p.transactionType,
        entryType: p.entryType,
        accountCategory: p.accountCategory,
        accountName: p.accountName,
        debit: p.debit ?? 0,
        credit: p.credit ?? 0,
        referenceType: p.referenceType,
        referenceId: p.referenceId,
        referenceNo: p.referenceNo,
        entityId: p.entityId,
        entityType: p.entityType,
        notes: p.notes,
      },
    });
  } catch (err: any) {
    console.error('⚠️ [FinancialLedger] Failed to create ledger entry:', err.message);
  }
}

export async function createManyLedgerEntries(tx: any, entries: FinancialLedgerEntryParams[]): Promise<void> {
  const db = tx || prisma;
  if (!entries || entries.length === 0) return;
  try {
    await db.financialLedger.createMany({
      data: entries.map(p => ({
        branchId: p.branchId,
        date: p.date ?? new Date(),
        transactionType: p.transactionType,
        entryType: p.entryType,
        accountCategory: p.accountCategory,
        accountName: p.accountName,
        debit: p.debit ?? 0,
        credit: p.credit ?? 0,
        referenceType: p.referenceType,
        referenceId: p.referenceId,
        referenceNo: p.referenceNo,
        entityId: p.entityId,
        entityType: p.entityType,
        notes: p.notes,
      })),
    });
  } catch (err: any) {
    console.error('⚠️ [FinancialLedger] Failed to create bulk ledger entries:', err.message);
  }
}

export async function postSaleLedger(
  tx: any,
  params: {
    branchId: string;
    saleId: string;
    invoiceNo: string;
    clientId: string;
    date: Date;
    total: number;
    paid: number;
    cogs: number;
    deliveryCharge?: number;
  }
): Promise<void> {
  const { branchId, saleId, invoiceNo, clientId, date, total, paid, cogs } = params;

  const entries: FinancialLedgerEntryParams[] = [
    {
      branchId,
      date,
      transactionType: 'SALE_INVOICE',
      entryType: 'CREDIT',
      accountCategory: 'REVENUE',
      accountName: 'Sales Revenue',
      credit: total,
      referenceType: 'sale',
      referenceId: saleId,
      referenceNo: invoiceNo,
      entityId: clientId,
      entityType: 'client',
    }
  ];

  const creditBalance = total - paid;
  if (paid > 0) {
    entries.push({
      branchId,
      date,
      transactionType: 'SALE_INVOICE',
      entryType: 'DEBIT',
      accountCategory: 'ASSET_CASH',
      accountName: 'Cash / Bank Collection at Checkout',
      debit: paid,
      referenceType: 'sale',
      referenceId: saleId,
      referenceNo: invoiceNo,
      entityId: clientId,
      entityType: 'client',
    });
  }
  if (creditBalance > 0) {
    entries.push({
      branchId,
      date,
      transactionType: 'SALE_INVOICE',
      entryType: 'DEBIT',
      accountCategory: 'ASSET_RECEIVABLE',
      accountName: 'Accounts Receivable',
      debit: creditBalance,
      referenceType: 'sale',
      referenceId: saleId,
      referenceNo: invoiceNo,
      entityId: clientId,
      entityType: 'client',
    });
  }

  if (cogs > 0) {
    entries.push({
      branchId,
      date,
      transactionType: 'SALE_COGS',
      entryType: 'DEBIT',
      accountCategory: 'COGS',
      accountName: 'Cost of Goods Sold',
      debit: cogs,
      referenceType: 'sale',
      referenceId: saleId,
      referenceNo: invoiceNo,
      entityId: clientId,
      entityType: 'client',
    });
    entries.push({
      branchId,
      date,
      transactionType: 'SALE_COGS',
      entryType: 'CREDIT',
      accountCategory: 'ASSET_INVENTORY',
      accountName: 'Inventory Stock Asset',
      credit: cogs,
      referenceType: 'sale',
      referenceId: saleId,
      referenceNo: invoiceNo,
      entityId: clientId,
      entityType: 'client',
    });
  }

  await createManyLedgerEntries(tx, entries);
}

export async function postPurchaseLedger(
  tx: any,
  params: {
    branchId: string;
    purchaseId: string;
    supplierId: string;
    date: Date;
    subtotal: number;
    transportCost: number;
    total: number;
    paid: number;
  }
): Promise<void> {
  const { branchId, purchaseId, supplierId, date, subtotal, transportCost, total, paid } = params;

  // 1. Inventory Asset Addition (Debit Subtotal)
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'PURCHASE',
    entryType: 'DEBIT',
    accountCategory: 'ASSET_INVENTORY',
    accountName: 'Inventory Stock Asset',
    debit: subtotal,
    referenceType: 'purchase',
    referenceId: purchaseId,
    entityId: supplierId,
    entityType: 'supplier',
  });

  // 2. Direct Freight/Transport Cost (Debit Transport Cost)
  if (transportCost > 0) {
    await createLedgerEntry(tx, {
      branchId,
      date,
      transactionType: 'PURCHASE_TRANSPORT',
      entryType: 'DEBIT',
      accountCategory: 'DIRECT_COST',
      accountName: 'Purchase Freight & Mandi Transport',
      debit: transportCost,
      referenceType: 'purchase',
      referenceId: purchaseId,
      entityId: supplierId,
      entityType: 'supplier',
    });
  }

  // 3. Credit Cash / Payable
  const unpaid = total - paid;
  if (paid > 0) {
    await createLedgerEntry(tx, {
      branchId,
      date,
      transactionType: 'PURCHASE',
      entryType: 'CREDIT',
      accountCategory: 'ASSET_CASH',
      accountName: 'Cash Payment for Purchase',
      credit: paid,
      referenceType: 'purchase',
      referenceId: purchaseId,
      entityId: supplierId,
      entityType: 'supplier',
    });
  }
  if (unpaid > 0) {
    await createLedgerEntry(tx, {
      branchId,
      date,
      transactionType: 'PURCHASE',
      entryType: 'CREDIT',
      accountCategory: 'LIABILITY_PAYABLE',
      accountName: 'Accounts Payable - Supplier',
      credit: unpaid,
      referenceType: 'purchase',
      referenceId: purchaseId,
      entityId: supplierId,
      entityType: 'supplier',
    });
  }
}

export async function postCollectionLedger(
  tx: any,
  params: {
    branchId: string;
    collectionId: string;
    clientId: string;
    date: Date;
    amount: number;
    method: string;
    reference?: string;
  }
): Promise<void> {
  const { branchId, collectionId, clientId, date, amount, method, reference } = params;

  // Debit Cash / Bank Account
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'COLLECTION',
    entryType: 'DEBIT',
    accountCategory: 'ASSET_CASH',
    accountName: `Collection (${method})`,
    debit: amount,
    referenceType: 'collection',
    referenceId: collectionId,
    referenceNo: reference,
    entityId: clientId,
    entityType: 'client',
  });

  // Credit Accounts Receivable
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'COLLECTION',
    entryType: 'CREDIT',
    accountCategory: 'ASSET_RECEIVABLE',
    accountName: 'Accounts Receivable',
    credit: amount,
    referenceType: 'collection',
    referenceId: collectionId,
    referenceNo: reference,
    entityId: clientId,
    entityType: 'client',
  });
}

export async function postCollectionCancellationLedger(
  tx: any,
  params: {
    branchId: string;
    collectionId: string;
    clientId: string;
    date: Date;
    amount: number;
    method: string;
    reference?: string;
    reason?: string;
  }
): Promise<void> {
  const { branchId, collectionId, clientId, date, amount, method, reference, reason } = params;

  // Credit Cash / Bank Account (Reversing the cash collection intake)
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'COLLECTION_CANCELLATION',
    entryType: 'CREDIT',
    accountCategory: 'ASSET_CASH',
    accountName: `Collection Cancelled (${method})`,
    credit: amount,
    referenceType: 'collection',
    referenceId: collectionId,
    referenceNo: reference,
    entityId: clientId,
    entityType: 'client',
    notes: reason || 'Collection payment cancelled',
  });

  // Debit Accounts Receivable (Reinstating the customer receivable balance)
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'COLLECTION_CANCELLATION',
    entryType: 'DEBIT',
    accountCategory: 'ASSET_RECEIVABLE',
    accountName: 'Accounts Receivable',
    debit: amount,
    referenceType: 'collection',
    referenceId: collectionId,
    referenceNo: reference,
    entityId: clientId,
    entityType: 'client',
    notes: reason || 'Collection payment cancelled',
  });
}

export async function postExpenseLedger(
  tx: any,
  params: {
    branchId: string;
    expenseId: string;
    category: string;
    date: Date;
    amount: number;
    paidBy?: string;
    supplierId?: string;
    employeeId?: string;
    vehicleId?: string;
    reference?: string;
  }
): Promise<void> {
  const { branchId, expenseId, category, date, amount, paidBy, supplierId, employeeId, vehicleId, reference } = params;

  // Debit Operating Expense
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'EXPENSE',
    entryType: 'DEBIT',
    accountCategory: 'EXPENSE_OPERATING',
    accountName: `Expense - ${category}`,
    debit: amount,
    referenceType: 'expense',
    referenceId: expenseId,
    referenceNo: reference,
    entityId: supplierId || employeeId || vehicleId,
    entityType: supplierId ? 'supplier' : employeeId ? 'employee' : vehicleId ? 'vehicle' : undefined,
  });

  // Credit Cash/Bank Asset
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'EXPENSE',
    entryType: 'CREDIT',
    accountCategory: 'ASSET_CASH',
    accountName: `Cash/Bank Outflow (${paidBy || 'CASH'})`,
    credit: amount,
    referenceType: 'expense',
    referenceId: expenseId,
    referenceNo: reference,
  });
}

export async function postWastageLedger(
  tx: any,
  params: {
    branchId: string;
    wastageId: string;
    productId?: string;
    itemName: string;
    qty: number;
    rate: number;
    date: Date;
  }
): Promise<void> {
  const { branchId, wastageId, productId, itemName, qty, rate, date } = params;
  const wastageValue = qty * rate;
  if (wastageValue <= 0) return;

  // Debit Wastage Expense
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'WASTAGE',
    entryType: 'DEBIT',
    accountCategory: 'EXPENSE_WASTAGE',
    accountName: `Wastage Loss - ${itemName}`,
    debit: wastageValue,
    referenceType: 'wastage',
    referenceId: wastageId,
    entityId: productId,
    entityType: 'product',
  });

  // Credit Inventory Asset
  await createLedgerEntry(tx, {
    branchId,
    date,
    transactionType: 'WASTAGE',
    entryType: 'CREDIT',
    accountCategory: 'ASSET_INVENTORY',
    accountName: 'Inventory Stock Asset',
    credit: wastageValue,
    referenceType: 'wastage',
    referenceId: wastageId,
    entityId: productId,
    entityType: 'product',
  });
}
