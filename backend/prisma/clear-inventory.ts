import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const prisma = (await import('../src/lib/prisma')).default;

  console.log('🗑️  Deleting all inventory, products, price lists, and stock movements...');

  const stockMovements = await prisma.stockMovement.deleteMany({});
  console.log(`Deleted ${stockMovements.count} stock movements.`);

  const wastages = await prisma.wastage.deleteMany({});
  console.log(`Deleted ${wastages.count} wastage records.`);

  const inventories = await prisma.inventory.deleteMany({});
  console.log(`Deleted ${inventories.count} inventory records.`);

  const priceItems = await prisma.priceItem.deleteMany({});
  console.log(`Deleted ${priceItems.count} price list items.`);

  const priceLists = await prisma.priceList.deleteMany({});
  console.log(`Deleted ${priceLists.count} price lists.`);

  const priceBroadcasts = await prisma.priceBroadcast.deleteMany({});
  console.log(`Deleted ${priceBroadcasts.count} price broadcasts.`);

  const purchaseItems = await prisma.purchaseItem.deleteMany({});
  console.log(`Deleted ${purchaseItems.count} purchase items.`);

  const supplierPayments = await prisma.supplierPayment.deleteMany({});
  console.log(`Deleted ${supplierPayments.count} supplier payments.`);

  const supplierLedgers = await prisma.supplierLedger.deleteMany({});
  console.log(`Deleted ${supplierLedgers.count} supplier ledgers.`);

  const purchases = await prisma.purchase.deleteMany({});
  console.log(`Deleted ${purchases.count} purchases.`);

  const suppliers = await prisma.supplier.deleteMany({});
  console.log(`Deleted ${suppliers.count} suppliers.`);

  const products = await prisma.product.deleteMany({});
  console.log(`Deleted ${products.count} products.`);

  console.log('✅ All inventory and product data deleted successfully!');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('❌ Error clearing inventory data:', e);
  process.exit(1);
});
