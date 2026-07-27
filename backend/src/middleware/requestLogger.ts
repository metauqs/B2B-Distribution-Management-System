import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Skip logging health checks to avoid noise
  if (originalUrl === '/api/health') {
    return next();
  }

  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;

    const logMsg = `[API] ${method} ${originalUrl} ${statusCode} - ${duration}ms`;

    if (duration > 1500 || statusCode >= 500) {
      console.warn(`⚠️ [SLOW/FAIL API] ${logMsg}`);
    } else {
      console.log(logMsg);
    }
  });

  next();
}
