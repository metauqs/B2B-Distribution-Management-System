import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Ensure every request has a standardized Trace Request ID
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;

  // Skip logging health checks to avoid noise
  if (originalUrl.startsWith('/api/health')) {
    return next();
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const cacheStatus = res.getHeader('X-Cache') ? ` [${res.getHeader('X-Cache')}]` : '';

    const logMsg = `[API] ${method} ${originalUrl}${cacheStatus} ${statusCode} - ${duration}ms (reqId: ${requestId.substring(0, 8)})`;

    if (duration > 1000 || statusCode >= 500) {
      console.warn(`🔴 [API CRITICAL SLOW/FAIL] ${logMsg}`);
    } else if (duration > 500) {
      console.warn(`⚠️ [API SLOW] ${logMsg}`);
    } else {
      console.log(logMsg);
    }
  });

  next();
}
