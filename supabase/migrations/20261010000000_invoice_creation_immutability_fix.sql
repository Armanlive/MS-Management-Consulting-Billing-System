-- ====================================================================
-- MIGRATION: FIX FOR "Line items for finalized tax invoices are
-- strictly immutable" ERROR DURING INVOICE CREATION
-- ====================================================================
--
-- Root cause:
--   1. `create_invoice_with_items` inserts the invoice row FIRST
--      (with is_draft = FALSE for a finalized invoice) and then inserts
--      its line items. The `trigger_protect_invoice_items_immutability`
--      trigger saw a finalized parent invoice and RAISED an exception,
--      so EVERY attempt to issue a new finalized invoice failed.
--   2. The same trigger blocked re-seeding line items when finalizing an
--      existing draft (the UPDATE flips is_draft to FALSE before items
--      are replaced).
--   3. The `SELECT ... INTO v_invoice_id, p_is_draft, v_status` lookup
--      OVERWROTE the `p_is_draft` INPUT PARAMETER with the stored draft
--      flag, making the "already finalized" guard and the
--      "assign a real invoice number" branch dead code. A draft that was
--      finalized silently stayed a draft with a DRAFT-xxxxxx number.
--
-- Fix:
--   * The issuance RPC marks its own transaction with a transaction-local
--     GUC (`app.seed_invoice_items`), and the immutability trigger allows
--     line-item inserts/deletes ONLY while that flag is set. Direct
--     client mutations of finalized invoice items remain fully blocked.
--   * The stored draft flag is read into its own variable so the caller's
--     `p_is_draft` intent (finalize vs keep-draft) is preserved.
--
-- Safe to re-run: all statements are CREATE OR REPLACE / idempotent.
-- ====================================================================


-- ============================================================================
-- 1. FIXED RPC: TRANSACTION-SAFE ATOMIC INVOICE CREATION
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
  v_existing_is_draft BOOLEAN;  -- FIX: never clobber the p_is_draft parameter
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
    -- Verify target exists and is still a draft (FIX: use its own variable)
    SELECT id, is_draft, status INTO v_invoice_id, v_existing_is_draft, v_status
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
      SELECT invoice_number INTO v_invoice_number FROM public.invoices WHERE id = p_invoice_id;
      v_status := 'draft';
    END IF;

    -- Update invoice record with authoritative values
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
      v_invoice_number := 'DRAFT-' || SUBSTRING(gen_random_uuid()::text, 1, 8);
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

  -- FIX: Allow THIS transaction to seed/replace the invoice's own line
  -- items. Transaction-local (is_local = true), so the flag never leaks
  -- to other sessions or statements outside this RPC call.
  PERFORM set_config('app.seed_invoice_items', '1', TRUE);

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

  -- Insert audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_user_id,
    CASE WHEN p_is_draft THEN 'INVOICE_DRAFT_SAVED' ELSE 'INVOICE_FINALIZED' END,
    'invoices',
    v_invoice_id::text,
    jsonb_build_object(
      'invoice_number', v_invoice_number,
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
-- 2. FIXED TRIGGER: STRICT LINE ITEM IMMUTABILITY
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
  -- The issuance RPC seeds/replaces its own invoice's line items within the
  -- same transaction (transaction-local GUC). All DIRECT client mutations
  -- of finalized invoice items remain strictly blocked.
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
