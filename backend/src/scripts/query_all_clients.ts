import dotenv from 'dotenv';
dotenv.config();

import prisma from '../lib/prisma';

async function main() {
  const clients = await prisma.client.findMany();
  console.log(`Total Clients in DB: ${clients.length}`);
  clients.forEach((c: any) => {
    console.log(`ID: ${c.id} | ClientID: ${c.clientId} | Name: ${c.name} | Phone: ${c.phone} | DeletedAt: ${c.deletedAt}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
