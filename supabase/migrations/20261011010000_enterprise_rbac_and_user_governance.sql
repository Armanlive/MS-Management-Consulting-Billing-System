-- ============================================================================
-- INCREMENTAL MIGRATION: ENTERPRISE RBAC & USER GOVERNANCE (REVISED)
-- MS Management Consulting Billing System
-- Target: Supabase PostgreSQL Database
-- Version: 20261011010000
-- ============================================================================
-- AUDIT & COMPLIANCE GUARANTEES:
-- 1. Strictly incremental, idempotent, and non-destructive.
-- 2. Preserves all production users, live invoices, and company settings.
-- 3. Audit log trust boundary: All direct client writes (INSERT/UPDATE/DELETE)
--    to public.audit_logs remain completely revoked. No client-callable
--    privileged audit RPC functions are created.
-- 4. Database-level last-admin protection: Covers both UPDATE and DELETE.
--    Serializes concurrent administrative operations via transactional advisory lock
--    pg_advisory_xact_lock to prevent demotion/deletion race conditions.
-- 5. Administrative self-protection: Prevents self-demotion, self-deactivation,
--    and self-deletion directly in the database engine.
-- 6. Safe non-destructive rollback: Trigger and governance function can be
--    dropped without losing collected session/activity telemetry columns.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. USER PROFILES ACTIVITY TRACKING COLUMNS (NON-DESTRUCTIVE)
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_sign_in_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sign_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 2. TRIGGER: DATABASE-LEVEL PRIVILEGE, CONCURRENCY & LAST-ADMIN PROTECTION
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. AUDIT LOG LEDGER IMMUTABILITY & TRUST BOUNDARY ENFORCEMENT
-- ----------------------------------------------------------------------------
-- Ensure NO client-callable audit injection RPC exists
DROP FUNCTION IF EXISTS public.log_security_event(TEXT, TEXT, TEXT, JSONB, TEXT);

-- Reaffirm that direct client writes to audit_logs are completely revoked
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon;
