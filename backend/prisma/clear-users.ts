import prisma from '../src/lib/prisma';

async function clearUsers() {
  try {
    console.log('🗑️  Clearing all User records...');
    const result = await prisma.user.deleteMany({});
    console.log(`✅ Deleted ${result.count} user records`);
    console.log('📝 Users will be recreated with correct roles on next login');
  } catch (err) {
    console.error('❌ Error clearing users:', err);
  } finally {
    await prisma.$disconnect();
  }
}

clearUsers();
