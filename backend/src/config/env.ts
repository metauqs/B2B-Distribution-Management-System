import dotenv from 'dotenv';
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// ─── Database URL ────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL && isProd) {
  console.warn('⚠️ [CONFIG WARNING] DATABASE_URL is not set in environment variables.');
}

// ─── JWT Secret Resolution ───────────────────────────────────────────────────
const DEFAULT_JWT_SECRET = 'sabzi_ledger_jwt_secret_fallback_key_2026_production_safe';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT_SECRET)) {
  console.warn('⚠️ [CONFIG WARNING] JWT_SECRET is not explicitly set in production. Using fallback secret. For optimal security, set a custom JWT_SECRET in your hosting dashboard.');
}

const resolvedJwtSecret = JWT_SECRET;
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
