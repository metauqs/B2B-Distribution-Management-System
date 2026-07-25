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
  const clients = await prisma.client.findMany();
  console.log('ALL CLIENTS IN DATABASE:');
  for (const c of clients) {
    console.log(`- ID: ${c.id}, Code: ${c.clientId}, Name: ${c.name}, Bal: ${c.currentBalance}, Deleted: ${c.deletedAt}`);
  }
}

main().finally(() => prisma.$disconnect());
