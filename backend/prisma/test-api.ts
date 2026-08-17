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
  const dateStr = '2026-07-17'; // Tomorrow
  const day = new Date(dateStr);
  day.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dateStr);
  dayEnd.setHours(23, 59, 59, 999);

  const list = await prisma.priceList.findFirst({
    where: {
      date: { gte: day, lte: dayEnd },
      isActive: true,
    },
    include: {
      items: true,
    },
  });
  console.log('List for', dateStr, 'exists?', !!list);

  if (!list) {
    // Generate draft
    const activeProducts = await prisma.product.findMany({
      where: {
        availability: { in: ['AVAILABLE', 'SEASONAL'] },
        isActive:     true,
      },
    });
    console.log('Draft should contain:', activeProducts.length, 'items');
  }
}

main().finally(() => prisma.$disconnect());
