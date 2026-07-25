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
  // Find the main branch
  const branch = await prisma.branch.findFirst();
  if (!branch) throw new Error('No branch found');

  const user = await prisma.user.findFirst({ where: { role: 'OWNER' } });

  // Today
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);

  // Check if already exists
  const existing = await prisma.priceList.findFirst({
    where: { branchId: branch.id, date: { gte: todayStart, lte: todayEnd } },
  });
  if (existing) {
    console.log('✅ Today\'s price list already exists — skipping');
    return;
  }

  const products = await prisma.product.findMany({ where: { isActive: true } });

  // Sample rates (will vary by season)
  const sampleRates: Record<string, { buy: number; sell: number }> = {
    'Tomato':    { buy: 60,  sell: 80 },
    'Potato':    { buy: 40,  sell: 55 },
    'Onion':     { buy: 50,  sell: 70 },
    'Garlic':    { buy: 200, sell: 260 },
    'Ginger':    { buy: 180, sell: 240 },
    'Spinach':   { buy: 25,  sell: 40 },
    'Coriander': { buy: 30,  sell: 50 },
    'Carrot':    { buy: 55,  sell: 75 },
    'Cauliflower': { buy: 45, sell: 65 },
    'Capsicum':  { buy: 90,  sell: 120 },
    'Bitter Gourd': { buy: 70, sell: 95 },
    'Bottle Gourd': { buy: 35, sell: 55 },
    'Banana':    { buy: 80,  sell: 110 },
    'Apple':     { buy: 200, sell: 260 },
    'Orange':    { buy: 90,  sell: 120 },
    'Mango':     { buy: 150, sell: 200 },
    'Watermelon': { buy: 30, sell: 45 },
    'Papaya':    { buy: 60,  sell: 85 },
    'Grapes':    { buy: 120, sell: 160 },
    'Guava':     { buy: 55,  sell: 80 },
  };

  const items = products.map(prod => {
    const rates = sampleRates[prod.name] ?? { buy: 50, sell: 70 };
    return {
      productId: prod.id,
      itemName:  prod.name,
      unit:      prod.defaultUnit,
      buyRate:   rates.buy,
      sellRate:  rates.sell,
    };
  });

  const list = await prisma.priceList.create({
    data: {
      date:        today,
      branchId:    branch.id,
      createdById: user?.id ?? undefined,
      notes:       'Seeded sample rates — update with today\'s mandi prices',
      items:       { create: items },
    },
    include: { items: true, _count: { select: { items: true } } },
  });

  console.log(`✅ Today's price list created with ${list._count.items} items`);
  console.log('   → Open /pricelist to view and edit rates');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
