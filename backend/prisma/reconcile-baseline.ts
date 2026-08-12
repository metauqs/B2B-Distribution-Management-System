import 'dotenv/config';
import prisma from '../src/lib/prisma';

export async function reconcileBaselineStock() {
  console.log('=== RECONCILING STOCK USING LATEST PHYSICAL BASELINE RULE ===');

  const products = await prisma.product.findMany({
    include: {
      inventory: true,
      stockMovements: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }
    }
  });

  for (const p of products) {
    const inv = p.inventory[0];
    const smList = p.stockMovements;

    if (smList.length === 0) continue;

    // Find the latest physical count adjustment or admin reset movement
    let lastBaselineIdx = -1;
    for (let i = smList.length - 1; i >= 0; i--) {
      const m = smList[i];
      const isBaseline =
        m.refType === 'adjustment' ||
        m.refType === 'admin_reset' ||
        m.type === 'OPENING' ||
        (m.type === 'ADJUSTMENT' && m.refType !== 'sale_edit_restore');
      if (isBaseline) {
        lastBaselineIdx = i;
        break;
      }
    }

    let currentStock = 0;
    if (lastBaselineIdx !== -1) {
      const baselineMove = smList[lastBaselineIdx];
      const baselineQty = Math.max(0, baselineMove.newStock);

      // Sum all movements after baselineMove
      const subsequentSum = smList.slice(lastBaselineIdx + 1).reduce((sum, m) => sum + Number(m.qty || 0), 0);
      currentStock = Math.max(0, Math.round((baselineQty + subsequentSum) * 1000) / 1000);
    } else {
      // No baseline adjustment found — calculate from all movements
      const sumAll = smList.reduce((sum, m) => sum + Number(m.qty || 0), 0);
      currentStock = Math.max(0, Math.round(sumAll * 1000) / 1000);
    }

    console.log(`Product: ${p.name.padEnd(25)} | Old Recorded: ${(inv?.qty ?? 0).toFixed(2).padStart(8)} | Baseline Reconciled: ${currentStock.toFixed(2).padStart(8)}`);

    if (inv) {
      await prisma.inventory.update({
        where: { id: inv.id },
        data: { qty: currentStock }
      });
    }
  }

  console.log('\n✅ BASELINE RECONCILIATION COMPLETE!');
}

if (require.main === module) {
  reconcileBaselineStock()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
