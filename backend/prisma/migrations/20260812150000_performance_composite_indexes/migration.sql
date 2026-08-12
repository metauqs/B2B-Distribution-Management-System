-- Performance Optimization Phase — Additive Composite Database Indexes
-- Production Safe: Creates indexes IF NOT EXISTS to accelerate relational lookups

CREATE INDEX IF NOT EXISTS "sales_clientId_date_idx" ON "sales"("clientId", "date");
CREATE INDEX IF NOT EXISTS "sales_status_date_idx" ON "sales"("status", "date");
CREATE INDEX IF NOT EXISTS "collections_clientId_date_idx" ON "collections"("clientId", "date");
CREATE INDEX IF NOT EXISTS "stock_movements_productId_branchId_date_idx" ON "stock_movements"("productId", "branchId", "date");
CREATE INDEX IF NOT EXISTS "customer_ledger_clientId_date_createdAt_idx" ON "customer_ledger"("clientId", "date", "createdAt");
CREATE INDEX IF NOT EXISTS "financial_ledger_branchId_date_idx" ON "financial_ledger"("branchId", "date");
CREATE INDEX IF NOT EXISTS "financial_ledger_transactionType_date_idx" ON "financial_ledger"("transactionType", "date");
