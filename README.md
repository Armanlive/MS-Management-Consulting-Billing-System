# MS Management Consulting — Billing & Financial Management System

A production-grade, secure, multi-tenant billing and invoice management web application engineered for management consulting practices in India. Built with clean HTML5, CSS3, ES Modules, and modern serverless PostgreSQL architecture.

---

## Key Highlights

- **Legal Entity Branding**: Independent legal issuer name and client-facing entity configuration.
- **Indian Financial Year Model**: Native April 1 to March 31 cycle (e.g., FY 2026-27).
- **Automated GST Rule Engine**: Place of Supply intelligence — Intrastate (Karnataka, Code 29) CGST + SGST (50/50 split); Interstate IGST.
- **Indian Number to Words**: Statutory invoice currency formatting (Crores, Lakhs, Thousands, Hundreds, and Paise).
- **Dual Invoice Lifecycle**:
  - **Draft Invoices**: Independent sequential numbering (`DRAFT-2026-27-0001`), fully editable, with distinct visual watermarks.
  - **Tax Invoices**: Immutable sequential numbering (`MS/2026-27/01`), statutory lock on line items and totals, cancellation workflows.
- **Enterprise RBAC & Governance**: Administrator vs Staff privileges, last-administrator protection, advisory lock concurrency guards, and single-use cryptographic invitation onboarding.
- **Tamper-Proof Audit Trail**: All privileged financial actions and administration events are logged to PostgreSQL with immutable attribution.
- **GST-Compliant PDF Engine**: Vector PDF generation with bank remittance blocks, authorized signature, and GST breakdown.

---

## Architecture & Technology Stack

| Component | Technology | Description |
|---|---|---|
| **Frontend** | HTML5, CSS3, Vanilla JS (ES Modules), Vite | High-performance, lightweight SPA without framework bloat |
| **Styling** | Custom Vanilla CSS Design System | Responsive layout, dark/light themes, and collapsible Icon Rail |
| **Charts** | Chart.js | Visual KPI trends, collections, and outstanding receivables |
| **PDF Generation** | jsPDF, jsPDF-AutoTable | Client-side pixel-perfect A4 tax invoice document rendering |
| **Backend & APIs** | Vercel Serverless Functions (Node.js) | Secure fail-closed endpoints for RBAC, invitations, and audit logging |
| **Database & Auth** | Supabase (PostgreSQL 15) | Relational integrity, Row Level Security (RLS), atomic RPCs |

---

## Project Structure

```
├── api/                  # Secure serverless API functions
│   ├── _utils.js         # Shared rate limiter, auth validation & client factory
│   ├── audit.js          # Tamper-proof audit ledger querying endpoint
│   ├── bootstrap-admin.js# Operator-controlled initial admin bootstrap API
│   ├── invite.js         # Cryptographic team invitation management
│   ├── invoices.js       # Administrative invoice deletion and audit logging
│   ├── payments.js       # Transactional payment editing and deletion
│   ├── register.js       # Single-use invitation code redemption
│   └── users.js          # Team directory, role updates & session revocation
├── assets/               # Company branding assets and signatures
├── public/               # Static public assets
├── scripts/              # Operator CLI tools
│   ├── bootstrap-admin.js# Interactive primary administrator bootstrap CLI
│   └── package-client.js # Allowlist-based secure client release packager
├── supabase/             # PostgreSQL database schemas
│   ├── schema.sql        # Comprehensive single-run production schema
│   └── migrations/       # Timestamped incremental migration scripts
├── tests/                # Automated verification suites (81/81 passing)
├── index.html            # Application entrypoint
├── src.js                # Core client application & state management
├── style.css             # Unified application styles and theme variables
├── vercel.json           # Vercel SPA routing and serverless function rewrite rules
├── vite.config.js        # Vite bundling and development API middleware
├── .env.example          # Environment variable template with placeholders
├── CLIENT_SETUP_GUIDE.md # End-to-end client deployment and configuration guide
└── package.json          # Project configuration, scripts, and dependencies
```

---

## Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Local Environment
```bash
cp .env.example .env
```
Populate `.env` with your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_publishable_key
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_secret
```

### 3. Initialize Database & Admin
1. Execute `supabase/schema.sql` in your Supabase SQL Editor.
2. Run the bootstrap CLI to provision the initial Administrator:
```bash
npm run bootstrap:admin
```

### 4. Start Development Server
```bash
npm run dev
```
Navigate to `http://localhost:3005` in your browser.

---

## Testing & Quality Assurance

Run the automated test suite verifying security, RBAC, financial math, and language standards:

```bash
npm test
```

Build the production distribution bundle:
```bash
npm run build
```

---

## Production Deployment

For complete, step-by-step instructions on deploying the application to your own **GitHub** repository, **Vercel** account, and **Supabase** instance, consult the comprehensive guide:

👉 **[CLIENT_SETUP_GUIDE.md](./CLIENT_SETUP_GUIDE.md)**

---

## License & Ownership

Proprietary commercial software prepared for MS Management Consulting. All rights reserved.
