# MS Consulting Billing — Starter v1

Light-theme HTML/CSS/vanilla JS billing portal with Supabase Auth/Postgres and Vercel serverless signup protection.

## Setup
1. Open Supabase project `ilnvomvotfmqaiurkhde`. Back up database; review and run `supabase/schema.sql` in SQL Editor. It creates tables, triggers and RLS policies. **Do not run blindly against a populated database.**
2. In Supabase Authentication > Providers, disable public email signup. Server-side invite registration uses the Admin API.
3. Create `.env` from `.env.example`. Get publishable/anon key from Supabase API settings. Keep `SUPABASE_SERVICE_ROLE_KEY` ONLY in server environment; never expose in frontend or commit.
4. `npm install && npm run dev` for frontend. Vercel serverless functions run after deployment (or via `vercel dev`).
5. Connect GitHub repo to Vercel. Framework: Vite, build: `npm run build`, output: `dist`. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` to Vercel Environment Variables.
6. Supabase Auth URL Configuration: set Site URL to deployed Vercel URL, add redirect URL(s).
7. **Bootstrap first admin manually and securely:** In Supabase Auth dashboard create boss user with strong temporary password, then run `insert into public.profiles(id,email,role) values('<actual-auth-user-uuid>','<actual-email>','admin');` in SQL editor. Never expose admin password in chat. Sign in and create invite codes from Settings.

## Features
Dashboard, customer master, invoice creation, Indian GST auto calculation, invoice numbering, invoice PDF download, history/edit/duplicate, payment recording/status, company settings, role-based access and invite-based signup.

## Known production hardening before real financial use
- Invoice PDF currently uses a clean A4 layout; add uploaded signature and verified business details before issuing legal invoices.
- `invoice_sequence` is global, not per financial year; numbering format includes calendar year. Agree on numbering rules before production.
- Database currently allows any authenticated staff to edit invoice values and customer records; consider stricter role policy, approval workflow and immutable audit log.
- `status` is client-writable through the invoice update RLS; enforce status server-side for production.
- Payment overcollection should be blocked server-side. Add atomic payment recording and refunds before production.
- Concurrent use of the same invite may race; implement atomic redeem RPC with a unique consumption guarantee and API rate limiting before opening signup publicly.
- Browser preview mode shows empty example dashboard without connecting to real data. No database deployment was performed by creating this ZIP.
