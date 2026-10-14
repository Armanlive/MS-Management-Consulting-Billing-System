# MS Management Consulting — Client Setup & Deployment Guide

This guide provides end-to-end instructions for deploying and operating the **MS Management Consulting Billing & Invoice Management System** using your own **GitHub**, **Supabase**, and **Vercel** accounts.

---

## Table of Contents
1. [Prerequisites](#1-prerequisites)
2. [Extracting the Package](#2-extracting-the-package)
3. [Installing Dependencies](#3-installing-dependencies)
4. [Configuring Local Environment Variables](#4-configuring-local-environment-variables)
5. [Creating Your Client-Owned Supabase Project](#5-creating-your-client-owned-supabase-project)
6. [Applying Database Schema & Migrations](#6-applying-database-schema--migrations)
7. [Provisioning the Primary Administrator](#7-provisioning-the-primary-administrator)
8. [Running Locally](#8-running-locally)
9. [Publishing to Your GitHub Repository](#9-publishing-to-your-github-repository)
10. [Deploying to Vercel](#10-deploying-to-vercel)
11. [Configuring Vercel Environment Variables](#11-configuring-vercel-environment-variables)
12. [Configuring Supabase Authentication & Redirect URLs](#12-configuring-supabase-authentication--redirect-urls)
13. [Onboarding Team Members via Invitations](#13-onboarding-team-members-via-invitations)
14. [Running Automated Quality & Security Tests](#14-running-automated-quality--security-tests)
15. [Verifying Production Billing & Financial Workflows](#15-verifying-production-billing--financial-workflows)
16. [Security Best Practices & Key Rotation](#16-security-best-practices--key-rotation)

---

## 1. Prerequisites

Before beginning, ensure you have:
- **Node.js**: Version 18.0.0 or higher (`node -v`)
- **npm**: Version 9.0.0 or higher (`npm -v`)
- **Git**: Installed locally (`git -v`)
- **Supabase Account**: Sign up at [https://supabase.com](https://supabase.com)
- **GitHub Account**: Sign up at [https://github.com](https://github.com)
- **Vercel Account**: Sign up at [https://vercel.com](https://vercel.com)

---

## 2. Extracting the Package

Extract the delivery ZIP archive into your desired working directory:

```bash
# On Linux / macOS
unzip ms-billing-system-client-v1.0.0.zip -d ms-billing-system
cd ms-billing-system

# On Windows (PowerShell)
Expand-Archive -Path ms-billing-system-client-v1.0.0.zip -DestinationPath ms-billing-system
cd ms-billing-system
```

Verify that the following core files and directories are present:
```
├── api/                  # Secure serverless API handlers
├── assets/               # Business logos and branding assets
├── public/               # Static public assets
├── scripts/              # Administrative CLI scripts (bootstrap, packaging)
├── supabase/             # PostgreSQL database schemas and migrations
├── tests/                # Automated security, RBAC, and language tests
├── index.html            # Application entrypoint
├── src.js                # Core frontend client application
├── style.css             # Enterprise design system stylesheet
├── vercel.json           # Vercel SPA and serverless routing configuration
├── vite.config.js        # Build configuration and local development middleware
├── .env.example          # Environment variables template (placeholders only)
└── package.json          # Project manifest and scripts
```

---

## 3. Installing Dependencies

Install verified production dependencies:

```bash
npm install
```

> [!NOTE]
> All dependencies will be resolved cleanly against `package-lock.json`. Zero additional global dependencies are required.

---

## 4. Configuring Local Environment Variables

Create your local `.env` file from the provided placeholder template:

```bash
# Copy placeholder template to .env
cp .env.example .env
```

Open `.env` in your text editor. It contains:

```env
# Client-Facing Public Configuration (Bundled into frontend by Vite)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_publishable_key_here

# Server-Side Administrative Configuration (Serverless functions only)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_secret_key_here

# Optional: High-entropy secret if invoking bootstrap via HTTP
BOOTSTRAP_SECRET=your_random_32_character_bootstrap_secret_here
```

You will populate these values in Step 5 after creating your Supabase project.

---

## 5. Creating Your Client-Owned Supabase Project

1. Log in to the [Supabase Dashboard](https://supabase.com/dashboard).
2. Click **New Project**.
3. Choose your organization, assign a project name (e.g., `MS-Consulting-Billing`), set a secure database password, and select your preferred region (e.g., `ap-south-1` Mumbai for Indian regulatory compliance).
4. Wait for the project initialization to complete (~1-2 minutes).
5. In your Supabase project dashboard, navigate to **Project Settings** (gear icon) -> **API**:
   - **Project URL**: Copy this URL. Paste into `.env` for both `VITE_SUPABASE_URL` and `SUPABASE_URL`.
   - **Project API Keys -> anon (public)**: Copy this key. Paste into `.env` as `VITE_SUPABASE_ANON_KEY`.
   - **Project API Keys -> service_role (secret)**: Copy this key. Paste into `.env` as `SUPABASE_SERVICE_ROLE_KEY`.

> [!CAUTION]
> The `service_role` key bypasses all PostgreSQL Row Level Security (RLS) policies.
> **NEVER** expose the `service_role` key to frontend code, **NEVER** prefix it with `VITE_`, and **NEVER** commit `.env` to GitHub.

---

## 6. Applying Database Schema (Authoritative Clean Installation)

The database schema includes 10 relational tables, 15 security functions, sequential draft and tax invoice numbering engines, tamper-proof audit trails, and strict PostgreSQL Row Level Security (RLS).

### Standard Installation Procedure
1. In your Supabase Dashboard, click on **SQL Editor** in the left navigation.
2. Click **New query**.
3. Open the file `supabase/schema.sql` from this repository.
4. Copy the entire file content, paste it into the Supabase SQL Editor, and click **Run** (green button).
5. Verify the execution summary confirms `Success. No rows returned`.

> [!NOTE]
> `supabase/schema.sql` is the authoritative, unified production schema. It consolidates all schema objects, indexes, RLS policies, and governance triggers.
> If your DevOps pipeline utilizes the Supabase CLI (`supabase db push`), the verified timestamped migrations in `supabase/migrations/` match `supabase/schema.sql` identically:
> 1. `20260408000000_billing_system_schema.sql`
> 2. `20260408010000_invitation_lifecycle_and_bootstrap_fix.sql`
> 3. `20261010000000_invoice_creation_immutability_fix.sql`
> 4. `20261011000000_draft_sequential_numbering.sql`
> 5. `20261011010000_enterprise_rbac_and_user_governance.sql`
> 6. `20261013000000_billing_authorization_and_numbering_hardening.sql`
> 
> Emergency rollback procedures are strictly isolated in `supabase/rollback/` to prevent CLI deployment tools (`supabase db push`) from executing rollback files.

### Role-Based Authorization Policy (Owner Approved)

| System Operation | Administrator | Staff Member | Enforcement Layer |
|:---|:---:|:---:|:---|
| **View Financial Dashboard & Metrics** | ✅ Allow | ✅ Allow | Database RLS & API |
| **Create & Save Draft Invoice** | ✅ Allow | ✅ Allow | Database RPC (`create_invoice_with_items`) |
| **Edit Draft Invoice Details & Line Items** | ✅ Allow | ✅ Allow | Database RLS & RPC |
| **Finalize & Issue Tax Invoice** | ✅ Allow | ✅ Allow | Database RPC (`create_invoice_with_items`) |
| **View Invoice History & Details** | ✅ Allow | ✅ Allow | Database RLS (`invoices_select_active`) |
| **View & Download GST Tax Invoice PDF** | ✅ Allow | ✅ Allow | Frontend Document Engine |
| **Add & Manage Customer Master** | ✅ Allow | ✅ Allow | Database RLS (`customers_*_active`) |
| **Record Customer Payments** | ✅ Allow | ✅ Allow | Database RPC (`record_invoice_payment`) |
| **View Monthly & FY Financial Reports** | ✅ Allow | ✅ Allow | Database RLS & Analytics |
| **Cancel Issued Tax Invoice** | ✅ Allow | 🚫 **Deny** | Database RPC (`cancel_invoice` — Admin Only) |
| **Delete Draft or Cancelled Invoice** | ✅ Allow | 🚫 **Deny** | Database RLS (`invoices_delete_draft_admin_only`) |
| **Reverse or Delete Payment Record** | ✅ Allow | 🚫 **Deny** | Database RPC (`reverse_invoice_payment` — Admin Only) |
| **Modify Company GST Settings** | ✅ Allow | 🚫 **Deny** | Database RLS (`settings_update_admin_only`) |
| **Manage Users, Invitations & Roles** | ✅ Allow | 🚫 **Deny** | Database Trigger & RLS (`signup_invites`, `profiles`) |
| **View Security Audit Trail Logs** | ✅ Allow | 🚫 **Deny** | Database RLS (`audit_select_admin`) |

---

## 7. Provisioning the Primary Administrator

The billing system enforces an invitation-only security model. Public registration is permanently locked. To securely bootstrap your first primary Administrator:

Run the interactive CLI command:

```bash
npm run bootstrap:admin
```

The script will:
1. Connect to your Supabase project using the configured `SUPABASE_SERVICE_ROLE_KEY`.
2. Run strict pre-flight checks to ensure the database is uninitialized and no administrator exists yet.
3. Prompt you for:
   - **Administrator Email** (e.g., `admin@yourcompany.com`)
   - **Administrator Full Name** (e.g., `Lead Administrator`)
   - **Administrator Password** (minimum 8 characters, input masked for terminal security)
4. Require you to type `CONFIRM` to verify execution.
5. Create the administrator in Supabase Auth and initialize the administrator profile atomically.
6. Permanently lock the bootstrap mechanism.

> [!NOTE]
> Once the first Administrator is provisioned, the bootstrap mechanism automatically self-locks and cannot be executed again. Subsequent team members must be invited through the **Admin Control Center**.

---

## 8. Running Locally

Start the local Vite development server:

```bash
npm run dev
```

1. Open your browser and navigate to `http://localhost:3005`.
2. Sign in using the Administrator credentials you provisioned in Step 7.
3. You will arrive at the Dashboard, and the database status indicator will show active connection.

---

## 9. Publishing to Your GitHub Repository

Initialize a clean Git repository without exposing any local history or untracked files:

```bash
# 1. Initialize git
git init -b main

# 2. Confirm .env is ignored (CRITICAL)
git status
# Ensure '.env' does NOT appear in untracked files!

# 3. Stage approved files
git add .

# 4. Create initial commit
git commit -m "feat: initial commit of MS Consulting billing system"

# 5. Create a new private repository on GitHub (e.g., 'billing-system')
# 6. Link and push to your GitHub repository
git remote add origin https://github.com/<your-org-or-username>/<your-repo-name>.git
git push -u origin main
```

> [!IMPORTANT]
> Keep your repository **Private** to protect your business branding and internal logic.

---

## 10. Deploying to Vercel

1. Log in to the [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** -> **Project**.
3. Import your newly created GitHub repository.
4. Configure the project build settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Do **NOT** click Deploy yet — proceed to Step 11 to add your Environment Variables first.

---

## 11. Configuring Vercel Environment Variables

In the Vercel project configuration screen, open the **Environment Variables** section and add the following 4 variables (select all environments: Production, Preview, Development):

| Variable Name | Value | Secret Type |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://your-project-id.supabase.co` | Public |
| `VITE_SUPABASE_ANON_KEY` | `your_supabase_anon_publishable_key` | Public |
| `SUPABASE_URL` | `https://your-project-id.supabase.co` | Server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | `your_supabase_service_role_secret_key` | **Sensitive Server Secret** |

Click **Deploy**. Vercel will build the frontend assets, bundle the serverless functions in `/api`, and deploy the application to your production URL (e.g., `https://your-app.vercel.app`).

---

## 12. Configuring Supabase Authentication & Redirect URLs

To ensure Supabase Auth redirects work properly in production:

1. In your Supabase Dashboard, go to **Authentication** -> **URL Configuration**.
2. **Site URL**: Enter your production Vercel URL:
   ```
   https://your-app.vercel.app
   ```
3. **Redirect URLs**: Add wildcard and local testing paths:
   ```
   https://your-app.vercel.app/**
   http://localhost:3005/**
   ```
4. Save changes.

---

## 13. Team Roles and Billing Authorization Policy

The MS Consulting Billing System enforces a strict role-based permission matrix at both the database and application levels:

| Capability / Operation | Administrator (`admin`) | Staff Member (`staff`) |
|---|---|---|
| View Dashboard & Metrics | Allowed | Allowed |
| Create Draft Invoices | Allowed | Allowed |
| Edit Draft Invoices | Allowed | Allowed |
| **Finalize & Issue Tax Invoices** | **Allowed** | **Allowed** (Owner Approved) |
| View Invoice History & PDFs | Allowed | Allowed |
| Download Tax Invoice PDF | Allowed | Allowed |
| Add / Edit Customer Records | Allowed | Allowed |
| Record & View Client Payments | Allowed | Allowed |
| View Financial & Tax Reports | Allowed | Allowed |
| Cancel Issued Tax Invoice | Allowed | **Denied (Admin Only)** |
| Permanently Delete Draft Invoice | Allowed | **Denied (Admin Only)** |
| Reverse or Delete Payments | Allowed | **Denied (Admin Only)** |
| Modify Company Settings | Allowed | **Denied (Admin Only)** |
| Manage Team Users & Invitations | Allowed | **Denied (Admin Only)** |
| View Privileged Audit Logs | Allowed | **Denied (Admin Only)** |

> [!NOTE]
> Per owner authorization policy, active Staff users are authorized to issue and finalize statutory Tax Invoices. Privileged administrative operations (cancellations, deletions, reversals, team management, and entity settings) remain strictly restricted to Administrators.

---

## 14. Onboarding Team Members via Invitations

1. Sign in to your production billing system as the Administrator.
2. Click **User Management** in the navigation sidebar (shield icon).
3. In the **Generate Team Invitation** card:
   - Enter the invitee's corporate email address.
   - Select their role (`staff` or `admin`).
   - Choose code validity (1 day, 7 days, 14 days, or 30 days).
   - Click **Generate Invitation**.
4. Securely share the generated single-use invitation code with the new team member.
5. The invitee visits the application URL, selects **Redeem Invite / Sign Up**, enters their Full Name, Email, Password, and Invitation Code, and registers.
6. The invitation code is atomically redeemed and cannot be reused.

---

## 15. Running Automated Quality & Security Tests

Run the comprehensive test suite locally at any time:

```bash
npm test
```

The automated test runner executes 87 tests across four critical suites:
- **`security_and_integrity.test.js`**: 35 tests verifying AUTH-01 through AUTH-18 specifications, financial math immutability, overpayment protection, and pre-flight fail-closed guards.
- **`language_and_content_audit.test.js`**: 4 tests verifying English-only UI strings, GST-compliant invoice terminology, and non-regression guards.
- **`enterprise_rbac_and_admin_control.test.js`**: 20 tests verifying server-side API authorization guards, last-admin protection, foreign-key dependency protections, and audit log spoofing prevention.
- **`billing_authorization_and_lifecycle.test.js`**: 28 tests verifying Admin and Staff invoice finalization, lifecycle atomicity, numbering security, financial integrity, and rollback hardening regression invariants.

All tests should report `PASS` with zero failures.

---

## 16. Verifying Production Billing & Financial Workflows

Perform the following verification checks in your deployed environment:
1. **Entity Configuration**: Go to **Company Settings** (Admin only) and configure your registered address, GSTIN, PAN, and Bank Remittance details.
2. **Customer Master**: Create a customer record with valid GSTIN and state code.
3. **Draft Invoice Creation**: Create a draft invoice, verify automated CGST/SGST vs IGST calculation based on customer state, and verify Indian Currency Amount in Words.
4. **Invoice Finalization**: Finalize the invoice to generate a sequential tax invoice number (`MS/2026-27/01`). Both Admin and Staff can finalize invoices. Verify the document displays **TAX INVOICE** and line items are locked.
5. **PDF Generation**: Click **Download PDF** to verify GST compliance, bank remittance table, and authorized signature.
6. **Payment Recording**: Record a partial payment and verify the outstanding balance updates accurately.
7. **Audit Trail**: Check **User Management** -> **System Activity Log** to verify all operational actions are immutably logged with actor attribution.

---

## 17. Security Best Practices & Key Rotation

1. **Protecting Service-Role Keys**:
   - The `SUPABASE_SERVICE_ROLE_KEY` must never be shared in team chats, committed to Git, or exposed in public repositories.
2. **Rotating Keys**:
   - If a key is accidentally exposed, immediately go to Supabase Dashboard -> **Project Settings** -> **API** -> **JWT Secret / API Keys** and click **Rotate Secret**.
   - Update the new key in Vercel **Environment Variables** and redeploy.
3. **Session Revocation**:
   - Administrators can revoke active sessions for any compromised user account directly in **User Management** -> **Team Directory** -> **Manage** -> **Revoke Active Sessions**.
4. **Deactivating Staff**:
   - When a team member leaves, click **Deactivate Account** in the Admin Control Center. Their historical financial attribution (invoices created, payments recorded) remains preserved for statutory GST compliance while immediately terminating system access.
