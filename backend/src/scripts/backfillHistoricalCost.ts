import prisma from '../lib/prisma';

async function runBackfill() {
  console.log('🔄 [BACKFILL] Starting historical cost basis backfill check...');
  const saleItems = await prisma.saleItem.findMany({
    where: { costPrice: 0 },
    include: { product: { select: { id: true, inventory: { select: { avgCost: true, currentBuyPrice: true } } } } },
  });

  console.log(`Found ${saleItems.length} sale items requiring cost basis backfill.`);

  let count = 0;
  for (const item of saleItems) {
    let cost = 0;
    if (item.product?.inventory && item.product.inventory.length > 0) {
      const inv = item.product.inventory[0];
      cost = inv.avgCost > 0 ? inv.avgCost : inv.currentBuyPrice;
    }
    if (cost <= 0) cost = item.rate * 0.75;

    await prisma.saleItem.update({
      where: { id: item.id },
      data: { costPrice: cost },
    });
    count++;
  }

  console.log(`✅ [BACKFILL] Completed backfill for ${count} sale items.`);
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill failed:', err);
    process.exit(1);
  });
