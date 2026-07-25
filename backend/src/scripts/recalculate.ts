import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import prisma from '../lib/prisma';
import { recalculateAllClientRatings } from '../lib/creditRisk';

async function run() {
  try {
    console.log('Recalculating all client ratings...');
    const count = await recalculateAllClientRatings();
    console.log(`Success! Recalculated ratings for ${count} client(s).`);
  } catch (err: any) {
    console.error('Failed to recalculate ratings:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
