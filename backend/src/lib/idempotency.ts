import { Request, Response, NextFunction } from 'express';
import prisma from './prisma';

export function getIdempotencyKey(req: Request): string | null {
  const key = (
    (req.headers['idempotency-key'] as string) ||
    (req.headers['x-idempotency-key'] as string) ||
    (req.body && req.body.idempotencyKey)
  )?.trim();

  return key && key.length > 0 ? key : null;
}

export function buildScopedKey(req: Request, rawKey: string): string {
  const userId = (req.headers['x-user-id'] as string) || (req as any).user?.id || 'anon';
  const branchId = (req.headers['x-branch-id'] as string) || 'branch_main';
  const cleanPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0];
  return `${branchId}:${userId}:${req.method}:${cleanPath}:${rawKey}`;
}

/**
 * Atomically claims or retrieves an idempotency key.
 * Uses PostgreSQL UNIQUE constraint on `key` to block parallel race conditions.
 */
export async function claimIdempotencyKey(
  scopedKey: string,
  endpoint: string
): Promise<{ isDuplicate: boolean; record?: any }> {
  if (!scopedKey) return { isDuplicate: false };

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hr TTL
  // Must exceed the max transaction timeout (120s) + network overhead.
  // If a record stays PROCESSING for longer than this, the server likely crashed.
  const STALE_THRESHOLD_MS = 150 * 1000; // 150s — safely above the 120s tx timeout

  // 1. Attempt atomic insert
  try {
    const pending = await prisma.idempotencyRecord.create({
      data: {
        key: scopedKey,
        endpoint,
        response: { status: 'PROCESSING' } as any,
        statusCode: 202,
        expiresAt
      }
    });
    return { isDuplicate: false, record: pending };
  } catch (err: any) {
    // Unique constraint violation (P2002) means record already exists
    if (err.code === 'P2002') {
      const existing = await prisma.idempotencyRecord.findUnique({ where: { key: scopedKey } });
      if (!existing) {
        return { isDuplicate: false };
      }

      // Check if stale in PROCESSING (e.g. server crashed >60s ago)
      const resObj = existing.response as Record<string, any> | null;
      const isProcessing = existing.statusCode === 202 || resObj?.status === 'PROCESSING';
      const ageMs = Date.now() - new Date(existing.createdAt).getTime();

      if (isProcessing && ageMs > STALE_THRESHOLD_MS) {
        // Atomic reclaim: update only if still 202
        try {
          const reclaimed = await prisma.idempotencyRecord.update({
            where: { key: scopedKey },
            data: {
              createdAt: new Date(),
              statusCode: 202,
              response: { status: 'PROCESSING' } as any,
              expiresAt
            }
          });
          return { isDuplicate: false, record: reclaimed };
        } catch {
          // Reclaim race lost, treat as duplicate
          return { isDuplicate: true, record: existing };
        }
      }

      return { isDuplicate: true, record: existing };
    }
    throw err;
  }
}

/**
 * Updates an idempotency record with the final response payload and status code.
 */
export async function saveIdempotencyResponse(
  scopedKey: string,
  response: any,
  statusCode: number = 200
) {
  if (!scopedKey) return;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await prisma.idempotencyRecord.upsert({
      where: { key: scopedKey },
      update: {
        response: response as any,
        statusCode,
        expiresAt
      },
      create: {
        key: scopedKey,
        endpoint: '/api',
        response: response as any,
        statusCode,
        expiresAt
      }
    });
  } catch (err: any) {
    console.error(`[Idempotency] Failed to save final response for key ${scopedKey}:`, err.message);
  }
}

/**
 * Global Express middleware for Idempotency Protection.
 * Intercepts duplicate POST/PUT/PATCH/DELETE requests and returns the cached result.
 */
export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const rawKey = getIdempotencyKey(req);

  if (!rawKey || (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE')) {
    return next();
  }

  // Skip auth routes (login / refresh) from idempotency
  if (req.originalUrl.includes('/api/auth/')) {
    return next();
  }

  const scopedKey = buildScopedKey(req, rawKey);

  try {
    const claim = await claimIdempotencyKey(scopedKey, req.originalUrl);

    if (claim.isDuplicate && claim.record) {
      console.log(`[Idempotency] Intercepted duplicate ${req.method} ${req.originalUrl} with key: ${scopedKey}`);
      
      const resObj = claim.record.response as Record<string, any> | null;

      // If the original request is still processing, poll until it completes.
      // Poll for up to 30 seconds (150 × 200ms) — covers the full 120s tx timeout.
      if (claim.record.statusCode === 202 || resObj?.status === 'PROCESSING') {
        for (let i = 0; i < 150; i++) {
          await new Promise(r => setTimeout(r, 200));
          const updated = await prisma.idempotencyRecord.findUnique({ where: { key: scopedKey } });
          const updatedRes = updated?.response as Record<string, any> | null;
          if (updated && updated.statusCode !== 202 && updatedRes?.status !== 'PROCESSING') {
            return res.status(updated.statusCode).json(updated.response);
          }
        }

        // Still processing after 30 seconds — inform client to wait and retry
        return res.status(409).json({
          success: false,
          inProgress: true,
          error: 'Invoice is being generated. Please wait a moment — do not click again. Your invoice will appear shortly.'
        });
      }

      return res.status(claim.record.statusCode || 200).json(claim.record.response);
    }

    // Intercept res.json to capture response payload
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      const statusCode = res.statusCode || 200;

      if (statusCode >= 200 && statusCode < 300) {
        saveIdempotencyResponse(scopedKey, body, statusCode);
      }

      return originalJson(body);
    };

    next();
  } catch (err: any) {
    console.error('[Idempotency Middleware Error]:', err);
    next();
  }
}
