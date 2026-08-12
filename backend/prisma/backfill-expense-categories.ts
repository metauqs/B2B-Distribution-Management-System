import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ExpenseCategory } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL ?? 'postgresql://sabzi:sabzi_secret@localhost:5432/sabzi_ledger?schema=public';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('--- EXPENSE CATEGORIES BACKFILL ---');
  
  const categories = Object.values(ExpenseCategory);
  console.log(`Found ${categories.length} enum categories to process.`);

  let totalExpensesUpdated = 0;
  let totalUnmatched = 0;

  for (const category of categories) {
    try {
      // 1. Seed ExpenseCategoryRef
      const categoryRef = await prisma.expenseCategoryRef.upsert({
        where: { name: category },
        update: {},
        create: {
          name: category,
          isActive: true
        }
      });
      console.log(`[+] Upserted ExpenseCategoryRef: ${category} (ID: ${categoryRef.id})`);

      // 2. Update expenses matching this category enum
      const updateResult = await prisma.expense.updateMany({
        where: {
          category: category,
          categoryRefId: null // only update those not already linked
        },
        data: {
          categoryRefId: categoryRef.id
        }
      });
      
      console.log(`    Updated ${updateResult.count} expenses for category ${category}.`);
      totalExpensesUpdated += updateResult.count;
    } catch (err) {
      console.error(`[-] Error processing category ${category}:`, err);
    }
  }

  // Check if any expenses are left without a categoryRefId
  const remainingOrphans = await prisma.expense.count({
    where: {
      categoryRefId: null
    }
  });
  
  totalUnmatched = remainingOrphans;

  console.log('----------------------------------------');
  console.log(`Total expenses updated: ${totalExpensesUpdated}`);
  if (totalUnmatched > 0) {
    console.log(`Total expenses that couldn't be matched: ${totalUnmatched}`);
  } else {
    console.log(`All expenses successfully matched to a CategoryRef!`);
  }
}

main()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
