import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
import renderRouter from './routes/render';
import cashAccountsRouter from './routes/cashAccounts';
import bankAccountsRouter from './routes/bankAccounts';

// Import Middleware
import { authMiddleware } from './middleware/auth';
import { requestLogger } from './middleware/requestLogger';
import prisma from './lib/prisma';

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration - support cookies and cross-origin requests
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(requestLogger);

// Public routes
app.use('/api/auth', authRouter);

// Health check with DB ping option to keep Render + Neon connections warm
app.get('/api/health', async (req, res) => {
  const pingDb = req.query.pingDb === 'true';
  const now = new Date().toISOString();

  if (pingDb) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('[HEALTH] Database ping successful');
      return res.status(200).json({
        status: 'ok',
        service: 'backend',
        database: 'connected',
        timestamp: now,
      });
    } catch (err: any) {
      console.error('[HEALTH] Database ping failed');
      return res.status(503).json({
        status: 'error',
        service: 'backend',
        database: 'disconnected',
        error: 'Database connection check failed',
        timestamp: now,
      });
    }
  }

  console.log('[HEALTH] Backend health check successful');
  return res.status(200).json({
    status: 'ok',
    service: 'backend',
    timestamp: now,
  });
});

// Render routes (public to allow direct PDF/PNG downloads)
app.use('/api/render', renderRouter);

// Protected routes
app.use(authMiddleware);
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

// Start server
app.listen(Number(port), '0.0.0.0', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${port}`);
});
