-- ============================================================================
-- SECURE ROLLBACK SPECIFICATION & PROCEDURE
-- Migration Target: 20261013000000_billing_authorization_and_numbering_hardening.sql
-- MS Management Consulting Billing System
-- ============================================================================
--
-- SECURITY MANDATE & INVARIANT:
-- 1. Direct client execution of sequence allocation functions (get_next_invoice_number
--    and get_next_draft_number) MUST REMAIN REVOKED under all circumstances.
--    Granting direct EXECUTE to 'authenticated' or 'anon' creates an exploitable
--    vulnerability allowing serial sequence exhaustion, gap attacks, and bypassing
--    invoice creation audit trails.
-- 2. Number allocation is permitted ONLY within trusted SECURITY DEFINER RPCs
--    (create_invoice_with_items) running under controlled database transactions.
-- 3. Any rollback of migration 20261013000000 MUST PRESERVE these restrictions.
-- ============================================================================

-- 1. ENFORCE STRICT REVOCATION OF DIRECT SEQUENCE EXECUTION
-- Affirm that under NO circumstances are sequence generators directly callable by clients
REVOKE ALL ON FUNCTION public.get_next_invoice_number(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_next_draft_number(TEXT) FROM PUBLIC, anon, authenticated;

-- 2. RESTORATION OF FUNCTION PRIVILEGES
-- Explicit affirmation that authenticated users may only invoke the creation workflow:
GRANT EXECUTE ON FUNCTION public.create_invoice_with_items(UUID, DATE, DATE, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_member() TO authenticated;

-- ============================================================================
-- MANUAL RECOVERY & ROLLBACK PROCEDURE
-- ============================================================================
-- In the event that a functional defect requires rolling back migration 20261013000000:
--
-- Step 1: DO NOT re-grant EXECUTE on get_next_invoice_number or get_next_draft_number.
-- Step 2: Verify that public.is_active_member() continues to restrict access to
--         active users with valid roles ('admin', 'staff').
-- Step 3: If adjusting create_invoice_with_items, apply targeted bug fixes using a
--         new forward migration rather than stripping immutability triggers or
--         re-enabling direct sequence access.
-- Step 4: Run 'npm test' to verify that all 80+ security, RBAC, and numbering tests pass.
-- ============================================================================
