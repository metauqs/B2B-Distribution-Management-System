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
    where: { clientId: 'WH-7425' },
    include: { ledgers: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } }
  });

  if (!client) {
    console.log('Client Test 2 not found');
    return;
  }

  console.log(`Client: ${client.name} (id: ${client.id})`);
  console.log('Ledger entries:');
  for (const entry of client.ledgers) {
    console.log(`- Type: ${entry.type}, Date: ${entry.date.toISOString()}, Debit: ${entry.debit}, Credit: ${entry.credit}, Balance: ${entry.balance}, Ref: ${entry.referenceNo}`);
  }
}

main().finally(() => prisma.$disconnect());
