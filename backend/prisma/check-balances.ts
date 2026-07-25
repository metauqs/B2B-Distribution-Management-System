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
  console.log('--- CUSTOMER BALANCE INTEGRITY CHECK & REPAIR ---');
  const clients = await prisma.client.findMany({
    where: { deletedAt: null },
    include: {
      ledgers: {
        orderBy: [
          { date: 'asc' },
          { createdAt: 'asc' }
        ]
      }
    }
  });

  let discrepancies = 0;

  for (const client of clients) {
    const opening = client.openingBalance;
    const current = client.currentBalance;
    
    // Calculate ledger balance from entries
    let running = opening;
    let ledgerMismatches = 0;
    
    for (const entry of client.ledgers) {
      running += (entry.debit - entry.credit);
      if (Math.abs(entry.balance - running) > 0.01) {
        ledgerMismatches++;
      }
    }
    
    const lastLedger = client.ledgers[client.ledgers.length - 1];
    const lastLedgerBalance = lastLedger ? lastLedger.balance : opening;

    const hasDiscrepancy = 
      Math.abs(current - running) > 0.01 || 
      Math.abs(current - lastLedgerBalance) > 0.01 ||
      ledgerMismatches > 0;

    console.log(`Client: ${client.name} (${client.clientId || 'no ID'})`);
    console.log(`  Opening Balance:  Rs ${opening}`);
    console.log(`  Current Balance:  Rs ${current}`);
    console.log(`  Sum of Ledger:    Rs ${running}`);
    console.log(`  Last Ledger Bal:  Rs ${lastLedgerBalance}`);
    console.log(`  Ledger mismatches: ${ledgerMismatches}`);

    if (hasDiscrepancy) {
      console.error(`  ⚠️ DISCREPANCY DETECTED!`);
      discrepancies++;
      
      console.log(`  Repairing ledger entries for ${client.name}...`);
      let repairRunning = opening;
      for (const entry of client.ledgers) {
        repairRunning += (entry.debit - entry.credit);
        if (Math.abs(entry.balance - repairRunning) > 0.01) {
          await prisma.customerLedger.update({
            where: { id: entry.id },
            data: { balance: repairRunning }
          });
        }
      }
      
      console.log(`  Updating client currentBalance to: Rs ${repairRunning}`);
      await prisma.client.update({
        where: { id: client.id },
        data: { currentBalance: repairRunning }
      });
    } else {
      console.log(`  ✅ OK`);
    }
  }

  console.log('----------------------------------------');
  console.log(`Total active clients: ${clients.length}`);
  console.log(`Total clients with discrepancies repaired: ${discrepancies}`);
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
