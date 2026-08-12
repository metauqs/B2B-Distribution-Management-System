import 'dotenv/config';
import prisma from '../src/lib/prisma';

export async function reconcileInventorySingleSourceOfTruth() {
  console.log('=== STARTING INVENTORY SINGLE SOURCE OF TRUTH RECONCILIATION ===');

  const products = await prisma.product.findMany({
    include: {
      inventory: true,
      stockMovements: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
    }
  });

  let reconciledCount = 0;
  let totalDiscrepancyFixed = 0;

  for (const p of products) {
    const inv = p.inventory[0];
    const currentInvQty = inv ? inv.qty : 0;

    // Calculate exact mathematical stock from all logged StockMovements
    const smSum = p.stockMovements.reduce((acc, m) => acc + Number(m.qty), 0);
    const expectedQty = Math.max(0, Math.round(smSum * 1000) / 1000);

    const diff = Math.abs(currentInvQty - expectedQty);

    if (diff > 0.001) {
      console.log(`⚠️ DISCREPANCY DETECTED for product "${p.name}" (ID: ${p.id}):`);
      console.log(`   Recorded Inventory.qty: ${currentInvQty}`);
      console.log(`   Authoritative StockMovements Sum: ${expectedQty}`);
      console.log(`   Fixing: Updating Inventory.qty from ${currentInvQty} → ${expectedQty}`);

      if (inv) {
        await prisma.inventory.update({
          where: { id: inv.id },
          data: { qty: expectedQty }
        });
      } else {
        const firstBranch = await prisma.branch.findFirst();
        const branchId = firstBranch?.id ?? 'branch_main';
        await prisma.inventory.create({
          data: {
            productId: p.id,
            branchId,
            qty: expectedQty,
            avgCost: 0,
            currentBuyPrice: 0,
            previousBuyPrice: 0,
          }
        });
      }

      reconciledCount++;
      totalDiscrepancyFixed += diff;
    }
  }

  console.log(`\n✅ RECONCILIATION COMPLETE: ${reconciledCount} product inventory records reconciled to 100% Single Source of Truth.`);
  return { reconciledCount, totalDiscrepancyFixed };
}

if (require.main === module) {
  reconcileInventorySingleSourceOfTruth()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
