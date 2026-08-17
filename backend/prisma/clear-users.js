const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function clearUsers() {
  try {
    console.log('🗑️  Clearing all User records...');
    const result = await prisma.user.deleteMany({});
    console.log(`✅ Deleted ${result.count} user records`);
    console.log('📝 Users will be recreated with correct roles on next login');
  } catch (err) {
    console.error('❌ Error clearing users:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

clearUsers();
