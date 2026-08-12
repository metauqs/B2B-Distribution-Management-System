-- 3NF Normalization Phase 2 — Additive Schema Changes
-- PRODUCTION SAFE: No data deletion, no table drops, no PK changes

-- ============================================================================
-- 1. Create ExpenseCategoryRef table (normalizes ExpenseCategory enum to table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS "expense_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "expense_categories_name_key" ON "expense_categories"("name");

-- ============================================================================
-- 2. Add categoryRefId FK column to expenses table
-- ============================================================================
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "categoryRefId" TEXT;

CREATE INDEX IF NOT EXISTS "expenses_categoryRefId_idx" ON "expenses"("categoryRefId");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryRefId_fkey"
    FOREIGN KEY ("categoryRefId") REFERENCES "expense_categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 3. Add RETURN to StockMovementType enum
-- ============================================================================
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RETURN';

-- ============================================================================
-- 4. Add new FinancialLedger typed enum types
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE "FinancialTransactionType" AS ENUM (
        'SALE', 'PURCHASE', 'COLLECTION', 'EXPENSE',
        'WASTAGE', 'ADJUSTMENT', 'SALARY', 'RETURN'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "FinancialEntryType" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "AccountCategory" AS ENUM (
        'REVENUE', 'COGS', 'ASSET_RECEIVABLE', 'ASSET_CASH', 'ASSET_BANK',
        'ASSET_INVENTORY', 'LIABILITY_PAYABLE', 'EXPENSE_OPERATING',
        'EXPENSE_WASTAGE', 'DIRECT_COST'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "FinancialEntityType" AS ENUM ('CLIENT', 'SUPPLIER', 'PRODUCT', 'EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 5. Add typed enum columns to financial_ledger table
-- ============================================================================
ALTER TABLE "financial_ledger" ADD COLUMN IF NOT EXISTS "txType" "FinancialTransactionType";
ALTER TABLE "financial_ledger" ADD COLUMN IF NOT EXISTS "entType" "FinancialEntryType";
ALTER TABLE "financial_ledger" ADD COLUMN IF NOT EXISTS "acctCategory" "AccountCategory";
ALTER TABLE "financial_ledger" ADD COLUMN IF NOT EXISTS "entEntityType" "FinancialEntityType";

CREATE INDEX IF NOT EXISTS "financial_ledger_txType_idx" ON "financial_ledger"("txType");
