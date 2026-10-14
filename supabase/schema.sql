-- ============================================================================
-- MS MANAGEMENT CONSULTING BILLING & FINANCIAL INVOICE SYSTEM
-- SECURE POSTGRESQL PRODUCTION MIGRATION & RLS ACCESS CONTROL ARCHITECTURE
-- Version: 2.0.0 (Hardened Production Release)
-- Target Database: PostgreSQL 15+ / Supabase
-- Can be copied and run directly in Supabase SQL Editor
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. USER PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT DEFAULT 'Staff Member',
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sign_in_at TIMESTAMPTZ,
  last_sign_out_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. COMPANY SETTINGS (Single-tenant company configuration)
-- No fake/unverified GSTIN, PAN, bank account, IFSC, phone or address
CREATE TABLE IF NOT EXISTS public.company_settings (
  id UUID PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  business_name TEXT NOT NULL DEFAULT 'MS Management Consulting',
  issuer_name TEXT NOT NULL DEFAULT 'MADHU M. S.',
  address TEXT DEFAULT '',
  state TEXT NOT NULL DEFAULT 'Karnataka',
  state_code TEXT NOT NULL DEFAULT '29',
  gstin TEXT DEFAULT '',
  pan TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  account_name TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  ifsc TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  default_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  invoice_prefix TEXT NOT NULL DEFAULT 'INV',
  payment_terms TEXT DEFAULT 'Payment due within 15 days of invoice date.',
  invoice_footer TEXT DEFAULT 'This is a computer-generated tax invoice and requires no physical signature.',
  logo_url TEXT DEFAULT '',
  signature_url TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed confirmed brand and issuer name ONLY
INSERT INTO public.company_settings (
  id, business_name, issuer_name, address, state, state_code, gstin, pan, bank_name, account_name, account_number, ifsc
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'MS Management Consulting',
  'MADHU M. S.',
  '',
  'Karnataka',
  '29',
  '',
  '',
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO UPDATE SET
  business_name = 'MS Management Consulting',
  issuer_name = 'MADHU M. S.';

-- 4. CUSTOMER MASTER
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  billing_address TEXT DEFAULT '',
  city TEXT DEFAULT 'Bangalore',
  state TEXT DEFAULT 'Karnataka',
  state_code TEXT NOT NULL DEFAULT '29',
  pin_code TEXT DEFAULT '',
  gstin TEXT DEFAULT '',
  pan TEXT DEFAULT '',
  contact_person TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. ATOMIC INVOICE SEQUENCES (Financial Year Specific)
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  financial_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5B. ATOMIC DRAFT SEQUENCES (Financial Year Specific)
CREATE TABLE IF NOT EXISTS public.draft_invoice_sequences (
  financial_year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.draft_invoice_sequences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.draft_invoice_sequences FROM PUBLIC, anon, authenticated;

-- 6. INVOICES
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '15 days')::DATE,
  financial_year TEXT NOT NULL,
  place_of_supply TEXT DEFAULT 'Karnataka (29)',
  description TEXT NOT NULL DEFAULT 'Professional Services for Management Consultancy',
  hsn_sac TEXT DEFAULT '998312',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00 CHECK (gst_rate BETWEEN 0 AND 100),
  tax_type TEXT NOT NULL DEFAULT 'CGST + SGST',
  tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (cgst >= 0),
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (sgst >= 0),
  igst NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (igst >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total >= 0),
  amount_in_words TEXT NOT NULL DEFAULT '',
  payment_terms TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'partial', 'paid', 'cancelled')),
  is_draft BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. INVOICE LINE ITEMS
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  hsn_sac TEXT DEFAULT '998312',
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1.00 CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (unit_price >= 0),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount >= 0),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. PAYMENTS (Preserves audit history; direct client write strictly revoked)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES public.customers(id),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'Bank Transfer' CHECK (method IN ('Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Other')),
  reference TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  recorded_by UUID REFERENCES auth.users(id),
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_at TIMESTAMPTZ,
  reversed_by UUID REFERENCES auth.users(id),
  reversed_reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure payment reversal columns exist if table was already created
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES auth.users(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_reason TEXT DEFAULT '';

-- 9. SIGNUP INVITATIONS
CREATE TABLE IF NOT EXISTS public.signup_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code_hash TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reserved', 'redeemed', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  reserved_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES auth.users(id),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.signup_invites ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.signup_invites ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;
ALTER TABLE public.signup_invites ADD COLUMN IF NOT EXISTS redeemed_by UUID REFERENCES auth.users(id);
ALTER TABLE public.signup_invites ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE public.signup_invites ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id);

-- 10. AUDIT LOGS (Immutable security ledger)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. INDEXES
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_fy ON public.invoices(financial_year);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_active ON public.payments(invoice_id, is_reversed);
CREATE INDEX IF NOT EXISTS idx_customers_name ON public.customers(name);
CREATE INDEX IF NOT EXISTS idx_invites_hash ON public.signup_invites(code_hash);
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.signup_invites(status);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.signup_invites(email);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_logs(created_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS & AUTHENTICATION UTILITIES
-- ============================================================================

-- Function: Check if current authenticated user is an active Administrator
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = TRUE
  );
$$;

-- Function: Check if current authenticated user is active (Admin or Staff)
CREATE OR REPLACE FUNCTION public.is_active_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_active = TRUE AND role IN ('admin', 'staff')
  );
$$;

