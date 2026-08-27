import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Ensure upload directories exist
const uploadDir = path.join(__dirname, '../uploads/products');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Import Routers
import authRouter from './routes/auth';
import clientsRouter from './routes/clients';
import salesRouter from './routes/sales';
import purchasesRouter from './routes/purchases';
import inventoryRouter from './routes/inventory';
import collectionsRouter from './routes/collections';
import expensesRouter from './routes/expenses';
import pricelistRouter from './routes/pricelist';
import reportsRouter from './routes/reports';
import productsRouter from './routes/products';
import suppliersRouter from './routes/suppliers';
import deliveryRouter from './routes/delivery';
import driversRouter from './routes/drivers';
import vehiclesRouter from './routes/vehicles';
import broadcastsRouter from './routes/broadcasts';
import settingsRouter from './routes/settings';
import employeesRouter from './routes/employees';
import renderRouter, { warmBrowser } from './routes/render';
import cashAccountsRouter from './routes/cashAccounts';
import bankAccountsRouter from './routes/bankAccounts';

// Import Middleware
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import { idempotencyMiddleware } from './lib/idempotency';
import prisma from './lib/prisma';

import { config } from './config/env';
import { apiRateLimiter, renderRateLimiter } from './middleware/rateLimiter';
import { memoryMonitorMiddleware, getMemoryStats } from './middleware/memoryMonitor';

const app = express();
const port = config.port;

// Global memory telemetry
app.use(memoryMonitorMiddleware);

// CORS configuration - support cookies and cross-origin requests
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(requestLogger);

// Static uploads serving (disallow dotfiles and directory indexing)
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  dotfiles: 'ignore',
  index: false,
  maxAge: '1d',
}));

// Public product image serving (MUST be before authMiddleware for <img> tags in documents)
import { serveProductImageOrFallback } from './routes/products';
app.get('/api/products/image/:filename', (req, res) => {
  return serveProductImageOrFallback(req.params.filename, res, false);
});

app.get('/api/products/:id/image', async (req, res) => {
  return serveProductImageOrFallback(req.params.id, res, true);
});

// Public routes
app.use('/api/auth', authRouter);

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it'
];

// Root / ping endpoint for HTTP health monitors & load balancers
app.get('/', (req, res) => res.status(200).send('OK'));
app.head('/', (req, res) => res.status(200).end());

// Health check endpoint for UptimeRobot & Render monitoring
app.get('/api/health', (req, res) => {
  return res.status(200).json({
    status: 'online',
    provider: 'Groq',
    models: GROQ_MODELS
  });
});

// Live memory diagnostics endpoint
app.get('/api/health/memory', (req, res) => {
  return res.status(200).json({
    success: true,
    memory: getMemoryStats(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// Dedicated Public Warmup Endpoint for UptimeRobot / Keep-Alive
app.get('/api/render/warmup', (req, res) => {
  res.status(200).json({ success: true, status: 'warm' });
  warmBrowser().catch(() => {});
});

// Protected routes (Authentication strictly required)
app.use(authMiddleware);
// Idempotency middleware runs after auth so req.user is populated —
// this ensures idempotency keys are scoped per-user and per-branch,
// preventing cross-user key collisions and stale reclaims.
app.use(idempotencyMiddleware);
app.use('/api/render', renderRateLimiter, renderRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/pricelist', pricelistRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/products', productsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/broadcasts', broadcastsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/cash-accounts', cashAccountsRouter);
app.use('/api/bank-accounts', bankAccountsRouter);

// Global Error Sanitizer Middleware (Never leak DB connection strings, passwords, or traces in production)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[UNHANDLED ERROR]', err);
  if (res.headersSent) {
    return next(err);
  }
  const isProduction = config.isProd;
  const safeMessage = isProduction ? 'Internal Server Error' : (err?.message || 'Internal Server Error');
  return res.status(err?.status || err?.statusCode || 500).json({
    success: false,
    error: safeMessage,
  });
});

import { recalculateAllClientsOnStartup } from './lib/recalculateAllClients';

// Start server
app.listen(Number(port), '0.0.0.0', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${port}`);
  // Defer non-critical background recalculations by 15s to keep startup instantaneous
  setTimeout(() => {
    recalculateAllClientsOnStartup().catch(err => console.error('[STARTUP RECALC ERROR]', err));
    warmBrowser().catch(err => console.warn('[STARTUP PUPPETEER WARM-UP ERROR]', err));
  }, 15000);
});
