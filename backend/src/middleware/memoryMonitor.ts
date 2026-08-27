import { Request, Response, NextFunction } from 'express';

export interface MemoryStats {
  rssMb: number;
  heapTotalMb: number;
  heapUsedMb: number;
  externalMb: number;
  arrayBuffersMb: number;
}

export function getMemoryStats(): MemoryStats {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
    heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
    arrayBuffersMb: Math.round(((mem.arrayBuffers || 0) / 1024 / 1024) * 10) / 10,
  };
}

export function memoryMonitorMiddleware(req: Request, res: Response, next: NextFunction) {
  const startMem = getMemoryStats();
  const startTime = Date.now();

  res.on('finish', () => {
    const endMem = getMemoryStats();
    const duration = Date.now() - startTime;
    const isHeavy = req.path.includes('/render') || req.path.includes('/reports') || duration > 1000;

    if (isHeavy || endMem.rssMb > 350) {
      const deltaHeap = Math.round((endMem.heapUsedMb - startMem.heapUsedMb) * 10) / 10;
      const status = endMem.rssMb > 400 ? '🚨 [HIGH MEMORY]' : isHeavy ? '🧠 [MEMORY TELEMETRY]' : 'ℹ️ [MEM]';
      console.log(
        `${status} ${req.method} ${req.originalUrl} | RSS: ${endMem.rssMb}MB (Δheap: ${deltaHeap > 0 ? '+' : ''}${deltaHeap}MB) | ${duration}ms`
      );
    }
  });

  next();
}