-- ============================================================================
-- ATOMIC INVOICE NUMBER GENERATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_next_invoice_number(p_fy TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_seq INTEGER;
  v_num TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_member() THEN
    RAISE EXCEPTION 'Unauthorized: Active user session required';
  END IF;

  IF p_fy IS NULL OR p_fy !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'Invalid financial year format. Expected YYYY-YY (e.g. 2026-27)';
  END IF;

  SELECT COALESCE(NULLIF(invoice_prefix, ''), 'INV') INTO v_prefix FROM public.company_settings LIMIT 1;
  IF v_prefix IS NULL THEN
    v_prefix := 'INV';
  END IF;

  INSERT INTO public.invoice_sequences (financial_year, last_number, updated_at)
  VALUES (p_fy, 1, NOW())
  ON CONFLICT (financial_year)
  DO UPDATE SET last_number = public.invoice_sequences.last_number + 1, updated_at = NOW()
  RETURNING last_number INTO v_seq;

  v_num := v_prefix || '/' || p_fy || '/' || LPAD(v_seq::text, 4, '0');
  RETURN v_num;
END;
$$;

-- ATOMIC DRAFT INVOICE NUMBER GENERATION
CREATE OR REPLACE FUNCTION public.get_next_draft_number(p_fy TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num INTEGER;
BEGIN
  IF p_fy IS NULL OR TRIM(p_fy) = '' THEN
    RAISE EXCEPTION 'Financial year is required to generate draft invoice number';
  END IF;

  INSERT INTO public.draft_invoice_sequences (financial_year, last_number, updated_at)
  VALUES (p_fy, 1, NOW())
  ON CONFLICT (financial_year)
  DO UPDATE SET
    last_number = public.draft_invoice_sequences.last_number + 1,
    updated_at = NOW()
  RETURNING last_number INTO v_num;

  RETURN 'DRAFT-' || p_fy || '-' || LPAD(v_num::TEXT, 4, '0');
END;
$$;

-- ============================================================================
-- TRANSACTION-SAFE ATOMIC INVOICE CREATION WITH LINE-ITEM COMPUTED TOTALS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_invoice_with_items(
  p_customer_id UUID,
  p_invoice_date DATE,
  p_due_date DATE,
  p_financial_year TEXT,
  p_place_of_supply TEXT,
  p_discount NUMERIC,
  p_gst_rate NUMERIC,
  p_payment_terms TEXT,
  p_notes TEXT,
  p_is_draft BOOLEAN,
  p_items JSONB,
  p_invoice_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_customer RECORD;
  v_settings RECORD;
  v_computed_subtotal NUMERIC(14,2) := 0.00;
  v_discount NUMERIC(14,2) := 0.00;
  v_taxable NUMERIC(14,2) := 0.00;
  v_rate NUMERIC(5,2);
  v_cgst NUMERIC(14,2) := 0.00;
  v_sgst NUMERIC(14,2) := 0.00;
  v_igst NUMERIC(14,2) := 0.00;
  v_tax_amount NUMERIC(14,2) := 0.00;
  v_total NUMERIC(14,2) := 0.00;
  v_tax_type TEXT;
  v_invoice_number TEXT;
  v_invoice_id UUID;
  v_status TEXT;
  v_item JSONB;
  v_item_desc TEXT;
  v_item_hsn TEXT;
  v_item_qty NUMERIC(10,2);
  v_item_price NUMERIC(14,2);
  v_item_disc NUMERIC(14,2);
  v_item_amount NUMERIC(14,2);
  v_items_count INTEGER := 0;
  v_existing_is_draft BOOLEAN;  -- never clobber the p_is_draft parameter
  v_prev_invoice_number TEXT;   -- original draft reference, preserved in audit
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_active_member() THEN
    RAISE EXCEPTION 'Unauthorized: Active user session required';
  END IF;

  -- Verify active customer
  SELECT * INTO v_customer FROM public.customers WHERE id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;
  IF v_customer.is_active = FALSE THEN
    RAISE EXCEPTION 'Cannot issue invoice to an inactive customer';
  END IF;

  -- Verify company settings
  SELECT * INTO v_settings FROM public.company_settings LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company settings not found';
  END IF;

  -- Strict check: issuer details must be present before final issue
  IF p_is_draft = FALSE THEN
    IF v_settings.issuer_name IS NULL OR TRIM(v_settings.issuer_name) = '' THEN
      RAISE EXCEPTION 'Issuer Name must be configured in Company Settings before finalizing an invoice.';
    END IF;
  END IF;

  -- Validate line items array
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Line items must be provided as a JSON array';
  END IF;

  v_items_count := jsonb_array_length(p_items);
  IF v_items_count = 0 AND p_is_draft = FALSE THEN
    RAISE EXCEPTION 'At least one line item is required to finalize an invoice';
  END IF;

  -- Compute subtotal authoritatively from line items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_desc := TRIM(COALESCE(v_item->>'description', ''));
    IF v_item_desc = '' AND p_is_draft = FALSE THEN
      RAISE EXCEPTION 'Line item description cannot be empty';
    END IF;

    v_item_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
    IF v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Line item quantity must be greater than zero';
    END IF;

    v_item_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0.00);
    IF v_item_price < 0 THEN
      RAISE EXCEPTION 'Line item unit price cannot be negative';
    END IF;

    v_item_disc := COALESCE((v_item->>'discount')::NUMERIC, 0.00);
    IF v_item_disc < 0 THEN
      RAISE EXCEPTION 'Line item discount cannot be negative';
    END IF;

    v_item_amount := ROUND((v_item_qty * v_item_price) - v_item_disc, 2);
    IF v_item_amount < 0 THEN
      RAISE EXCEPTION 'Line item net amount cannot be negative';
    END IF;

    v_computed_subtotal := v_computed_subtotal + v_item_amount;
  END LOOP;

  -- Apply invoice level discount
  v_discount := GREATEST(0.00, COALESCE(p_discount, 0.00));
  IF v_discount > v_computed_subtotal THEN
    v_discount := v_computed_subtotal;
  END IF;
  v_taxable := GREATEST(0.00, v_computed_subtotal - v_discount);

  -- Determine GST rate & tax split
  v_rate := COALESCE(p_gst_rate, 18.00);
  IF v_rate < 0 OR v_rate > 100 THEN
    RAISE EXCEPTION 'Invalid GST rate. Must be between 0 and 100';
  END IF;

  IF v_rate = 0 THEN
    v_tax_type := 'EXEMPT';
    v_cgst := 0.00;
    v_sgst := 0.00;
    v_igst := 0.00;
    v_tax_amount := 0.00;
  ELSIF COALESCE(v_settings.state_code, '29') = COALESCE(v_customer.state_code, '29') THEN
    v_tax_type := 'CGST + SGST';
    v_cgst := ROUND(v_taxable * (v_rate / 2.0) / 100.0, 2);
    v_sgst := ROUND(v_taxable * (v_rate / 2.0) / 100.0, 2);
    v_igst := 0.00;
    v_tax_amount := v_cgst + v_sgst;
  ELSE
    v_tax_type := 'IGST';
    v_cgst := 0.00;
    v_sgst := 0.00;
    v_igst := ROUND(v_taxable * v_rate / 100.0, 2);
    v_tax_amount := v_igst;
  END IF;

  v_total := v_taxable + v_tax_amount;

  -- Handle Existing Draft Finalization / Update vs New Invoice Creation
  IF p_invoice_id IS NOT NULL THEN
    -- Verify target exists and is still a draft
    SELECT id, is_draft, status, invoice_number
    INTO v_invoice_id, v_existing_is_draft, v_status, v_prev_invoice_number
    FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target invoice % not found', p_invoice_id;
    END IF;

    IF v_existing_is_draft = FALSE THEN
      RAISE EXCEPTION 'Invoice % is already finalized and cannot be modified.', p_invoice_id;
    END IF;

    -- Caller intent (p_is_draft) decides: finalize (real number) or stay draft
    IF p_is_draft = FALSE THEN
      v_invoice_number := public.get_next_invoice_number(p_financial_year);
      v_status := 'unpaid';
    ELSE
      v_invoice_number := v_prev_invoice_number;
      v_status := 'draft';
    END IF;

    -- Update the SAME invoice record with authoritative values
    UPDATE public.invoices SET
      customer_id = p_customer_id,
      invoice_date = p_invoice_date,
      due_date = p_due_date,
      financial_year = p_financial_year,
      place_of_supply = COALESCE(p_place_of_supply, 'Karnataka (29)'),
      subtotal = v_computed_subtotal,
      discount = v_discount,
      gst_rate = v_rate,
      tax_type = v_tax_type,
      tax_amount = v_tax_amount,
      cgst = v_cgst,
      sgst = v_sgst,
      igst = v_igst,
      total = v_total,
      payment_terms = COALESCE(p_payment_terms, ''),
      notes = COALESCE(p_notes, ''),
      status = v_status,
      is_draft = p_is_draft,
      invoice_number = v_invoice_number,
      updated_at = NOW()
    WHERE id = p_invoice_id;

    v_invoice_id := p_invoice_id;
  ELSE
    -- New Invoice
    IF p_is_draft = FALSE THEN
      v_invoice_number := public.get_next_invoice_number(p_financial_year);
      v_status := 'unpaid';
    ELSE
      -- Sequential, atomic, unique per financial year, never reused
      v_invoice_number := public.get_next_draft_number(p_financial_year);
      v_status := 'draft';
    END IF;

    INSERT INTO public.invoices (
      invoice_number, customer_id, invoice_date, due_date, financial_year,
      place_of_supply, description, hsn_sac, subtotal, discount,
      gst_rate, tax_type, tax_amount, cgst, sgst, igst, total,
      amount_in_words, payment_terms, notes, status, is_draft, created_by
    ) VALUES (
      v_invoice_number, p_customer_id, p_invoice_date, p_due_date, p_financial_year,
      COALESCE(p_place_of_supply, 'Karnataka (29)'),
      'Professional Services for Management Consultancy',
      '998312', v_computed_subtotal, v_discount,
      v_rate, v_tax_type, v_tax_amount, v_cgst, v_sgst, v_igst, v_total,
      '', COALESCE(p_payment_terms, ''), COALESCE(p_notes, ''),
      v_status, p_is_draft, v_user_id
    ) RETURNING id INTO v_invoice_id;
  END IF;

  -- Allow THIS transaction to seed/replace the invoice's own line items.
  -- Transaction-local (is_local = true), so the flag never leaks to other
  -- sessions or statements outside this RPC call.
  PERFORM set_config('app.seed_invoice_items', '1', TRUE);

  -- Cleanly replace previous line items if updating or finalizing an existing draft
  IF p_invoice_id IS NOT NULL THEN
    DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;
  END IF;

  -- Insert all line items with server-verified amounts
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_desc := TRIM(COALESCE(v_item->>'description', 'Management Consulting Service'));
    v_item_hsn := COALESCE(v_item->>'hsn_sac', '998312');
    v_item_qty := COALESCE((v_item->>'quantity')::NUMERIC, 1.00);
    v_item_price := COALESCE((v_item->>'unit_price')::NUMERIC, 0.00);
    v_item_disc := COALESCE((v_item->>'discount')::NUMERIC, 0.00);
    v_item_amount := ROUND((v_item_qty * v_item_price) - v_item_disc, 2);

    INSERT INTO public.invoice_items (
      invoice_id, description, hsn_sac, quantity, unit_price, discount, amount
    ) VALUES (
      v_invoice_id, v_item_desc, v_item_hsn, v_item_qty, v_item_price, v_item_disc, v_item_amount
    );
  END LOOP;

  -- Insert audit log (the original draft reference is preserved for
  -- traceability when a draft is confirmed into a permanent tax invoice)
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    CASE WHEN p_is_draft THEN 'INVOICE_DRAFT_SAVED' ELSE 'INVOICE_FINALIZED' END,
    'invoices',
    v_invoice_id::text,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
      'draft_reference', CASE WHEN p_is_draft THEN NULL ELSE v_prev_invoice_number END,
      'subtotal', v_computed_subtotal,
      'total', v_total,
      'is_draft', p_is_draft,
      'items_count', v_items_count
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'subtotal', v_computed_subtotal,
    'total', v_total,
    'status', v_status
  );
END;
$$;

-- ============================================================================
-- STRICT LINE ITEM IMMUTABILITY TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_invoice_items_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_id UUID;
  v_is_draft BOOLEAN;
BEGIN
  -- Allow the invoice-issuance RPC to seed/replace line items in its own transaction
  IF current_setting('app.seed_invoice_items', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_invoice_id := OLD.invoice_id;
  ELSE
    v_invoice_id := NEW.invoice_id;
  END IF;

  SELECT is_draft INTO v_is_draft
  FROM public.invoices
  WHERE id = v_invoice_id;

  -- If the parent invoice is finalized, block all direct line-item mutations
  IF v_is_draft IS NOT NULL AND v_is_draft = FALSE THEN
    RAISE EXCEPTION 'Line items for finalized tax invoices are strictly immutable. Modifications and deletions are prohibited.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_invoice_items_immutability ON public.invoice_items;
CREATE TRIGGER trigger_protect_invoice_items_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW
EXECUTE FUNCTION public.protect_invoice_items_immutability();

-- ============================================================================
-- FINALIZED INVOICE IMMUTABILITY TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.validate_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier_state TEXT;
  v_customer_state TEXT;
  v_rate NUMERIC;
  v_settings RECORD;
BEGIN
  -- Prevent modifying finalized invoices
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_draft = FALSE THEN
      -- Disallow reverting finalized invoices back to draft
      IF NEW.is_draft = TRUE THEN
        RAISE EXCEPTION 'Cannot convert finalized invoice back to draft.';
      END IF;

      -- Financial, customer, date, tax, and sequence fields are permanently frozen
      IF OLD.invoice_number IS DISTINCT FROM NEW.invoice_number OR
         OLD.customer_id IS DISTINCT FROM NEW.customer_id OR
         OLD.invoice_date IS DISTINCT FROM NEW.invoice_date OR
         OLD.due_date IS DISTINCT FROM NEW.due_date OR
         OLD.financial_year IS DISTINCT FROM NEW.financial_year OR
         OLD.place_of_supply IS DISTINCT FROM NEW.place_of_supply OR
         OLD.description IS DISTINCT FROM NEW.description OR
         OLD.hsn_sac IS DISTINCT FROM NEW.hsn_sac OR
         OLD.subtotal IS DISTINCT FROM NEW.subtotal OR
         OLD.discount IS DISTINCT FROM NEW.discount OR
         OLD.gst_rate IS DISTINCT FROM NEW.gst_rate OR
         OLD.tax_type IS DISTINCT FROM NEW.tax_type OR
         OLD.tax_amount IS DISTINCT FROM NEW.tax_amount OR
         OLD.cgst IS DISTINCT FROM NEW.cgst OR
         OLD.sgst IS DISTINCT FROM NEW.sgst OR
         OLD.igst IS DISTINCT FROM NEW.igst OR
         OLD.total IS DISTINCT FROM NEW.total OR
         OLD.created_by IS DISTINCT FROM NEW.created_by THEN
        RAISE EXCEPTION 'Finalized tax invoices are strictly immutable across all financial, customer, tax, and date fields. Direct modification is prohibited.';
      END IF;
    END IF;
  END IF;

  -- Ensure verified business details exist before final issue
  IF NEW.is_draft = FALSE THEN
    SELECT * INTO v_settings FROM public.company_settings LIMIT 1;
    IF v_settings.issuer_name IS NULL OR TRIM(v_settings.issuer_name) = '' THEN
      RAISE EXCEPTION 'Issuer Name must be configured in Company Settings before finalizing an invoice.';
    END IF;
  END IF;

  SELECT COALESCE(state_code, '29') INTO v_supplier_state FROM public.company_settings LIMIT 1;
  SELECT COALESCE(state_code, '29') INTO v_customer_state FROM public.customers WHERE id = NEW.customer_id;

  v_rate := COALESCE(NEW.gst_rate, 18.00);

  IF v_rate = 0 THEN
    NEW.tax_type := 'EXEMPT';
    NEW.cgst := 0.00;
    NEW.sgst := 0.00;
    NEW.igst := 0.00;
    NEW.tax_amount := 0.00;
  ELSIF COALESCE(v_supplier_state, '29') = COALESCE(v_customer_state, '29') THEN
    NEW.tax_type := 'CGST + SGST';
    NEW.cgst := ROUND((NEW.subtotal - COALESCE(NEW.discount, 0)) * (v_rate / 2.0) / 100.0, 2);
    NEW.sgst := ROUND((NEW.subtotal - COALESCE(NEW.discount, 0)) * (v_rate / 2.0) / 100.0, 2);
    NEW.igst := 0.00;
    NEW.tax_amount := NEW.cgst + NEW.sgst;
  ELSE
    NEW.tax_type := 'IGST';
    NEW.cgst := 0.00;
    NEW.sgst := 0.00;
    NEW.igst := ROUND((NEW.subtotal - COALESCE(NEW.discount, 0)) * v_rate / 100.0, 2);
    NEW.tax_amount := NEW.igst;
  END IF;

  NEW.total := (NEW.subtotal - COALESCE(NEW.discount, 0)) + NEW.tax_amount;
  NEW.updated_at := NOW();

  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_invoice ON public.invoices;
CREATE TRIGGER trigger_validate_invoice
BEFORE INSERT OR UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.validate_invoice();

-- ============================================================================
-- CONTROLLED INVOICE CANCELLATION RPC (ADMIN ONLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_invoice(
  p_invoice_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_inv RECORD;
  v_active_payments INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Administrator privileges required to cancel invoices';
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Cancellation reason is required';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'Invoice is already cancelled';
  END IF;

  -- Check if any non-reversed payments exist
  SELECT COUNT(*) INTO v_active_payments
  FROM public.payments
  WHERE invoice_id = p_invoice_id AND is_reversed = FALSE;

  IF v_active_payments > 0 THEN
    RAISE EXCEPTION 'Cannot cancel an invoice with active payments. All payments must be reversed before cancellation.';
  END IF;

  UPDATE public.invoices
  SET status = 'cancelled',
      notes = TRIM(COALESCE(notes, '') || ' | Cancelled: ' || TRIM(p_reason)),
      updated_at = NOW()
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'INVOICE_CANCELLED',
    'invoices',
    p_invoice_id::text,
    jsonb_build_object('invoice_number', v_inv.invoice_number, 'reason', TRIM(p_reason))
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'status', 'cancelled');
END;
$$;

-- ============================================================================
-- PAYMENT SYNCHRONIZATION TRIGGER (ROW LOCKING & CONCURRENCY SAFE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_invoice_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
  v_total_paid NUMERIC(14,2);
  v_inv_total NUMERIC(14,2);
  v_cur_status TEXT;
BEGIN
  v_inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  -- Lock invoice row for concurrency safety
  SELECT total, status INTO v_inv_total, v_cur_status
  FROM public.invoices WHERE id = v_inv_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Sum only active, non-reversed payments
  SELECT COALESCE(SUM(amount), 0.00) INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = v_inv_id AND is_reversed = FALSE;

  -- Prevent overpayment beyond total
  IF v_total_paid > (v_inv_total + 0.05) THEN
    RAISE EXCEPTION 'Total active payments (%) exceed invoice total (%)', v_total_paid, v_inv_total;
  END IF;

  IF v_cur_status = 'cancelled' THEN
    RETURN NULL;
  END IF;

  UPDATE public.invoices
  SET status = CASE
    WHEN v_total_paid >= v_inv_total THEN 'paid'
    WHEN v_total_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END,
  updated_at = NOW()
  WHERE id = v_inv_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_payment_status_update ON public.payments;
CREATE TRIGGER trigger_payment_status_update
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.update_invoice_payment_status();

-- ============================================================================
-- RESTRICTED RPC FOR PAYMENT RECORDING (TRANSACTION & CONCURRENCY SAFE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_invoice_payment(
  p_invoice_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_method TEXT,
  p_reference TEXT,
  p_remarks TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
  v_paid NUMERIC(14,2);
  v_new_payment_id UUID;
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_active_member() THEN
    RAISE EXCEPTION 'Unauthorized: Active user session required';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  -- Lock invoice to prevent concurrent overpayments
  SELECT id, customer_id, total, status, is_draft
  INTO v_inv
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_inv.is_draft = TRUE THEN
    RAISE EXCEPTION 'Cannot record payments on a draft invoice. Finalize the invoice first.';
  END IF;

  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot record payment on a cancelled invoice';
  END IF;

  SELECT COALESCE(SUM(amount), 0.00) INTO v_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id AND is_reversed = FALSE;

  IF (v_paid + p_amount) > (v_inv.total + 0.05) THEN
    RAISE EXCEPTION 'Payment of % exceeds outstanding balance of %', p_amount, (v_inv.total - v_paid);
  END IF;

  INSERT INTO public.payments (
    invoice_id, customer_id, payment_date, amount, method, reference, remarks, recorded_by, is_reversed
  ) VALUES (
    p_invoice_id, v_inv.customer_id, p_payment_date, p_amount, p_method,
    COALESCE(p_reference, ''), COALESCE(p_remarks, ''), v_user_id, FALSE
  ) RETURNING id INTO v_new_payment_id;

  -- System audit entry
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'PAYMENT_RECORDED',
    'payments',
    v_new_payment_id::text,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'amount', p_amount,
      'method', p_method,
      'reference', p_reference
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'outstanding', GREATEST(0.00, v_inv.total - (v_paid + p_amount))
  );
END;
$$;

-- ============================================================================
-- AUDITABLE PAYMENT REVERSAL RPC (ADMIN ONLY)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reverse_invoice_payment(
  p_payment_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_payment RECORD;
  v_inv RECORD;
  v_active_paid NUMERIC(14,2);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Administrator privileges required to reverse payments';
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Reversal reason is required';
  END IF;

  -- Lock payment row
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found';
  END IF;

  IF v_payment.is_reversed = TRUE THEN
    RAISE EXCEPTION 'Payment has already been reversed';
  END IF;

  -- Lock parent invoice
  SELECT * INTO v_inv FROM public.invoices WHERE id = v_payment.invoice_id FOR UPDATE;

  -- Mark payment reversed while preserving the historical record
  UPDATE public.payments SET
    is_reversed = TRUE,
    reversed_at = NOW(),
    reversed_by = v_user_id,
    reversed_reason = TRIM(p_reason)
  WHERE id = p_payment_id;

  -- Recalculate remaining payments
  SELECT COALESCE(SUM(amount), 0.00) INTO v_active_paid
  FROM public.payments
  WHERE invoice_id = v_payment.invoice_id AND is_reversed = FALSE;

  -- Update invoice status
  UPDATE public.invoices SET
    status = CASE
      WHEN v_active_paid >= v_inv.total THEN 'paid'
      WHEN v_active_paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END,
    updated_at = NOW()
  WHERE id = v_payment.invoice_id;

  -- Audit log entry
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    'PAYMENT_REVERSED',
    'payments',
    p_payment_id::text,
    jsonb_build_object(
      'invoice_id', v_payment.invoice_id,
      'reversed_amount', v_payment.amount,
      'reason', TRIM(p_reason),
      'remaining_balance', GREATEST(0.00, v_inv.total - v_active_paid)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'reversed_amount', v_payment.amount,
    'remaining_paid', v_active_paid
  );
END;
$$;

-- ============================================================================
-- PROFILE PRIVILEGES & ROLE INTEGRITY TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_count INTEGER;
  v_caller UUID;
BEGIN
  v_caller := auth.uid();

  -- =========================================================================
  -- 2A. DELETE OPERATIONS (BEFORE DELETE)
  -- =========================================================================
  IF TG_OP = 'DELETE' THEN
    -- If executed from an authenticated client session
    IF v_caller IS NOT NULL THEN
      -- Non-administrators can never delete user profiles
      IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Forbidden: Non-administrators cannot delete user accounts.';
      END IF;

      -- Administrators are strictly prohibited from deleting their own account
      IF OLD.id = v_caller THEN
        RAISE EXCEPTION 'Forbidden: Self-deletion is prohibited. Administrators cannot delete their own account.';
      END IF;
    END IF;

    -- Last Administrator Protection on DELETE:
    -- Applies to ALL operations, including privileged serverless service_role calls.
    IF OLD.role = 'admin' AND OLD.is_active = TRUE THEN
      -- Serialize concurrent administrative changes via transactional advisory lock
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ms_consulting_admin_governance_lock'));

      SELECT COUNT(*) INTO v_admin_count
      FROM public.profiles
      WHERE role = 'admin' AND is_active = TRUE AND id <> OLD.id;

      IF v_admin_count = 0 THEN
        RAISE EXCEPTION 'Operation aborted: Cannot delete the last active Administrator. At least one active Administrator must remain.';
      END IF;
    END IF;

    RETURN OLD;
  END IF;

  -- =========================================================================
  -- 2B. UPDATE OPERATIONS (BEFORE UPDATE)
  -- =========================================================================
  IF TG_OP = 'UPDATE' THEN
    -- If executed from an authenticated client session
    IF v_caller IS NOT NULL THEN
      -- Non-administrators cannot modify role or active status
      IF NOT public.is_admin() THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
          RAISE EXCEPTION 'Forbidden: Non-administrators cannot modify user roles or promote themselves.';
        END IF;
        IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
          RAISE EXCEPTION 'Forbidden: Non-administrators cannot modify account active status.';
        END IF;
      END IF;

      -- Administrators are strictly prohibited from self-demoting or self-deactivating
      IF OLD.id = v_caller THEN
        IF OLD.role = 'admin' AND NEW.role <> 'admin' THEN
          RAISE EXCEPTION 'Forbidden: Self-demotion is prohibited. Administrators cannot demote their own account.';
        END IF;
        IF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
          RAISE EXCEPTION 'Forbidden: Self-deactivation is prohibited. Administrators cannot deactivate their own account.';
        END IF;
      END IF;
    END IF;

    -- Last Administrator Protection on UPDATE (Demotion or Deactivation):
    -- Applies to ALL operations, including privileged serverless service_role calls.
    IF OLD.role = 'admin' AND OLD.is_active = TRUE THEN
      IF (NEW.role <> 'admin' OR NEW.is_active = FALSE) THEN
        -- Serialize concurrent administrative changes via transactional advisory lock
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ms_consulting_admin_governance_lock'));

        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' AND is_active = TRUE AND id <> OLD.id;

        IF v_admin_count = 0 THEN
          RAISE EXCEPTION 'Operation aborted: The system must retain at least one active Administrator.';
        END IF;
      END IF;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

-- Revoke direct execution from untrusted roles
REVOKE ALL ON FUNCTION public.protect_profile_privileges() FROM PUBLIC, anon;

-- Attach trigger to public.profiles for both UPDATE and DELETE
DROP TRIGGER IF EXISTS trigger_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trigger_protect_profile_privileges
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileges();

-- Trigger: Prevent creating an admin profile via direct client INSERT
CREATE OR REPLACE FUNCTION public.protect_profile_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'admin' AND NOT public.is_admin() THEN
    -- Only allowed if no admin exists at all (initial provisioning)
    IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
      RAISE EXCEPTION 'Permission denied: Creating administrator profiles directly is prohibited.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_protect_profile_insert ON public.profiles;
CREATE TRIGGER trigger_protect_profile_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_insert();

-- ============================================================================
-- ATOMIC CONCURRENCY-SAFE FIRST ADMIN BOOTSTRAP FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.bootstrap_admin_account(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Obtain exclusive transaction advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('ms_consulting_bootstrap_admin_lock'));

  -- Reject if an administrator already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Administrator already established. Public or repeated bootstrap is strictly prohibited.';
  END IF;

  -- Create primary admin profile
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (p_user_id, TRIM(LOWER(p_email)), TRIM(p_full_name), 'admin', TRUE, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    is_active = TRUE,
    updated_at = NOW();

  -- Initialize company settings with verified brand only
  INSERT INTO public.company_settings (
    id, business_name, issuer_name, address, state, state_code, gstin, pan, bank_name, account_name, account_number, ifsc
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'MS Management Consulting',
    'MADHU M. S.',
    '', 'Karnataka', '29', '', '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  -- Audit log entry
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_user_id,
    'INITIAL_ADMIN_BOOTSTRAPPED',
    'system',
    p_user_id::text,
    jsonb_build_object('email', TRIM(LOWER(p_email)), 'timestamp', NOW())
  );

  RETURN jsonb_build_object('success', true, 'message', 'Primary Administrator successfully provisioned.');
END;
$$;

-- ATOMIC CONCURRENCY-SAFE INVITATION REDEMPTION FUNCTION
CREATE OR REPLACE FUNCTION public.redeem_signup_invite(
  p_user_id UUID,
  p_email TEXT,
  p_code_hash TEXT,
  p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_invite RECORD;
  v_norm_email TEXT := LOWER(TRIM(p_email));
BEGIN
  -- Obtain exclusive row lock on invitation
  SELECT * INTO v_invite
  FROM public.signup_invites
  WHERE code_hash = p_code_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invitation code.';
  END IF;

  IF v_invite.status = 'revoked' THEN
    RAISE EXCEPTION 'This invitation code has been revoked.';
  END IF;

  IF v_invite.status = 'redeemed' OR v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'This invitation code has already been redeemed.';
  END IF;

  IF v_invite.expires_at <= NOW() THEN
    RAISE EXCEPTION 'This invitation code has expired.';
  END IF;

  IF LOWER(TRIM(v_invite.email)) <> v_norm_email THEN
    RAISE EXCEPTION 'Invitation email mismatch.';
  END IF;

  -- Consume invite atomically
  UPDATE public.signup_invites
  SET
    status = 'redeemed',
    used_at = NOW(),
    redeemed_by = p_user_id
  WHERE id = v_invite.id;

  -- Create profile with the role assigned in invitation
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (p_user_id, v_norm_email, TRIM(p_full_name), v_invite.role, TRUE, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    full_name = TRIM(p_full_name),
    role = v_invite.role,
    is_active = TRUE,
    updated_at = NOW();

  -- Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_user_id,
    'INVITATION_REDEEMED',
    'signup_invites',
    v_invite.id::text,
    jsonb_build_object('email', v_norm_email, 'role', v_invite.role, 'redeemed_at', NOW())
  );

  RETURN jsonb_build_object('success', TRUE, 'role', v_invite.role);
END;
$$;

-- ============================================================================
-- STRICT DEFAULT-DENY ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. DROP ALL PREVIOUS POLICIES TO ELIMINATE ANY PERMISSIVE RESIDUE
DROP POLICY IF EXISTS "Allow all authenticated users on profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow all authenticated users on company_settings" ON public.company_settings;
DROP POLICY IF EXISTS "Allow all authenticated users on customers" ON public.customers;
DROP POLICY IF EXISTS "Allow all authenticated users on invoices" ON public.invoices;
DROP POLICY IF EXISTS "Allow all authenticated users on invoice_items" ON public.invoice_items;
DROP POLICY IF EXISTS "Allow all authenticated users on payments" ON public.payments;

DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_active" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self_or_admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_write" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_insert" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_delete" ON public.profiles;

DROP POLICY IF EXISTS "company_settings_read" ON public.company_settings;
DROP POLICY IF EXISTS "settings_select_active" ON public.company_settings;
DROP POLICY IF EXISTS "company_settings_admin_update" ON public.company_settings;
DROP POLICY IF EXISTS "settings_update_admin_only" ON public.company_settings;

DROP POLICY IF EXISTS "customers_read" ON public.customers;
DROP POLICY IF EXISTS "customers_write" ON public.customers;
DROP POLICY IF EXISTS "customers_update" ON public.customers;
DROP POLICY IF EXISTS "customers_select_active" ON public.customers;
DROP POLICY IF EXISTS "customers_insert_active" ON public.customers;
DROP POLICY IF EXISTS "customers_update_active" ON public.customers;
DROP POLICY IF EXISTS "customers_delete_admin_only" ON public.customers;

DROP POLICY IF EXISTS "invoices_read" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update" ON public.invoices;
DROP POLICY IF EXISTS "invoices_select_active" ON public.invoices;
DROP POLICY IF EXISTS "invoices_insert_active" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_active" ON public.invoices;
DROP POLICY IF EXISTS "invoices_update_draft" ON public.invoices;
DROP POLICY IF EXISTS "invoices_delete_draft_admin_only" ON public.invoices;

DROP POLICY IF EXISTS "invoice_items_read" ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_write" ON public.invoice_items;
DROP POLICY IF EXISTS "items_select_active" ON public.invoice_items;
DROP POLICY IF EXISTS "items_insert_active" ON public.invoice_items;
DROP POLICY IF EXISTS "items_update_active" ON public.invoice_items;
DROP POLICY IF EXISTS "items_delete_active" ON public.invoice_items;
DROP POLICY IF EXISTS "items_insert_draft" ON public.invoice_items;
DROP POLICY IF EXISTS "items_update_draft" ON public.invoice_items;
DROP POLICY IF EXISTS "items_delete_draft" ON public.invoice_items;

DROP POLICY IF EXISTS "payments_read" ON public.payments;
DROP POLICY IF EXISTS "payments_insert" ON public.payments;
DROP POLICY IF EXISTS "payments_select_active" ON public.payments;
DROP POLICY IF EXISTS "payments_insert_active" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_update" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_delete" ON public.payments;

DROP POLICY IF EXISTS "invites_admin_manage" ON public.signup_invites;
DROP POLICY IF EXISTS "invites_admin_select" ON public.signup_invites;
DROP POLICY IF EXISTS "invites_admin_write" ON public.signup_invites;

DROP POLICY IF EXISTS "audit_logs_read" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_select_admin" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_insert_active" ON public.audit_logs;

-- 2. POLICIES: PROFILES
CREATE POLICY "profiles_select_active" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.is_active_member());

CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

CREATE POLICY "profiles_admin_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 3. POLICIES: COMPANY SETTINGS
CREATE POLICY "settings_select_active" ON public.company_settings
  FOR SELECT TO authenticated
  USING (public.is_active_member());

CREATE POLICY "settings_update_admin_only" ON public.company_settings
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE INSERT, DELETE ON public.company_settings FROM PUBLIC, anon, authenticated;

-- 4. POLICIES: CUSTOMERS
CREATE POLICY "customers_select_active" ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_active_member());

CREATE POLICY "customers_insert_active" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_member());

CREATE POLICY "customers_update_active" ON public.customers
  FOR UPDATE TO authenticated
  USING (public.is_active_member())
  WITH CHECK (public.is_active_member());

CREATE POLICY "customers_delete_admin_only" ON public.customers
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 5. POLICIES: INVOICES
CREATE POLICY "invoices_select_active" ON public.invoices
  FOR SELECT TO authenticated
  USING (public.is_active_member());

CREATE POLICY "invoices_insert_active" ON public.invoices
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_member());

-- Only DRAFT invoices can be updated via client queries. Finalized invoices are immutable!
CREATE POLICY "invoices_update_draft" ON public.invoices
  FOR UPDATE TO authenticated
  USING (public.is_active_member() AND is_draft = TRUE)
  WITH CHECK (public.is_active_member() AND is_draft = TRUE);

CREATE POLICY "invoices_delete_draft_admin_only" ON public.invoices
  FOR DELETE TO authenticated
  USING (public.is_admin() AND is_draft = TRUE);

-- 6. POLICIES: INVOICE LINE ITEMS
CREATE POLICY "items_select_active" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (public.is_active_member());

-- Line items can only be inserted, updated or deleted for DRAFT invoices!
CREATE POLICY "items_insert_draft" ON public.invoice_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_member() AND
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.is_draft = TRUE)
  );

CREATE POLICY "items_update_draft" ON public.invoice_items
  FOR UPDATE TO authenticated
  USING (
    public.is_active_member() AND
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.is_draft = TRUE)
  )
  WITH CHECK (
    public.is_active_member() AND
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.is_draft = TRUE)
  );

