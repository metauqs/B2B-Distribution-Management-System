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

/**
 * Atomically claims or retrieves an idempotency key.
 * Uses PostgreSQL UNIQUE constraint on `key` to block parallel race conditions.
 */
export async function claimIdempotencyKey(
  key: string,
  endpoint: string
): Promise<{ isDuplicate: boolean; record?: any }> {
  if (!key) return { isDuplicate: false };

  // 1. Check if record already exists
  const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });
  if (existing) {
    return { isDuplicate: true, record: existing };
  }

  // 2. Atomically insert pending record enforcing DB unique constraint
  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hr TTL
    const pending = await prisma.idempotencyRecord.create({
      data: {
        key,
        endpoint,
        response: { status: 'PROCESSING' } as any,
        statusCode: 202,
        expiresAt
      }
    });
    return { isDuplicate: false, record: pending };
  } catch (err: any) {
    // Unique constraint violation (P2002) means a concurrent request claimed this key
    if (err.code === 'P2002') {
      const rec = await prisma.idempotencyRecord.findUnique({ where: { key } });
      return { isDuplicate: true, record: rec };
    }
    throw err;
  }
}

/**
 * Updates an idempotency record with the final response payload and status code.
 */
export async function saveIdempotencyResponse(
  key: string,
  response: any,
  statusCode: number = 200
) {
  if (!key) return;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  try {
    await prisma.idempotencyRecord.upsert({
      where: { key },
      update: {
        response: response as any,
        statusCode,
        expiresAt
      },
      create: {
        key,
        endpoint: '/api',
        response: response as any,
        statusCode,
        expiresAt
      }
    });
  } catch (err: any) {
    console.error(`[Idempotency] Failed to save final response for key ${key}:`, err.message);
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
  const key = getIdempotencyKey(req);

  if (!key || (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE')) {
    return next();
  }

  try {
    const claim = await claimIdempotencyKey(key, req.originalUrl);

    if (claim.isDuplicate && claim.record) {
      console.log(`[Idempotency] Intercepted duplicate ${req.method} ${req.originalUrl} with key: ${key}`);
      
      const resObj = claim.record.response as Record<string, any> | null;

      // If the original request is still processing, wait briefly or return 202
      if (claim.record.statusCode === 202 || resObj?.status === 'PROCESSING') {
        // Poll for up to 3 seconds for the original request to complete
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 200));
          const updated = await prisma.idempotencyRecord.findUnique({ where: { key } });
          const updatedRes = updated?.response as Record<string, any> | null;
          if (updated && updated.statusCode !== 202 && updatedRes?.status !== 'PROCESSING') {
            return res.status(updated.statusCode).json(updated.response);
          }
        }
      }

      return res.status(claim.record.statusCode || 200).json(claim.record.response);
    }

    // Intercept res.json to capture response payload
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      const statusCode = res.statusCode || 200;

      if (statusCode >= 200 && statusCode < 300) {
        saveIdempotencyResponse(key, body, statusCode);
      }

      return originalJson(body);
    };

    next();
  } catch (err: any) {
    console.error('[Idempotency Middleware Error]:', err);
    next();
  }
}
