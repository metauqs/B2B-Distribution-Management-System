# 🥬 Halal Veg Supplies ERP

An enterprise-grade **Vegetable Supply Chain & Distribution ERP** tailored for Halal Veg Supplies. This system integrates procurement, daily pricing sheets, sales invoicing, collection tracking, real-time client ledgers, inventory control, and delivery coordination into a single, unified workflow.

---

## 📁 System Architecture

The project is structured as a monorepo containing decoupled frontend and backend services:

```text
HalalVeggSupplies/
│
├── frontend/                        # Next.js App Router UI (React & Tailwind CSS)
│   ├── src/
│   │   ├── app/                     # Page views and layouts
│   │   ├── components/              # Reusable UI elements (modals, forms, cards)
│   │   ├── hooks/                   # Custom state hooks
│   │   ├── services/                # Axios API call layers
│   │   ├── store/                   # Redux Toolkit global state
│   │   └── utils/                   # Formatting, validation, and template helpers
│   └── package.json
│
├── backend/                         # Express.js REST API Server (Node.js & TypeScript)
│   ├── src/
│   │   ├── index.ts                 # Server entry point
│   │   ├── middleware/              # JWT verification and route security checks
│   │   ├── routes/                  # REST API handlers
│   │   └── lib/                     # Business logic, calculations, and database triggers
│   ├── prisma/                      # Database schema and seed scripts
│   └── package.json
│
├── docker-compose.yml               # Local PostgreSQL configuration for dev
├── .env.example                     # Shared environment configurations
└── README.md                        # Project documentation
```

---

## 🚀 Key Modules & Business Rules

### 1. Pricing Sheets (Daily Mandi Rates)
* **Date-Specific Purchases**: Today's pricing sheet displays only the items purchased on the selected business day. Unpurchased items remain hidden, reducing table clutter and allowing administrators to quickly adjust selling margins.
* **Auto-Refresh (Blinking Resolves)**: Polling reloads and focus changes refresh active rates silently in the background, preventing layout blinking.

### 2. Invoicing & Ledger Synchronization
* **Automated Transactions**: Recording a purchase or sale immediately adjusts stock counts, recalculates client dues, and logs credit entries within a single database transaction.
* **Urdu Connected Scripts**: Standardised document exports (Preview, PDF, JPG, WhatsApp) compile templates using an SVG rendering engine to preserve right-to-left cursive Arabic script character shaping without broken glyphs.

### 3. Simplified Authentication
* **Employee Login**: Users sign in directly using their 4-digit Employee ID (derived from the last 4 digits of their phone or WhatsApp number). Hashed credentials, names, and roles are synchronized automatically on login.

### 4. Day Shift (5:00 A.M. Reset Boundary)
* The daily business reset occurs at 5:00 A.M. instead of midnight. All calculations, records, and summaries are preserved under the active day until 4:59:59 A.M.

---

## 🎨 Visual Identity & Design System

The visual design is built around a clean, functional green-theme palette:

* **Colors**:
  - Forest Green (`#1F3D2B`): Primary headers, top navigation, main buttons.
  - Leaf Green (`#4A7C59`): Accents and highlight badges.
  - Cream Background (`#FAF6EC`): Minimal, low-glare screen contrast.
  - Paper Content (`#FFFDF8`): Clean table cards.
* **Typography**:
  - English: `IBM Plex Sans` for clean, professional data tables.
  - Urdu translations: `Noto Nastaliq Urdu` (with local system font stacks like `Geeza Pro` / `Microsoft Urdu Typesetting` for isolated canvas SVG exports).

---

## ⚡ Performance & Optimization Standards

To maintain fast page response times and FCP/LCP metrics:
1. **Dynamic Imports**: Large libraries like `exceljs` or `d3` must be imported dynamically (`await import(...)` or `next/dynamic`) inside user action handlers to keep bundle sizes small.
2. **RTL Text Rasterization**: Complex right-to-left connected text rendering is compiled via an offscreen SVG canvas to prevent layout shifts.

---

## ⚙️ Local Development Setup

### 1. Start Database
Spin up the local PostgreSQL instance via Docker:
```bash
docker compose up -d
```

### 2. Configure Environment Files
Copy the `.env.example` file to create the corresponding configuration files:
* Root folder: Copy to `backend/.env` and update variables.
* Root folder: Copy to `frontend/.env.local` and update variables.

### 3. Initialize Backend Server
Install dependencies, generate the database client, run schema migrations, and seed initial values:
```bash
cd backend
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

### 4. Start Frontend UI
Open a separate terminal window and launch the React dev server:
```bash
cd frontend
npm install
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 📦 Production Deployment Guide

### Backend API (Railway / Render / VPS)
1. Set the root directory configuration to `backend`.
2. Configure build commands:
   - **Build**: `npm run build`
   - **Start**: `npm start`
3. Expose environment settings (`DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, etc.).

### Frontend UI (Vercel)
1. Point Vercel to the `frontend` root directory.
2. Ensure framework preset is set to **Next.js**.
3. Supply required build environment keys (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_NAME`).
