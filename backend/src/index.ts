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

// Import Middleware
import { authMiddleware } from './middleware/auth';

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration - support cookies across domains
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Public routes
app.use('/api/auth', authRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'OK', timestamp: new Date() });
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

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
