import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import prisma from '../lib/prisma';
import { updateClientCreditRating, recalculateAllClientRatings } from '../lib/creditRisk';

async function run() {
  const client = await prisma.client.findFirst({ where: { name: 'RISK' } });
  if (client) {
    // Reset credit limit to 0
    await prisma.client.update({
      where: { id: client.id },
      data: { creditLimit: 0 }
    });
    // Recalculate all ratings
    await recalculateAllClientRatings();
    const updated = await prisma.client.findUnique({ where: { id: client.id } });
    console.log('RISK client rating after reset to 0 limit:', updated?.rating);
  }
  await prisma.$disconnect();
}
run();
