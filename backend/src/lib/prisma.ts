import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

let connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

// Auto-normalize deprecated PostgreSQL SSL modes to eliminate warnings
if (connectionString.includes('sslmode=require')) {
  connectionString = connectionString.replace(/sslmode=require/g, 'sslmode=verify-full');
} else if (connectionString.includes('sslmode=prefer')) {
  connectionString = connectionString.replace(/sslmode=prefer/g, 'sslmode=verify-full');
}

const pool = new Pool({
  connectionString,
  max: 15, // Optimal connection pool to allow concurrent dashboard aggregations without queuing
  idleTimeoutMillis: 30000, // Keep warm sockets alive for 30s
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['error'],
});

export { prisma };
export default prisma;
