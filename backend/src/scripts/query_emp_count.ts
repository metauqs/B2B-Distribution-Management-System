import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma';

async function main() {
  const empCount = await prisma.employee.count();
  const userCount = await prisma.user.count();
  const salCount = await prisma.salaryPayment.count();
  const attCount = await prisma.attendance.count();

  console.log(`Employees: ${empCount} | Users: ${userCount} | SalaryPayments: ${salCount} | Attendance: ${attCount}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
