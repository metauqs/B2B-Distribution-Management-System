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
  max: 4, // Conservative connection pool cap to conserve RAM on 512MB Render instances
  idleTimeoutMillis: 5000, // Quickly release idle database sockets
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  ssl: connectionString.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

export { prisma };
export default prisma;