CREATE POLICY "items_delete_draft" ON public.invoice_items
  FOR DELETE TO authenticated
  USING (
    public.is_active_member() AND
    EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id AND i.is_draft = TRUE)
  );

-- 7. POLICIES: PAYMENTS
-- Direct client INSERT, UPDATE, DELETE permissions are COMPLETELY REVOKED
CREATE POLICY "payments_select_active" ON public.payments
  FOR SELECT TO authenticated
  USING (public.is_active_member());

REVOKE INSERT, UPDATE, DELETE ON public.payments FROM PUBLIC, anon, authenticated;

-- 8. POLICIES: SIGNUP INVITATIONS
CREATE POLICY "invites_admin_select" ON public.signup_invites
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "invites_admin_write" ON public.signup_invites
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.signup_invites FROM PUBLIC, anon;

-- 9. POLICIES: AUDIT LOGS
-- Immutable system ledger: Direct client writes are COMPLETELY REVOKED
CREATE POLICY "audit_select_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon;

-- ============================================================================
-- STRICT EXECUTE PERMISSION ENFORCEMENT ON SECURITY DEFINER FUNCTIONS
-- ============================================================================

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

REVOKE ALL ON FUNCTION public.is_active_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;

-- Internal invoice sequence allocation: Direct client execution is completely revoked to protect GST invoice serials
REVOKE ALL ON FUNCTION public.get_next_invoice_number(TEXT) FROM PUBLIC, anon, authenticated;

-- Internal draft sequence allocation: Direct client execution is completely revoked
REVOKE ALL ON FUNCTION public.get_next_draft_number(TEXT) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_invoice_with_items(UUID, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_items(UUID, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment(UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.reverse_invoice_payment(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_invoice_payment(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_invoice(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_invoice(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.bootstrap_admin_account(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin_account(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.redeem_signup_invite(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_signup_invite(UUID, TEXT, TEXT, TEXT) TO service_role;

