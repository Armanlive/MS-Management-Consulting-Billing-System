-- ============================================================================
-- INCREMENTAL MIGRATION: INVITATION LIFECYCLE & FIRST-ADMIN BOOTSTRAP FIX
-- MS Management Consulting Billing System
-- Target Project: https://ilnvomvotfmqaiurkhde.supabase.co
-- ============================================================================
-- NOTE: This migration is strictly incremental and idempotent.
-- It does NOT drop or recreate existing tables (profiles, company_settings, etc.)
-- ============================================================================

-- 1. ADD MISSING INVITATION LIFECYCLE COLUMNS TO signup_invites
ALTER TABLE public.signup_invites
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.signup_invites
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

ALTER TABLE public.signup_invites
  ADD COLUMN IF NOT EXISTS redeemed_by UUID REFERENCES auth.users(id);

ALTER TABLE public.signup_invites
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE public.signup_invites
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id);

-- 2. ADD STATUS CHECK CONSTRAINT SAFELY
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'signup_invites_status_check'
  ) THEN
    ALTER TABLE public.signup_invites
      ADD CONSTRAINT signup_invites_status_check
      CHECK (status IN ('active', 'reserved', 'redeemed', 'revoked', 'expired'));
  END IF;
END $$;

-- 3. INDEXES FOR INVITATION QUERY OPTIMIZATION
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.signup_invites(status);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.signup_invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_hash ON public.signup_invites(code_hash);

-- 4. CONCURRENCY-SAFE FIRST-ADMIN BOOTSTRAP FUNCTION
-- Ensures atomic execution with transaction-level advisory locking
CREATE OR REPLACE FUNCTION public.bootstrap_admin_account(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Obtain exclusive transaction advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('ms_consulting_bootstrap_admin_lock'));

  -- Reject if an administrator already exists
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'Administrator already established. Bootstrap is permanently locked.';
  END IF;

  -- Create primary admin profile
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (p_user_id, TRIM(LOWER(p_email)), TRIM(p_full_name), 'admin', TRUE, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    is_active = TRUE,
    updated_at = NOW();

  -- Initialize company settings with verified branding only if not already present
  INSERT INTO public.company_settings (
    id, business_name, issuer_name, address, state, state_code, gstin, pan, bank_name, account_name, account_number, ifsc
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    'MS Management Consulting',
    'MADHU M. S.',
    '', 'Karnataka', '29', '', '', '', '', '', ''
  ) ON CONFLICT (id) DO NOTHING;

  -- Immutable audit log entry
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    p_user_id,
    'INITIAL_ADMIN_BOOTSTRAPPED',
    'system',
    p_user_id::text,
    jsonb_build_object('email', TRIM(LOWER(p_email)), 'timestamp', NOW())
  );

  RETURN jsonb_build_object('success', TRUE, 'message', 'Primary Administrator successfully provisioned.');
END;
$$;

-- 5. ATOMIC INVITATION REDEMPTION FUNCTION
-- Locks invite row, checks validity, marks redeemed, and provisions profile atomically
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
  -- Row lock to prevent concurrent redemption attempts
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

  -- Create profile with role defined in invitation
  INSERT INTO public.profiles (id, email, full_name, role, is_active, created_at, updated_at)
  VALUES (p_user_id, v_norm_email, TRIM(p_full_name), v_invite.role, TRUE, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE SET
    full_name = TRIM(p_full_name),
    role = v_invite.role,
    is_active = TRUE,
    updated_at = NOW();

  -- Audit log entry
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

-- 6. STRICT PRIVILEGE HARDENING
-- Revoke execution from public, anon, and authenticated; grant strictly to service_role
REVOKE ALL ON FUNCTION public.bootstrap_admin_account(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_admin_account(UUID, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.redeem_signup_invite(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_signup_invite(UUID, TEXT, TEXT, TEXT) TO service_role;

-- 7. REINFORCE RLS ON signup_invites
ALTER TABLE public.signup_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_admin_select" ON public.signup_invites;
DROP POLICY IF EXISTS "invites_admin_write" ON public.signup_invites;

CREATE POLICY "invites_admin_select" ON public.signup_invites
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "invites_admin_write" ON public.signup_invites
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.signup_invites FROM PUBLIC, anon;
