import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL ?? 'postgresql://sabzi:sabzi_secret@localhost:5432/sabzi_ledger?schema=public';
const adapter = new PrismaPg({ connectionString });
const prisma  = new PrismaClient({ adapter });

// Enhanced implementation of recordCustomerLedgerEntry copy-pasted for test script
async function recordCustomerLedgerEntry(
  tx: any,
  params: {
    clientId:     string;
    branchId:     string;
    type:         'INVOICE' | 'PAYMENT' | 'ADJUSTMENT' | 'DEBIT_NOTE' | 'CREDIT_NOTE';
    date?:        Date;
    referenceId?: string;
    referenceNo?: string;
    description?: string;
    debit:        number;
    credit:       number;
  }
): Promise<{ ledger: any; balance: number }> {
  const db = tx || prisma;
  const entryDate = params.date ?? new Date();

  // 1. Fetch predecessor ledger entry (latest chronological entry BEFORE the new entry's date)
  const predecessor = await db.customerLedger.findFirst({
    where: {
      clientId: params.clientId,
      OR: [
        { date: { lt: entryDate } },
        {
          date: entryDate,
          createdAt: { lt: new Date() } // Fallback for same-day sorting order
        }
      ]
    },
    orderBy: [
      { date: 'desc' },
      { createdAt: 'desc' }
    ],
    select: { balance: true }
  });

  let previousBalance = 0;
  if (predecessor) {
    previousBalance = predecessor.balance;
  } else {
    // Fallback to client openingBalance if no ledger entry exists yet
    const client = await db.client.findUnique({
      where: { id: params.clientId },
      select: { openingBalance: true }
    });
    previousBalance = client?.openingBalance ?? 0;
  }

  const debitAmt  = Number(params.debit || 0);
  const creditAmt = Number(params.credit || 0);
  const newBalance = previousBalance + debitAmt - creditAmt;

  // 2. Insert CustomerLedger row
  const ledger = await db.customerLedger.create({
    data: {
      clientId:    params.clientId,
      branchId:    params.branchId,
      type:        params.type,
      date:        entryDate,
      referenceId: params.referenceId,
      referenceNo: params.referenceNo,
      description: params.description,
      debit:       debitAmt,
      credit:      creditAmt,
      balance:     newBalance,
    }
  });

  // 3. Recalculate and update all subsequent ledger entries to maintain running balance integrity
  const subsequentEntries = await db.customerLedger.findMany({
    where: {
      clientId: params.clientId,
      id: { not: ledger.id },
      OR: [
        { date: { gt: entryDate } },
        {
          date: entryDate,
          createdAt: { gt: ledger.createdAt }
        }
      ]
    },
    orderBy: [
      { date: 'asc' },
      { createdAt: 'asc' }
    ]
  });

  let currentRunning = newBalance;
  for (const sub of subsequentEntries) {
    currentRunning = currentRunning + sub.debit - sub.credit;
    await db.customerLedger.update({
      where: { id: sub.id },
      data: { balance: currentRunning }
    });
  }

  // 4. Keep Client.currentBalance 100% in sync with the final running balance of the chronologically latest entry
  await db.client.update({
    where: { id: params.clientId },
    data:  { currentBalance: currentRunning }
  });

  return { ledger, balance: newBalance };
}

