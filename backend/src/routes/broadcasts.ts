import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// ── In-Memory cache for broadcasts (30s TTL) ────────────────────────────────
const BROADCAST_CACHE = new Map<string, { ts: number; data: any }>();
const BROADCAST_CACHE_TTL = 300000;
const BROADCAST_IN_FLIGHT = new Map<string, Promise<any>>();

export function clearBroadcastCache(): void {
  BROADCAST_CACHE.clear();
  BROADCAST_IN_FLIGHT.clear();
}

// GET /api/broadcasts
router.get('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  try {
    const cached = BROADCAST_CACHE.get(branchId);
    if (cached && (Date.now() - cached.ts) < BROADCAST_CACHE_TTL) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ success: true, data: cached.data });
    }

    if (BROADCAST_IN_FLIGHT.has(branchId)) {
      const coalesced = await BROADCAST_IN_FLIGHT.get(branchId);
      res.setHeader('X-Cache', 'COALESCED');
      return res.json({ success: true, data: coalesced });
    }

    const fetchBroadcastsPromise = prisma.priceBroadcast.findMany({
      where: { branchId },
      include: {
        sentByUser: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    BROADCAST_IN_FLIGHT.set(branchId, fetchBroadcastsPromise);
    try {
      const broadcasts = await fetchBroadcastsPromise;
      if (BROADCAST_CACHE.size >= 50) BROADCAST_CACHE.clear();
      BROADCAST_CACHE.set(branchId, { ts: Date.now(), data: broadcasts });
      res.setHeader('X-Cache', 'MISS');
      return res.json({ success: true, data: broadcasts });
    } finally {
      BROADCAST_IN_FLIGHT.delete(branchId);
    }
  } catch (err: any) {
    console.error('[GET /api/broadcasts]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

// POST /api/broadcasts
router.post('/', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  const userId = (req.headers['x-user-id'] as string) || null;
  if (!branchId || !userId) {
    return res.status(400).json({ success: false, error: 'Auth credentials missing' });
  }

  const { priceListDate, filterType, categories, selectedClientIds, customMessage, imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ success: false, error: 'Broadcast image is required' });
  }

  try {
    let clientsWhere: any = { branchId, status: 'ACTIVE', deletedAt: null };
    if (filterType === 'CATEGORY' && categories && categories.length > 0) {
      clientsWhere.type = { in: categories };
    } else if (filterType === 'SELECTED' && selectedClientIds && selectedClientIds.length > 0) {
      clientsWhere.id = { in: selectedClientIds };
    }

    const clients = await prisma.client.findMany({
      where: clientsWhere
    });

    if (clients.length === 0) {
      return res.status(400).json({ success: false, error: 'No active recipients found for selected criteria' });
    }

    const broadcast = await prisma.priceBroadcast.create({
      data: {
        branchId,
        sentByUserId: userId,
        priceListDate: priceListDate ? new Date(priceListDate) : new Date(),
        imageUrl,
        totalRecipients: clients.length,
        status: 'PROCESSING'
      }
    });

    const recipientsData = clients.map(client => {
      const rawNo = client.whatsapp || client.phone || '';
      const cleanNo = rawNo.replace(/[^0-9+]/g, '');
      const isInvalid = cleanNo.length < 7;

      return {
        broadcastId: broadcast.id,
        clientId: client.id,
        whatsappNumber: rawNo,
        status: isInvalid ? 'FAILED' as const : 'PENDING' as const,
        errorMessage: isInvalid ? 'Invalid WhatsApp number format' : null
      };
    });

    await prisma.broadcastRecipient.createMany({
      data: recipientsData
    });

    const createdRecipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: broadcast.id }
    });

    const invalidCount = recipientsData.filter(r => r.status === 'FAILED').length;
    if (invalidCount > 0) {
      await prisma.priceBroadcast.update({
        where: { id: broadcast.id },
        data: {
          failureCount: invalidCount
        }
      });
    }

    simulateDispatch(broadcast.id, createdRecipients);

    return res.json({ success: true, data: broadcast });
  } catch (err: any) {
    console.error('[POST /api/broadcasts]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

// ── In-Memory cache for Broadcast & Branding Settings (5 min TTL) ───────────
const BROADCAST_SETTINGS_CACHE = new Map<string, { ts: number; data: any }>();
const BROADCAST_SETTINGS_CACHE_TTL = 300000;

export function clearBroadcastSettingsCache(): void {
  BROADCAST_SETTINGS_CACHE.clear();
}

// GET /api/broadcasts/settings
router.get('/settings', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const cached = BROADCAST_SETTINGS_CACHE.get(branchId);
  if (cached && (Date.now() - cached.ts) < BROADCAST_SETTINGS_CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.json({ success: true, data: cached.data });
  }

  try {
    let settings = await prisma.broadcastSettings.findUnique({
      where: { branchId }
    });

    if (!settings) {
      settings = await prisma.broadcastSettings.create({
        data: {
          branchId,
          companyName: 'HALAL VEGG SUPPLIES',
          defaultGreeting: "Assalam-o-Alaikum {{ClientName}}\n\nPlease find today's fresh fruit & vegetable rates.\n\nThank you for choosing HALAL VEGG SUPPLIES.",
          defaultBroadcastTime: '09:00',
          defaultImageTemplate: 'default'
        }
      });
    }

    BROADCAST_SETTINGS_CACHE.set(branchId, { ts: Date.now(), data: settings });
    res.setHeader('X-Cache', 'MISS');
    return res.json({ success: true, data: settings });
  } catch (err: any) {
    console.error('[GET /api/broadcasts/settings]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

// POST /api/broadcasts/settings
router.post('/settings', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { companyLogo, companyName, defaultGreeting, defaultFooter, defaultBroadcastTime, defaultImageTemplate } = req.body;

  try {
    const settings = await prisma.broadcastSettings.upsert({
      where: { branchId },
      update: {
        companyLogo,
        companyName: companyName || 'HALAL VEGG SUPPLIES',
        defaultGreeting: defaultGreeting ?? '',
        defaultFooter,
        defaultBroadcastTime: defaultBroadcastTime || '09:00',
        defaultImageTemplate: defaultImageTemplate || 'default'
      },
      create: {
        branchId,
        companyLogo,
        companyName: companyName || 'HALAL VEGG SUPPLIES',
        defaultGreeting: defaultGreeting ?? '',
        defaultFooter,
        defaultBroadcastTime: defaultBroadcastTime || '09:00',
        defaultImageTemplate: defaultImageTemplate || 'default'
      }
    });

    BROADCAST_SETTINGS_CACHE.set(branchId, { ts: Date.now(), data: settings });
    return res.json({ success: true, data: settings });
  } catch (err: any) {
    console.error('[POST /api/broadcasts/settings]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

// GET /api/broadcasts/:id
router.get('/:id', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { id } = req.params;

  try {
    const broadcast = await prisma.priceBroadcast.findFirst({
      where: { id, branchId },
      include: {
        sentByUser: { select: { name: true } },
        recipients: { include: { client: { select: { name: true } } } },
      },
    });

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Broadcast not found' });
    }

    return res.json({ success: true, data: broadcast });
  } catch (err: any) {
    console.error('[GET /api/broadcasts/:id]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

// POST /api/broadcasts/:id/retry
router.post('/:id/retry', async (req: Request, res: Response) => {
  const branchId = req.headers['x-branch-id'] as string;
  if (!branchId) return res.status(400).json({ success: false, error: 'Missing branch' });

  const { id } = req.params;

  try {
    const broadcast = await prisma.priceBroadcast.findFirst({
      where: { id, branchId },
      include: { recipients: true },
    });

    if (!broadcast) {
      return res.status(404).json({ success: false, error: 'Broadcast not found' });
    }

    // Reset status to PROCESSING
    await prisma.priceBroadcast.update({
      where: { id },
      data: { status: 'PROCESSING' },
    });

    const failedRecipients = broadcast.recipients.filter(r => r.status === 'FAILED');
    
    // Reset failed recipients status to PENDING
    const updatedRecipients = [];
    for (const r of failedRecipients) {
      const rec = await prisma.broadcastRecipient.update({
        where: { id: r.id },
        data: { status: 'PENDING', errorMessage: null }
      });
      updatedRecipients.push(rec);
    }

    // Run async dispatch simulation
    simulateDispatch(id, [...broadcast.recipients.filter(r => r.status !== 'FAILED'), ...updatedRecipients]);

    return res.json({ success: true, message: `Retrying ${failedRecipients.length} failed recipients` });
  } catch (err: any) {
    console.error('[POST /api/broadcasts/:id/retry]', err);
    return res.status(500).json({ success: false, error: err.message ?? 'Internal server error' });
  }
});

async function simulateDispatch(broadcastId: string, recipients: any[]) {
  const pendingRecipients = recipients.filter(r => r.status === 'PENDING');
  
  let success = 0;
  let failure = recipients.filter(r => r.status === 'FAILED').length;

  for (let i = 0; i < pendingRecipients.length; i++) {
    const rec = pendingRecipients[i];
    
    await new Promise(resolve => setTimeout(resolve, 800));

    const isMockFailure = rec.whatsappNumber.endsWith('9') || rec.whatsappNumber.includes('99');
    const finalStatus = isMockFailure ? 'FAILED' : 'DELIVERED';
    
    await prisma.broadcastRecipient.update({
      where: { id: rec.id },
      data: {
        status: finalStatus,
        lastAttemptAt: new Date(),
        attempts: 1,
        errorMessage: isMockFailure ? 'Gateway timeout or route congestion' : null
      }
    });

    if (finalStatus === 'DELIVERED') {
      success++;
    } else {
      failure++;
    }

    await prisma.priceBroadcast.update({
      where: { id: broadcastId },
      data: {
        successCount: success,
        failureCount: failure
      }
    });
  }

  await prisma.priceBroadcast.update({
    where: { id: broadcastId },
    data: {
      status: 'COMPLETED'
    }
  });
}

export default router;
