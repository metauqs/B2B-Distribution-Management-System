import dotenv from 'dotenv';
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// ─── Database URL Validation ─────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && isProd) {
  throw new Error('FATAL: DATABASE_URL environment variable is required in production.');
}

// ─── JWT Secret Validation ───────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (isProd && (!JWT_SECRET || JWT_SECRET === 'sabzi_ledger_jwt_secret_dev_only_change_in_production' || JWT_SECRET.length < 32)) {
  throw new Error(
    'FATAL: In production, JWT_SECRET must be set in your environment variables and must be at least 32 characters long.'
  );
}

const resolvedJwtSecret = JWT_SECRET || 'sabzi_ledger_jwt_secret_dev_only_change_in_production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ─── Server & CORS Configuration ─────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ─── Initial Admin Bootstrap Credentials (Optional) ─────────────────────────
const INITIAL_ADMIN_EMPLOYEE_ID = process.env.INITIAL_ADMIN_EMPLOYEE_ID || '1234';
const INITIAL_ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';

export const config = {
  env: NODE_ENV,
  isProd,
  port: PORT,
  databaseUrl: DATABASE_URL || '',
  jwt: {
    secret: resolvedJwtSecret,
    expiresIn: JWT_EXPIRES_IN,
  },
  frontendUrl: FRONTEND_URL,
  initialAdmin: {
    employeeId: INITIAL_ADMIN_EMPLOYEE_ID,
    password: INITIAL_ADMIN_PASSWORD,
  },
};

export default config;
