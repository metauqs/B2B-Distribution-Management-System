import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma';

async function main() {
  console.log('🗑️  Removing all client data...');
  
  await prisma.$transaction([
    prisma.delivery.deleteMany({}),
    prisma.saleItem.deleteMany({}),
    prisma.sale.deleteMany({}),
    prisma.collection.deleteMany({}),
    prisma.customerLedger.deleteMany({}),
    prisma.cheque.deleteMany({}),
    prisma.broadcastRecipient.deleteMany({}),
    prisma.client.deleteMany({}),
  ]);

  console.log('✅ All client data (clients, sales, collections, ledgers, deliveries) has been completely removed!');
}

main()
  .catch((err) => {
    console.error('❌ Error removing client data:', err);
  })
  .finally(() => prisma.$disconnect());
