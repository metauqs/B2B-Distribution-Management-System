import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required.');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const isExecute = process.argv.includes('--execute');
  console.log('--- COLLECTION ALLOCATIONS BACKFILL ---');
  console.log(`Mode: ${isExecute ? 'EXECUTE' : 'DRY RUN (pass --execute to apply changes)'}`);

  const orphanedCollections = await prisma.collection.findMany({
    where: {
      reference: { startsWith: 'Payment for ' },
      allocations: { none: {} }
    }
  });

  console.log(`Found ${orphanedCollections.length} collections with 'Payment for' reference and no allocations.`);

  let totalAllocationsCreated = 0;
  let totalUnmatched = 0;

  for (const collection of orphanedCollections) {
    if (!collection.reference) continue;

    // e.g., "Payment for IN-00123"
    const match = collection.reference.match(/Payment for (IN-[a-zA-Z0-9\-]+)/);
    if (!match) {
      console.log(`[!] Could not parse invoice number from reference: "${collection.reference}" (Collection ID: ${collection.id})`);
      totalUnmatched++;
      continue;
    }

    const invoiceNo = match[1];

    const sale = await prisma.sale.findFirst({
      where: {
        invoiceNo,
        clientId: collection.clientId
      }
    });

    if (!sale) {
      console.log(`[!] No matching sale found for invoice ${invoiceNo} and clientId ${collection.clientId} (Collection ID: ${collection.id})`);
      totalUnmatched++;
      continue;
    }

    if (isExecute) {
      try {
        await prisma.collectionAllocation.create({
          data: {
            collectionId: collection.id,
            saleId: sale.id,
            allocatedAmount: collection.amount
          }
        });
        console.log(`[+] Created allocation: Collection ${collection.id} -> Sale ${sale.id} (Invoice: ${invoiceNo}, Amount: ${collection.amount})`);
        totalAllocationsCreated++;
      } catch (err) {
        console.error(`[-] Failed to create allocation for Collection ${collection.id}:`, err);
      }
    } else {
      console.log(`[~] Would create allocation: Collection ${collection.id} -> Sale ${sale.id} (Invoice: ${invoiceNo}, Amount: ${collection.amount})`);
      totalAllocationsCreated++;
    }
  }

  console.log('----------------------------------------');
  console.log(`Total orphaned collections found: ${orphanedCollections.length}`);
  console.log(`Total allocations ${isExecute ? 'created' : 'would be created'}: ${totalAllocationsCreated}`);
  console.log(`Total that couldn't be matched: ${totalUnmatched}`);
}

main()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