async function main() {
  console.log('--- RUNNING SCENARIO VERIFICATION TEST ---');
  
  // 1. Create client
  const client = await prisma.client.create({
    data: {
      name: 'Scenario Verification Client',
      openingBalance: 0,
      currentBalance: 0,
      branchId: 'branch_main'
    }
  });
  console.log(`Created test client: ${client.name} (id: ${client.id})`);

  try {
    // Helper to log state
    const logState = async (step: string) => {
      const c = await prisma.client.findUnique({
        where: { id: client.id },
        select: { currentBalance: true }
      });
      const lastLedger = await prisma.customerLedger.findFirst({
        where: { clientId: client.id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }]
      });
      console.log(`[${step}] Client Bal: Rs ${c?.currentBalance}, Last Ledger Row Bal: Rs ${lastLedger?.balance}`);
    };

    await logState('INITIAL');

    // 2. Invoice #1 of Rs 5000
    // Simulating Sale creation
    await prisma.$transaction(async tx => {
      const sale = await tx.sale.create({
        data: {
          invoiceNo: 'VERIFY-INV-1',
          clientId: client.id,
          branchId: 'branch_main',
          total: 5000,
          paid: 0,
          balance: 5000,
          status: 'PENDING'
        }
      });
      await recordCustomerLedgerEntry(tx, {
        clientId: client.id,
        branchId: 'branch_main',
        type: 'INVOICE',
        referenceId: sale.id,
        referenceNo: sale.invoiceNo,
        description: 'Invoice Generated',
        debit: 5000,
        credit: 0
      });
    });
    await logState('INVOICE #1 (Rs 5000)');

    // 3. Payment of Rs 2000
    await prisma.$transaction(async tx => {
      const coll = await tx.collection.create({
        data: {
          clientId: client.id,
          amount: 2000,
          branchId: 'branch_main',
          method: 'CASH',
          reference: 'VERIFY-PAY-1'
        }
      });
      await recordCustomerLedgerEntry(tx, {
        clientId: client.id,
        branchId: 'branch_main',
        type: 'PAYMENT',
        referenceId: coll.id,
        referenceNo: coll.reference || '',
        description: 'Payment Received',
        debit: 0,
        credit: 2000
      });
      // Settle sales FIFO
      const sale = await tx.sale.findFirst({ where: { invoiceNo: 'VERIFY-INV-1' } });
      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            paid: 2000,
            balance: 3000,
            status: 'PARTIAL'
          }
        });
      }
    });
    await logState('PAYMENT #1 (Rs 2000)');

    // 4. Invoice #2 of Rs 4000
    await prisma.$transaction(async tx => {
      const sale = await tx.sale.create({
        data: {
          invoiceNo: 'VERIFY-INV-2',
          clientId: client.id,
          branchId: 'branch_main',
          total: 4000,
          paid: 0,
          balance: 4000,
          status: 'PENDING'
        }
      });
      await recordCustomerLedgerEntry(tx, {
        clientId: client.id,
        branchId: 'branch_main',
        type: 'INVOICE',
        referenceId: sale.id,
        referenceNo: sale.invoiceNo,
        description: 'Invoice Generated',
        debit: 4000,
        credit: 0
      });
    });
    await logState('INVOICE #2 (Rs 4000)');

    // 5. Payment of Rs 5000
    await prisma.$transaction(async tx => {
      const coll = await tx.collection.create({
        data: {
          clientId: client.id,
          amount: 5000,
          branchId: 'branch_main',
          method: 'CASH',
          reference: 'VERIFY-PAY-2'
        }
      });
      await recordCustomerLedgerEntry(tx, {
        clientId: client.id,
        branchId: 'branch_main',
        type: 'PAYMENT',
        referenceId: coll.id,
        referenceNo: coll.reference || '',
        description: 'Payment Received',
        debit: 0,
        credit: 5000
      });
      // Settle sales FIFO (VERIFY-INV-1: needs 3000, VERIFY-INV-2: needs 4000)
      const sale1 = await tx.sale.findFirst({ where: { invoiceNo: 'VERIFY-INV-1' } });
      const sale2 = await tx.sale.findFirst({ where: { invoiceNo: 'VERIFY-INV-2' } });
      if (sale1) {
        await tx.sale.update({
          where: { id: sale1.id },
          data: {
            paid: 5000,
            balance: 0,
            status: 'PAID'
          }
        });
      }
      if (sale2) {
        await tx.sale.update({
          where: { id: sale2.id },
          data: {
            paid: 2000,
            balance: 2000,
            status: 'PARTIAL'
          }
        });
      }
    });
    await logState('PAYMENT #2 (Rs 5000)');

    // 6. Assertions
    const finalClient = await prisma.client.findUnique({ where: { id: client.id } });
    if (finalClient?.currentBalance === 2000) {
      console.log('✅ TEST PASSED: Final balance is exactly Rs 2000!');
    } else {
      console.error(`❌ TEST FAILED: Final balance is Rs ${finalClient?.currentBalance} instead of Rs 2000`);
    }

  } finally {
    // Cleanup
    console.log('Cleaning up scenario test records...');
    await prisma.customerLedger.deleteMany({ where: { clientId: client.id } });
    await prisma.collection.deleteMany({ where: { clientId: client.id } });
    await prisma.sale.deleteMany({ where: { clientId: client.id } });
    await prisma.client.delete({ where: { id: client.id } });
    console.log('Cleanup complete.');
  }
}

main()
  .catch(err => console.error(err))
  .finally(() => prisma.$disconnect());
