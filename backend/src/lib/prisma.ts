import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Keep connectionString as-is to preserve Neon compatibility

const pool = new Pool({
  connectionString,
  max: 6, // 6 pooled connections is optimal for Neon Serverless to prevent socket exhaustion and contention
  idleTimeoutMillis: 30000, // Keep warm sockets alive for 30s
  connectionTimeoutMillis: 15000,
  keepAlive: true,
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
