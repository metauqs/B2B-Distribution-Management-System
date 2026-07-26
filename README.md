# 🥬 HALAL VEGG SUPPLIES (B2B Distribution Management System)

An enterprise-grade **B2B Vegetable Supply Chain & Distribution ERP System** tailored for **HALAL VEGG SUPPLIES**. This system integrates mandi procurement, daily pricing sheets, sales invoicing, collection tracking, real-time client ledgers, inventory control, expense management, employee management, and delivery logistics into a single, unified workspace.

---

## 🌐 Production Deployment

- **Frontend Application (Vercel)**: [https://b2-b-distribution-management-system.vercel.app](https://b2-b-distribution-management-system.vercel.app)
- **Backend API Service (Render)**: [https://b2b-distribution-management-system.onrender.com](https://b2b-distribution-management-system.onrender.com)
- **Database**: Serverless PostgreSQL hosted on **Neon DB** (`ap-southeast-1`)

---

## 📁 System Architecture

```text
HalalVeggSupplies/
│
├── frontend/                        # Next.js 16 App Router UI (React 19 & Vanilla CSS)
│   ├── src/
│   │   ├── app/                     # ERP page views (Sales, Purchases, Inventory, Clients, etc.)
│   │   ├── components/              # Reusable UI elements (modals, forms, Skeleton loaders)
│   │   ├── services/                # API client layers
│   │   ├── store/                   # Redux Toolkit global state
│   │   └── utils/                   # apiFetch, cacheStore, formatters, document templates
│   ├── public/                      # Static assets and 🥬 favicons
│   └── package.json
│
├── backend/                         # Express.js REST API Server (Node.js & TypeScript)
│   ├── src/
│   │   ├── index.ts                 # Server entry point
│   │   ├── middleware/              # JWT auth and security handlers
│   │   ├── routes/                  # REST API route controllers
│   │   └── lib/                     # Business logic and database calculations
│   ├── prisma/                      # Prisma ORM schema, migrations, and seeds
│   └── package.json
│
├── docker-compose.yml               # Local PostgreSQL container configuration
├── .env.example                     # Environment template
└── README.md                        # Project documentation
```

---

## 🚀 Core Features & Business Logic

### 1. Daily Mandi Pricing Sheets
* **Date-Specific Procurement**: Today's pricing sheet displays items purchased on the selected business day. Unpurchased items remain hidden to streamline profit margin entry.
* **Background Revalidation**: Silent background updates refresh active rates without layout flicker or focus interruption.

### 2. Invoicing, Ledgers & Urdu Document Generation
* **Atomic Transactions**: Recording purchases or sales immediately updates inventory stock levels, recalculates client account balances, and logs ledger entries atomically.
* **Urdu Script Rendering**: PDF, preview, image, and WhatsApp document exports utilize an offscreen SVG rendering pipeline to guarantee proper right-to-left Arabic/Urdu cursive character joining.

### 3. Immutable Employee ID & Role-Based Access
* **Permanent Employee ID**: Employee IDs are permanent 4-digit identifiers generated automatically from the initial phone/WhatsApp number upon creation. Updating personal details (phone, address, role, name) never alters the assigned Employee ID.
* **Simplified Login**: Personnel sign in using their 4-digit Employee ID and hashed password.

### 4. 5:00 A.M. Business Day Shift
* The daily business reset occurs at 5:00 A.M. instead of midnight. All summaries, reports, and transactions are preserved under the active business day until 4:59:59 A.M.

---

## ⚡ Performance & Optimization Architecture

- **Stale-While-Revalidate (SWR) Client Cache** (`cacheStore.ts`): Provides **0ms instant page transitions** across all 11 ERP modules by rendering cached data instantly while validating freshness in the background.
- **Automatic Cache Invalidation**: Data mutation requests (create, update, delete) automatically invalidate affected module caches.
- **Zero Layout Shift (Skeleton Loaders)**: Shimmering `SkeletonTable`, `SkeletonKPI`, `SkeletonProfile`, and `SkeletonChart` components provide consistent loading states.
- **Parallelized Network Fetching**: Initial page loads utilize `Promise.all` for concurrent resource requests, reducing initial multi-device load times to **<1.5 seconds**.

---

## 🎨 Visual Identity & Tab Branding

- **Browser Tab Branding**: `🥬 HALAL VEGG SUPPLIES`
- **Favicon**: Standard SVG & PNG `🥬` emoji favicons optimized for desktop, mobile, and iOS touch icons.
- **Icon System**: Icons are powered by `@mdi/react` / `@mdi/js` (Community Material Icons) and `@solar-icons/react`.
- **Color Palette**:
  - Forest Green (`#1F3D2B`): Primary headers and main action buttons.
  - Leaf Green (`#4A7C59`): Accents, status badges, and highlights.
  - Off-White Canvas (`#FAF6EC`): Low-glare contrast.
  - Paper Content (`#FFFDF8`): Table cards and modals.

---

## ⚙️ Local Development Setup

### 1. Database Configuration
Launch the local PostgreSQL container via Docker:
```bash
docker compose up -d
```

### 2. Environment Variables
Copy `.env.example` to `backend/.env` and `frontend/.env.local`, filling in your local database credentials and JWT secrets.

### 3. Backend Initialization
```bash
cd backend
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

### 4. Frontend Launch
In a separate terminal window:
```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.
