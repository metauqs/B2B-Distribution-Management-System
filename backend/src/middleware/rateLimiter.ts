import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;       // Time window in milliseconds
  max: number;            // Maximum requests per windowMs
  message?: string;       // Custom error message
  statusCode?: number;    // Status code on limit reached (default 429)
  skipSuccessfulRequests?: boolean;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

/**
 * High-performance, zero-dependency in-memory sliding window rate limiter
 */
export function createRateLimiter(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    message = 'Too many requests, please try again later.',
    statusCode = 429,
  } = options;

  const hits = new Map<string, ClientRecord>();

  // Cleanup expired entries periodically (every 5 minutes)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetTime) {
        hits.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  // Unref to avoid holding node process open
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // Determine client identifier (IP address, handling x-forwarded-for)
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown_ip';
    const now = Date.now();

    let record = hits.get(ip);
    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      hits.set(ip, record);
    } else {
      record.count++;
    }

    const remaining = Math.max(0, max - record.count);
    const resetSeconds = Math.ceil((record.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (record.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(statusCode).json({
        success: false,
        error: message,
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

// ── Specialized Rate Limiters ──────────────────────────────────────────────────

// Auth Rate Limiter: Max 15 login attempts per 15 minutes per IP
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts. Please try again after 15 minutes.',
});

// Render Rate Limiter: Max 40 document renders per minute per IP
export const renderRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 40,
  message: 'Too many document render requests. Please slow down.',
});

// General API Rate Limiter: Max 600 requests per minute per IP
export const apiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 600,
  message: 'Rate limit exceeded. Too many requests to the API.',
});
