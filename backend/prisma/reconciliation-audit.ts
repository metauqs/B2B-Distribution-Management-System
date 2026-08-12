import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const prisma = (await import('../src/lib/prisma')).default;
  const color = (s: string) => s;
  const chalk = {
    green: color,
    red: color,
    yellow: color,
    blue: color,
    bold: Object.assign(color, {
      blue: color,
      green: color,
      red: color,
      yellow: color,
    }),
  };

  console.log('\n======================================================');
  console.log('       COMPREHENSIVE DATABASE RECONCILIATION AUDIT      ');
  console.log('======================================================\n');

  try {
    // ---------------------------------------------------------
    // 1. Record Counts
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('1. RECORD COUNTS'));
    const tables = [
      'client', 'product', 'supplier', 'sale', 'saleItem', 
      'purchase', 'purchaseItem', 'collection', 'collectionAllocation', 
      'delivery', 'inventory', 'stockMovement', 'customerLedger', 
      'supplierLedger', 'financialLedger', 'expense', 'wastage', 
      'employee', 'user', 'branch'
    ];
    
    const counts: Record<string, number> = {};
    for (const table of tables) {
      if (prisma[table]) {
        counts[table] = await prisma[table].count();
      }
    }
    
    for (const [table, count] of Object.entries(counts)) {
      console.log(`- ${table.charAt(0).toUpperCase() + table.slice(1)}: ${count}`);
    }
    console.log();

    // ---------------------------------------------------------
    // 2. Client Balance Verification
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('2. CLIENT BALANCE VERIFICATION'));
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, openingBalance: true, currentBalance: true }
    });

    let clientMismatches = 0;
    for (const client of clients) {
      const latestLedger = await prisma.customerLedger.findFirst({
        where: { clientId: client.id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
      });

      const calculatedBalance = latestLedger ? latestLedger.balance : client.openingBalance;
      const diff = Math.abs(client.currentBalance - calculatedBalance);

      if (diff > 1) {
        console.log(chalk.red(`[FAIL] Client ${client.name} (${client.id})`));
        console.log(`       Client Balance: Rs ${client.currentBalance}`);
        console.log(`       Ledger Balance: Rs ${calculatedBalance}`);
        clientMismatches++;
      }
    }
    if (clientMismatches === 0) {
      console.log(chalk.green(`[PASS] All ${clients.length} clients balances match ledger.`));
    }
    console.log();

    // ---------------------------------------------------------
    // 3. Sale Balance Verification
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('3. SALE BALANCE VERIFICATION'));
    const sales = await prisma.sale.findMany({
      where: { deletedAt: null },
      include: { collectionAllocations: true }
    });

    let saleMismatches = 0;
    for (const sale of sales) {
      const allocatedSum = sale.collectionAllocations.reduce((sum: number, alloc: any) => sum + alloc.allocatedAmount, 0);
      const diffPaid = Math.abs(sale.paid - allocatedSum);
      const expectedBalance = sale.total - sale.paid;
      const diffBalance = Math.abs(sale.balance - expectedBalance);

      let statusMismatch = false;
      if (sale.balance <= 0 && sale.status === 'PENDING') statusMismatch = true;
      if (sale.balance > 0 && sale.status === 'PAID') statusMismatch = true;

      if (diffPaid > 1 || diffBalance > 1 || statusMismatch) {
        console.log(chalk.red(`[FAIL] Sale Invoice: ${sale.invoiceNo}`));
        if (diffPaid > 1) {
          console.log(`       sale.paid (${sale.paid}) != allocations (${allocatedSum})`);
        }
        if (diffBalance > 1) {
          console.log(`       sale.balance (${sale.balance}) != total - paid (${expectedBalance})`);
        }
        if (statusMismatch) {
          console.log(`       Status ${sale.status} inconsistent with balance ${sale.balance}`);
        }
        saleMismatches++;
      }
    }
    if (saleMismatches === 0) {
      console.log(chalk.green(`[PASS] All ${sales.length} sales balances and statuses are consistent.`));
    }
    console.log();

    // ---------------------------------------------------------
    // 4. Collection-Allocation Integrity
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('4. COLLECTION-ALLOCATION INTEGRITY'));
    
    // orphaned collections
    const collections = await prisma.collection.findMany({
      where: { deletedAt: null },
      include: { allocations: true }
    });
    
    let orphanedCount = 0;
    let overAllocatedCount = 0;
    let totalCollectionAmount = 0;
    let totalAllocatedAmount = 0;

    for (const coll of collections) {
      totalCollectionAmount += coll.amount;
      const allocSum = coll.allocations.reduce((sum: number, a: any) => sum + a.allocatedAmount, 0);
      totalAllocatedAmount += allocSum;

      if (coll.allocations.length === 0) {
        orphanedCount++;
      }
      if (allocSum > coll.amount + 0.01) {
        console.log(chalk.red(`[FAIL] Collection ${coll.id} allocated (${allocSum}) exceeds amount (${coll.amount})`));
        overAllocatedCount++;
      }
    }

    // find broken allocations
    const brokenAllocations = await prisma.collectionAllocation.findMany({
      where: {
        OR: [
          { collection: { deletedAt: { not: null } } },
          { sale: { deletedAt: { not: null } } }
        ]
      }
    });

    if (brokenAllocations.length > 0) {
      console.log(chalk.red(`[FAIL] Found ${brokenAllocations.length} allocations tied to deleted sales/collections.`));
    } else {
      console.log(chalk.green(`[PASS] No orphaned allocations found.`));
    }

    if (overAllocatedCount === 0) {
      console.log(chalk.green(`[PASS] No over-allocated collections found.`));
    }
    console.log(`- Orphaned (unallocated) collections: ${orphanedCount}`);
    console.log(`- Total Collection Amount: Rs ${totalCollectionAmount.toFixed(2)}`);
    console.log(`- Total Allocated Amount: Rs ${totalAllocatedAmount.toFixed(2)}`);
    console.log();

    // ---------------------------------------------------------
    // 5. Financial Summary
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('5. FINANCIAL SUMMARY'));
    const totalSalesAggr = await prisma.sale.aggregate({
      where: { deletedAt: null },
      _sum: { total: true }
    });
    const totalCollectionsAggr = await prisma.collection.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true }
    });
    const totalReceivablesAggr = await prisma.client.aggregate({
      where: { deletedAt: null, currentBalance: { gt: 0 } },
      _sum: { currentBalance: true }
    });
    const totalPurchasesAggr = await prisma.purchase.aggregate({
      where: { deletedAt: null },
      _sum: { total: true }
    });
    const totalExpensesAggr = await prisma.expense.aggregate({
      where: { deletedAt: null },
      _sum: { amount: true }
    });

    console.log(`- Total Sales: Rs ${totalSalesAggr._sum.total || 0}`);
    console.log(`- Total Collections: Rs ${totalCollectionsAggr._sum.amount || 0}`);
    console.log(`- Total Receivables: Rs ${totalReceivablesAggr._sum.currentBalance || 0}`);
    console.log(`- Total Purchases: Rs ${totalPurchasesAggr._sum.total || 0}`);
    console.log(`- Total Expenses: Rs ${totalExpensesAggr._sum.amount || 0}`);
    console.log();

    // ---------------------------------------------------------
    // 6. Inventory Verification
    // ---------------------------------------------------------
    console.log(chalk.bold.blue('6. INVENTORY VERIFICATION'));
    const inventoryItems = await prisma.inventory.findMany({
      include: { product: true, branch: true }
    });

    let inventoryMismatches = 0;
    for (const inv of inventoryItems) {
      const movements = await prisma.stockMovement.findMany({
        where: { productId: inv.productId, branchId: inv.branchId }
      });
      
      const netMovement = movements.reduce((net: number, mov: any) => net + (mov.newStock - mov.previousStock), 0);
      const diff = Math.abs(inv.qty - netMovement);

      if (diff > 0.01) {
        console.log(chalk.red(`[FAIL] Inventory mismatch for ${inv.product.name} at ${inv.branch.name}`));
        console.log(`       Inventory Qty: ${inv.qty}`);
        console.log(`       Net Movement: ${netMovement}`);
        inventoryMismatches++;
      }
    }

    if (inventoryMismatches === 0) {
      console.log(chalk.green(`[PASS] All ${inventoryItems.length} inventory records match stock movements.`));
    }
    console.log();
    
    console.log(chalk.bold.green('Audit completed successfully.'));

  } catch (error) {
    console.error('Error during reconciliation audit:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
