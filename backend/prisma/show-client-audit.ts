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
const prisma  = new PrismaClient({ adapter });

async function main() {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entityId: 'cmrt63hay00009gxu3uo7kg7i' },
        { newData: { path: ['clientId'], equals: 'cmrt63hay00009gxu3uo7kg7i' } },
        { oldData: { path: ['clientId'], equals: 'cmrt63hay00009gxu3uo7kg7i' } }
      ]
    },
    orderBy: { createdAt: 'asc' }
  });

  console.log('AUDIT LOGS FOR CLIENT TEST 2:');
  for (const log of logs) {
    console.log(`- Action: ${log.action}, Entity: ${log.entity}, ID: ${log.entityId}, Created: ${log.createdAt.toISOString()}`);
    console.log(`  NewData:`, JSON.stringify(log.newData));
    console.log(`  OldData:`, JSON.stringify(log.oldData));
  }
}

main().finally(() => prisma.$disconnect());
