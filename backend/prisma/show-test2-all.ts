import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL ?? 'postgresql://sabzi:sabzi_secret@localhost:5432/sabzi_ledger?schema=public';
const adapter = new PrismaPg({ connectionString });
const prisma  = new PrismaClient({ adapter });

async function main() {
  const client = await prisma.client.findFirst({
    where: { clientId: 'WH-7425' }
  });
  if (!client) {
    console.log('Client Test 2 not found');
    return;
  }
  
  const sales = await prisma.sale.findMany({
    where: { clientId: client.id, deletedAt: null }
  });
  const collections = await prisma.collection.findMany({
    where: { clientId: client.id, deletedAt: null }
  });

  console.log('SALES FOR TEST 2:');
  for (const s of sales) {
    console.log(`- ID: ${s.id}, Date: ${s.date.toISOString()}, Total: ${s.total}, Paid: ${s.paid}, Bal: ${s.balance}, Status: ${s.status}, Ref: ${s.invoiceNo}`);
  }

  console.log('COLLECTIONS FOR TEST 2:');
  for (const c of collections) {
    console.log(`- ID: ${c.id}, Date: ${c.date.toISOString()}, Amount: ${c.amount}, Method: ${c.method}, Ref: ${c.reference}`);
  }
}

main().finally(() => prisma.$disconnect());
