# 🥬 B2B Distribution Management System (HALAL VEGG SUPPLIES)

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=flat-square&logo=react)](https://react.dev/)
[![Express.js](https://img.shields.io/badge/Express-4.19-000000?style=flat-square&logo=express)](https://expressjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.9-2D3748?style=flat-square&logo=prisma)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?style=flat-square&logo=postgresql)](https://neon.tech/)
[![Vercel](https://img.shields.io/badge/Vercel-Deployment-000000?style=flat-square&logo=vercel)](https://vercel.com/)
[![Render](https://img.shields.io/badge/Render-Backend-46E3B7?style=flat-square&logo=render)](https://render.com/)

A production-grade, full-stack **B2B Produce Distribution & Supply Chain ERP Management System** designed for **HALAL VEGG SUPPLIES**. 

The system digitizes the end-to-end B2B distribution lifecycle: **Mandi Procurement $\rightarrow$ Moving Average Inventory Valuation $\rightarrow$ Daily Customer Price Sheets $\rightarrow$ In-Memory Draft Sales & Atomic Invoice Generation $\rightarrow$ Logistics & Delivery Dispatch $\rightarrow$ Due Recovery & Collections $\rightarrow$ Financial Accounting & Business Day Executive Analytics**.

---

## 📋 Table of Contents

- [Overview & Business Context](#-overview--business-context)
- [System Architecture & Request Flow](#-system-architecture--request-flow)
- [Repository Folder Structure](#-repository-folder-structure)
- [Core Features & ERP Modules](#-core-features--erp-modules)
- [Business Workflow Lifecycle](#-business-workflow-lifecycle)
- [Tech Stack](#-tech-stack)
- [Installation & Local Setup Guide](#-installation--local-setup-guide)
- [Environment Variables Reference](#-environment-variables-reference)
- [Production Deployment Guide](#-production-deployment-guide)
- [Security Architecture](#-security-architecture)
- [Performance & Caching Optimizations](#-performance--caching-optimizations)
- [UI Screenshots](#-ui-screenshots)
- [Future Enhancements](#-future-enhancements)
- [License & Credits](#-license--credits)

---

## 🎯 Overview & Business Context

**HALAL VEGG SUPPLIES** operates a high-frequency B2B fresh vegetable and fruit distribution business supplying restaurants, hotels, catering companies, retail stores, and hostels.

### Core Domain Challenges Solved:
1. **5:00 AM Business Day Boundary**: Business operations start at **05:00 AM** every morning and conclude at **04:59:59 AM** the following calendar day. All sales, purchases, collections, and reports strictly adhere to this 5:00 AM business day cutoff instead of standard calendar midnight.
2. **Moving Weighted Average Cost Inventory**: Replaces naive latest-purchase rate valuation with financially accurate Weighted Moving Average valuation ($\text{New Avg Cost} = \frac{\text{Old Value} + \text{New Purchase Value}}{\text{Old Qty} + \text{New Qty}}$) while preserving dual visibility into the **Latest Purchase Price (`currentBuyPrice`)**.
3. **Atomic Invoice Commit Logic**: Invoice drafts remain strictly in React local component state during customer selection and product entry. Financial ledgers, inventory stock, customer dues, and delivery records are updated **only when the user explicitly clicks "Generate Invoice"** inside a single database transaction.
4. **Urdu Document Pipeline**: Native PDF, JPG, and WhatsApp voucher export pipelines rendered via offscreen canvas SVG engines to guarantee proper right-to-left Arabic/Urdu cursive character joining.

---

## 🏗️ System Architecture & Request Flow

The system is decoupled into a high-performance **Next.js 16 Frontend App** and a scalable **Express.js REST API Backend** connected to a **Cloud PostgreSQL (Neon)** instance via Prisma ORM v7 with native connection pooling (`@prisma/adapter-pg`).

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSER / CLIENT UI                           │
│              Next.js 16 App Router (React 19, TypeScript, CSS)          │
│            Redux Toolkit + SWR Cache Store (`cacheStore.ts`)            │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     │ HTTP REST Requests
                                     │ Bearer JWT / X-Branch-ID Header
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            EXPRESS.JS BACKEND                           │
│               Node.js REST API Controllers (`/backend/src/routes`)      │
│           JWT Auth Middleware + Role-Based Access Control (RBAC)        │
│          Business Date Service (5:00 AM Karachi Timezone Cutoff)       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     │ Type-safe Prisma Queries
                                     │ Atomic `prisma.$transaction`
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                               PRISMA ORM                                │
│               Prisma v7 (`@prisma/client` + `@prisma/adapter-pg`)       │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     │ Encrypted SSL Connection Pool
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE                              │
│                Cloud Managed Neon PostgreSQL Database Server            │
└─────────────────────────────────────────────────────────────────────────┘
```

### Authentication & Authorization Flow
1. **Credentials**: Staff members log in using an assigned **4-digit Permanent Employee ID** (e.g. `0073`) and password.
2. **JWT Issuance**: Backend verifies credentials with `bcryptjs` and signs a JSON Web Token containing `id`, `employeeId`, `role`, and `branchId`.
3. **Auto-Refresh**: Client request wrapper (`apiFetch.ts`) intercepts `401 Unauthorized` responses and silently executes token refresh.
4. **RBAC Guarding**: Routes are guarded by role constraints (`ADMIN`, `MANAGER`, `DELIVERY_STAFF`).

---

## 📂 Repository Folder Structure

```text
HalalVeggSupplies/
├── frontend/                        # Next.js 16 Frontend Web Application
│   ├── src/
│   │   ├── app/                     # Next.js App Router Page Routes
│   │   │   ├── collections/         # Due Bills & Payment Recovery Module
│   │   │   ├── delivery/            # Delivery Dispatch & Logistics Module
│   │   │   ├── inventory/           # Moving Avg Stock Hub & Wastage Module
│   │   │   ├── pricelist/           # Customer Daily Price Sheets & Margin Hub
│   │   │   ├── purchases/           # Mandi Procurement & StockIn Entry
│   │   │   ├── reports/             # PnL, Cashflow & Registry Analytics
│   │   │   ├── sales/               # Order Entry & Invoice Generation Wizard
│   │   │   ├── clients/             # Customer Profiles & Opening Dues
│   │   │   └── page.tsx             # Executive Business-Date Dashboard
│   │   ├── components/              # Reusable UI Components
│   │   │   ├── layout/              # Navigation Header & Dashboard Layout
│   │   │   └── ui/                  # Mobile Cards, Skeletons, Autocomplete
│   │   ├── hooks/                   # Custom React Hooks (`usePreservedState`)
│   │   ├── store/                   # Redux Toolkit State Slices
│   │   └── utils/                   # Central Utilities
│   │       ├── apiFetch.ts          # Resilient Request Wrapper (45s Timeout & Auth)
│   │       ├── businessDate.ts      # Frontend 5:00 AM Business Date Utilities
│   │       ├── cacheStore.ts        # Stale-While-Revalidate SWR Cache Layer
│   │       ├── documentTemplates.ts # Offscreen Urdu PDF/JPG Invoice Generator
│   │       └── formatters.ts        # Currency (PKR) & Date Formatters
│   ├── public/                      # Static Brand Assets & 🥬 Favicons
│   └── package.json
│
├── backend/                         # Express.js REST API Backend Application
│   ├── src/
│   │   ├── index.ts                 # Server Initialization & Express Config
│   │   ├── lib/                     # Central Business Logic Services
│   │   │   ├── businessDate.ts      # Backend 5:00 AM Business Day Service
│   │   │   ├── inventoryService.ts  # Weighted Moving Avg & Stock Movement Engine
│   │   │   ├── prisma.ts            # Prisma Connection Pool & Adapter Instance
│   │   │   └── business.ts          # Invoice Sequence Generator & Audit Logger
│   │   ├── middleware/              # Auth & RBAC Security Middlewares
│   │   └── routes/                  # Express API Controllers
│   │       ├── sales.ts             # Atomic Checkout & Sales Routes
│   │       ├── purchases.ts         # Mandi Procurement & Edit Purchase Routes
│   │       ├── inventory.ts         # Stock Valuation & Manual Adjustment Routes
│   │       ├── pricelist.ts         # Customer Selling Price Sheet Routes
│   │       ├── collections.ts       # Due Bills & Payment Entry Routes
│   │       ├── delivery.ts          # Delivery Schedule & Status Update Routes
│   │       ├── reports.ts           # Executive Dashboard & Financial Reports
│   │       └── clients.ts           # Client Management & Opening Balance Routes
│   ├── prisma/
│   │   ├── schema.prisma            # Database Schema Definitions
│   │   └── seed.ts                  # Production Database Seeder
│   └── package.json
│
├── docker-compose.yml               # Local Development PostgreSQL Container Config
├── .env.example                     # Environment Variables Template
└── README.md                        # Project Documentation
```

---

## ⚡ Core Features & ERP Modules

### 1. 📊 Executive Business-Date Dashboard (`/`)
- **Live 5:00 AM Business Day Tracking**: Automatically displays real-time statistics for the active business day.
- **Historical Analytics Date Selector**: Date picker (`[ YYYY-MM-DD ]`) allows admins to inspect exact business day snapshots (e.g. `05 Aug 2026`) without modifying past records.
- **Real-Time KPIs**: Total Sales, Cash Sales, Credit Sales, Avg Order Value, Purchases, Expenses, Gross Profit, Net Profit, Inventory Asset Value, Collections, Completed/Failed Deliveries, and Low Stock Alerts.

### 2. 🧾 Sales & Billing (`/sales`)
- **3-Step Order Entry Wizard**: Step 1 (Select Client) $\rightarrow$ Step 2 (Select Items & Enter Quantities) $\rightarrow$ Step 3 (Review & Pay).
- **In-Memory Draft Isolation**: Order creation remains strictly in local React state until the user clicks **"Generate Invoice"**.
- **Atomic Checkout**: Generates sequential invoice number (`INV-XXXX-XXXX`), creates sale records, deducts inventory stock (`stockOut`), logs customer ledger debit, records payment collection (if paid), and updates client dues in **a single atomic Prisma transaction**.
- **Live Inventory Stock Badges**: Product autocomplete displays real-time stock levels (`Stock: 120.00 KG` or `Out of Stock`) inside the dropdown and on order items.
- **Urdu Export Pipeline**: Generates clean Urdu invoices downloadable as PDF, JPG image, or directly shareable via WhatsApp.

### 3. 🥦 Moving Average Inventory (`/inventory`)
- **Weighted Average Costing**: Automatically updates unit buy cost on purchase using the moving average formula:
  $$\text{newAvgCost} = \frac{(\text{oldQty} \times \text{oldAvgCost}) + (\text{newQty} \times \text{newRate})}{\text{oldQty} + \text{newQty}}$$
- **Dual Cost Visibility**: Side-by-side display of **Average Buy Cost** (valuation basis) and **Latest Purchase Price (`currentBuyPrice`)**.
- **Wastage & Adjustments**: Record stock wastage or manual adjustments with audit logs.

### 4. 🏷️ Customer Price List (`/pricelist`)
- **Live Price Sheet Sync**: Displays `Product`, `Category`, `Stock`, `Buy Rate` (Average Buy Cost), `Customer Sell Rate`, `Profit Margin (PKR)`, and `Margin %`.
- **Margin Visualizer**: Visual indicator bars highlight item margin profitability.

### 5. 🚚 Logistics & Delivery (`/delivery`)
- **Driver Assignment**: Assign delivery staff and scheduled time slots (Phase 1: 11 AM - 2 PM, Phase 2: 5 PM - 9 PM).
- **Status Lifecycle**: Track deliveries from `PENDING` $\rightarrow$ `OUT_FOR_DELIVERY` $\rightarrow$ `DELIVERED` / `FAILED`.

### 6. 💳 Collections & Due Bills (`/collections`)
- **Outstanding Dues Recovery**: Record full or partial customer bill payments (Cash, Bank, Cheque, Online).
- **Due Statements**: Generate customer balance due statements for WhatsApp sharing.

### 7. 👤 Clients & Opening Balances (`/clients`)
- **Opening Balance Integration**: Set initial outstanding dues (`Previous Due`) when onboarding existing customers.
- **Risk Categorization**: Rating badges (`GREEN`, `YELLOW`, `ORANGE`, `RED`) warn against dispatching orders to credit-restricted clients.

### 8. 🛍️ Procurement & Mandi Purchases (`/purchases`)
- **Supplier & Mandi StockIn**: Record purchases from Mandi or custom suppliers.
- **Edit Purchase Stock Adjustment**: Editing a purchase safely reverses old stock entries before applying new rates and updates `currentBuyPrice` in inventory.

### 9. 📈 Reports & Financial Accounting (`/reports`)
- **Financial Statements**: Generate Income Statement (PnL), Cashflow Statement, Invoice Registry, and Inventory Valuation Reports.

---

## 🔄 Business Workflow Lifecycle

```text
┌────────────────────────┐      StockIn & Moving Avg Cost      ┌────────────────────────┐
│  Mandi / Supplier      ├────────────────────────────────────►│   Central Inventory    │
│  Purchases (/purchases)│                                     │   Hub (/inventory)     │
└────────────────────────┘                                     └───────────┬────────────┘
                                                                           │
                                                                           │ Live Stock & Rates
                                                                           ▼
┌────────────────────────┐     Atomic "Generate Invoice"       ┌────────────────────────┐
│  Sales & Billing       ├────────────────────────────────────►│  Customer Price Sheet  │
│  Wizard (/sales)       │                                     │  Module (/pricelist)   │
└───────────┬────────────┘                                     └────────────────────────┘
            │
            │ Auto-create Delivery Record
            ▼
┌────────────────────────┐     Collect Payment & Ledger Credit ┌────────────────────────┐
│  Logistics & Delivery  ├────────────────────────────────────►│  Due Recovery &        │
│  Module (/delivery)    │                                     │  Collections           │
└────────────────────────┘                                     └───────────┬────────────┘
                                                                           │
                                                                           │ Live Metrics
                                                                           ▼
                                                               ┌────────────────────────┐
                                                               │  Executive Analytics   │
                                                               │  Dashboard (/)         │
                                                               └────────────────────────┘
```

---

## 🛠️ Tech Stack

### Frontend Application
- **Framework**: Next.js 16.2 (App Router) & React 19.2
- **Language**: TypeScript 5.3
- **Styling**: Vanilla CSS (Tailwind CSS v4 utility support enabled)
- **State Management**: Redux Toolkit v2 & Custom SWR Cache (`cacheStore.ts`)
- **Form Handling**: React Hook Form v7 & Zod v4
- **Icon Systems**: `@mdi/react` & `@mdi/js` (Community Material Icons), `@solar-icons/react`, `lucide-react`
- **Document Export**: `html2canvas` & `pdfjs-dist` (Offscreen Canvas Urdu Renderer)

### Backend REST API
- **Runtime**: Node.js v20+ & TypeScript 5.3
- **Framework**: Express.js v4.19
- **ORM & Database Client**: Prisma v7.9 (`@prisma/client` & `@prisma/adapter-pg`)
- **Database Driver**: `pg` v8.22 (PostgreSQL Native Client Pool)
- **Authentication**: `jsonwebtoken` (JWT) & `bcryptjs` (Password Hashing)
- **PDF Pipeline**: `puppeteer` v25.3

### Database & Infrastructure
- **Production Database**: Neon Cloud PostgreSQL (Serverless, SSL Encrypted)
- **Local Database Container**: Docker & PostgreSQL 16
- **Hosting Platforms**: Vercel (Frontend Next.js) & Render (Backend Node.js API)

---

## ⚙️ Installation & Local Setup Guide

### Prerequisites
- Node.js v20.0.0 or higher
- npm v10.0.0 or higher
- Docker Desktop (for local PostgreSQL database container)

### Step 1: Clone Repository
```bash
git clone https://github.com/metauqs/B2B-Distribution-Management-System.git
cd B2B-Distribution-Management-System
```

### Step 2: Start Local PostgreSQL Database (Docker)
```bash
docker compose up -d
```

### Step 3: Backend API Setup
```bash
cd backend
npm install
```
Copy environment file and update database credentials:
```bash
cp ../.env.example .env
```
Run Prisma database setup:
```bash
npm run db:generate
npm run db:push
npm run db:seed
```
Start backend development server:
```bash
npm run dev
```
The backend API server will run at **`http://localhost:3001`**.

### Step 4: Frontend App Setup
In a new terminal window:
```bash
cd frontend
npm install
```
Create local environment file:
```bash
cp ../.env.example .env.local
```
Start frontend development server:
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🔑 Environment Variables Reference

### Backend Environment Variables (`backend/.env`)

| Variable Name | Description | Example Value |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string with SSL mode | `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require` |
| `PORT` | Express.js HTTP listening port | `3001` |
| `JWT_SECRET` | Secret key used for signing JWT bearer tokens | `random_64_character_hex_string` |
| `JWT_EXPIRES_IN` | Token expiration duration | `7d` |
| `NODE_ENV` | Application environment state | `development` or `production` |

### Frontend Environment Variables (`frontend/.env.local`)

| Variable Name | Description | Example Value |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_URL` | Base HTTP endpoint URL for backend API | `http://localhost:3001/api` |
| `NEXT_PUBLIC_APP_NAME` | Display name of the ERP application | `HALAL VEGG SUPPLIES` |
| `NEXT_PUBLIC_APP_VERSION` | Current application version | `1.0.0` |

---

## 🚀 Production Deployment Guide

### 1. Database Deployment (Neon PostgreSQL)
1. Create a serverless PostgreSQL database project on [Neon](https://neon.tech/).
2. Copy the connection string provided in the Neon dashboard (`postgresql://...sslmode=require`).
3. Set `DATABASE_URL` in backend production environment settings.

### 2. Backend API Deployment (Render)
1. Connect repository to [Render](https://render.com/) as a **Web Service**.
2. Root Directory: `backend`
3. Build Command: `npm install && npm run build && npx prisma generate`
4. Start Command: `npm start`
5. Configure Environment Variables (`DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`).

### 3. Frontend Deployment (Vercel)
1. Connect repository to [Vercel](https://vercel.com/).
2. Root Directory: `frontend`
3. Framework Preset: **Next.js**
4. Configure Environment Variable: `NEXT_PUBLIC_API_URL=https://your-backend-render-url.onrender.com/api`.
5. Deploy project.

---

## 🔒 Security Architecture

- **JWT Authentication**: Secure JSON Web Token auth header verification (`Authorization: Bearer <token>`).
- **Bcrypt Password Encryption**: User passwords hashed using `bcryptjs` with salt rounds.
- **Input Sanitization & Schema Validation**: Endpoint requests validated via Zod schemas and Express middleware guards.
- **Atomic Financial Transactions**: Database modifications (`Sale`, `StockIn`, `Client Balance`) execute inside atomic `prisma.$transaction` blocks to prevent financial discrepancies.
- **CORS Protection**: Access restricted to authorized frontend origin URLs.
- **Role-Based Access Control (RBAC)**: Enforces access restrictions for `ADMIN`, `MANAGER`, and `DELIVERY_STAFF`.

---

## ⚡ Performance & Caching Optimizations

- **Stale-While-Revalidate (SWR) Cache (`cacheStore.ts`)**: In-memory cache layer delivers **0ms instant page loads** across module navigation, refreshing data in the background.
- **45s Resilient Request Timeout (`apiFetch.ts`)**: Custom fetch wrapper supports multi-item bulk transactions (e.g. 17+ line items) without premature client-side timeouts.
- **Concurrent DB Aggregations**: Backend routes utilize `Promise.all` for parallelized Prisma queries, keeping API response times under **1 second**.
- **Zero Layout Shift (Skeleton UI)**: `SkeletonKPI`, `SkeletonTable`, and `SkeletonProfile` components prevent layout jumping during data fetches.

---

## 📸 UI Screenshots

### Dashboard
*(Add Screenshot Here)*

### Sales & Billing
*(Add Screenshot Here)*

### Inventory Valuation
*(Add Screenshot Here)*

### Customer Price List
*(Add Screenshot Here)*

### Collections & Due Bills
*(Add Screenshot Here)*

### Mandi Procurement
*(Add Screenshot Here)*

---

## 🔮 Future Enhancements

- [ ] Multi-warehouse inventory stock transfers.
- [ ] Automated WhatsApp API webhook integration for instant invoice delivery.
- [ ] Supplier invoice OCR scanner for automated mandi bill entry.
- [ ] Progressive Web App (PWA) offline delivery driver app.

---

## 📄 License & Credits

Copyright © 2026 **HALAL VEGG SUPPLIES**. All Rights Reserved.  
Built & maintained by the **B2B ERP Engineering Team**.
