import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import prisma from '../lib/prisma';
import { calculateClientCreditRisk } from '../lib/creditRisk';

async function run() {
  const client = await prisma.client.findFirst({ where: { name: 'Demo4' } });
  if (client) {
    const sales = await prisma.sale.findMany({ where: { clientId: client.id, deletedAt: null } });
    const collections = await prisma.collection.findMany({ where: { clientId: client.id, deletedAt: null } });
    const risk = await calculateClientCreditRisk(client.id);
    console.log('Demo4 sales count:', sales.length);
    console.log('Demo4 collections count:', collections.length);
    console.log('Demo4 risk profile:', risk);
  }
  await prisma.$disconnect();
}
run();
