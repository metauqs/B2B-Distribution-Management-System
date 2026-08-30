import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Use Neon's connection pooler endpoint for runtime queries if hosted on Neon
if (connectionString.includes('.neon.tech') && !connectionString.includes('-pooler.')) {
  connectionString = connectionString.replace(/(\.c-[a-z0-9-]+\.)/, '-pooler$1');
}

const pool = new Pool({
  connectionString,
  max: 10, // 10 pooled connections for optimal Neon Serverless throughput
  idleTimeoutMillis: 30000, // Keep connections alive 30s between requests (reduced cold-start frequency)
  connectionTimeoutMillis: 15000,
  keepAlive: false, // Prevent TCP keepalives from keeping Neon compute awake 24/7
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
