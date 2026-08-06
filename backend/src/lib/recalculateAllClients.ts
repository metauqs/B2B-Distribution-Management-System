import prisma from './prisma';
import { recalculateClientLedgerAndBalance } from './business';

export async function recalculateAllClientsOnStartup(): Promise<void> {
  try {
    const clients = await prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true }
    });
    for (const c of clients) {
      await recalculateClientLedgerAndBalance(c.id);
    }
  } catch (err) {
    console.error('[recalculateAllClientsOnStartup]', err);
  }
}
