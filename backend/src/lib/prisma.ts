import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Keep connectionString as-is to preserve Neon compatibility

const pool = new Pool({
  connectionString,
  max: 10, // 10 pooled connections for optimal Neon Serverless throughput
  idleTimeoutMillis: 60000, // Keep warm sockets alive for 60s
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});

pool.on('error', (err: any) => {
  console.warn('PostgreSQL connection pool client error (auto-reconnecting):', err?.message || err);
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['error'],
});

export { prisma };
export default prisma;
