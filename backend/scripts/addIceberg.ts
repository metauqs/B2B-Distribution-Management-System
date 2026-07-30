import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    const existing = await prisma.product.findFirst({ where: { name: { contains: 'Iceberg', mode: 'insensitive' } } });
    if (existing) {
      console.log('✅ Iceberg already exists:', existing.id, existing.name);
      return;
    }
    const p = await prisma.product.create({
      data: {
        name: 'Iceberg Lettuce',
        urduName: 'آئس برگ',
        category: 'VEGETABLE' as any,
        defaultUnit: 'KG' as any,
        availability: 'AVAILABLE' as any,
        isActive: true,
        minStock: 0,
        sortOrder: 0,
      },
    });
    console.log('✅ Created:', p.id, p.name, p.urduName);
  } catch (e: any) {
    console.error('❌ Error:', e.message);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
