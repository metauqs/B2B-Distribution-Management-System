import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma';

async function main() {
  console.log('🗑️  Removing all employee records from database...');

  // Set employeeId to null on Sales and Deliveries to avoid cascading sales deletion
  await prisma.sale.updateMany({
    data: { employeeId: null },
  });

  await prisma.delivery.updateMany({
    data: { employeeId: null },
  });

  await prisma.$transaction([
    prisma.salaryPayment.deleteMany({}),
    prisma.attendance.deleteMany({}),
    prisma.employee.deleteMany({}),
    prisma.user.deleteMany({}),
  ]);

  console.log('✅ All employee records and login credentials have been completely removed!');
}

main()
  .catch((err) => {
    console.error('❌ Error deleting employee data:', err);
  })
  .finally(() => prisma.$disconnect());
