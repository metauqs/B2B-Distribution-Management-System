import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const prisma = (await import('../src/lib/prisma')).default;

  console.log('--- Database Record Count Check ---');
  try {
    const branchCount = await prisma.branch.count();
    const userCount = await prisma.user.count();
    const productCount = await prisma.product.count();
    const clientCount = await prisma.client.count();
    const supplierCount = await prisma.supplier.count();
    const saleCount = await prisma.sale.count();
    const saleItemCount = await prisma.saleItem.count();
    const purchaseCount = await prisma.purchase.count();
    const purchaseItemCount = await prisma.purchaseItem.count();
    const inventoryCount = await prisma.inventory.count();
    const stockMovementCount = await prisma.stockMovement.count();
    const wastageCount = await prisma.wastage.count();
    const priceListCount = await prisma.priceList.count();
    const collectionCount = await prisma.collection.count();

    console.log(`Branches: ${branchCount}`);
    console.log(`Users: ${userCount}`);
    console.log(`Products: ${productCount}`);
    console.log(`Clients: ${clientCount}`);
    console.log(`Suppliers: ${supplierCount}`);
    console.log(`Sales: ${saleCount}`);
    console.log(`Sale Items: ${saleItemCount}`);
    console.log(`Purchases: ${purchaseCount}`);
    console.log(`Purchase Items: ${purchaseItemCount}`);
    console.log(`Inventory records: ${inventoryCount}`);
    console.log(`Stock movements: ${stockMovementCount}`);
    console.log(`Wastages: ${wastageCount}`);
    console.log(`Price Lists: ${priceListCount}`);
    console.log(`Collections: ${collectionCount}`);
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
