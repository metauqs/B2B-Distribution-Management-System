import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma';

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      isActive: true
    }
  });

  const employees = await prisma.employee.findMany({
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      isActive: true
    }
  });

  console.log("=== USERS ===");
  console.log(JSON.stringify(users, null, 2));

  console.log("\n=== EMPLOYEES ===");
  console.log(JSON.stringify(employees, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
