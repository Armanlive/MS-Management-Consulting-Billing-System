-- ============================================================================
-- SAFE NON-DESTRUCTIVE ROLLBACK SCRIPT (SECURITY HARDENED)
-- Migration: 20261011010000_enterprise_rbac_and_user_governance.sql
-- Target: Supabase PostgreSQL Database
-- ============================================================================
-- SAFETY & COMPLIANCE INVARIANTS:
-- 1. Database-level protection of the LAST ACTIVE ADMINISTRATOR is PERMANENT.
--    Under no circumstances may a rollback remove protections against deleting,
--    demoting, or deactivating the sole active administrator.
-- 2. Protects against authorized Admin mistakes, privileged service-role calls,
--    and concurrent transactions via pg_advisory_xact_lock.
-- 3. DOES NOT drop tracking columns by default, preserving historical
--    sign-in, sign-out, and activity telemetry records.
-- 4. Audit log writes remain completely revoked for ordinary clients.
-- ============================================================================

-- 1. HARDENED GOVERNANCE TRIGGER FUNCTION (PRESERVES LAST-ADMIN PROTECTION)
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
  -- 1A. DELETE OPERATIONS (BEFORE DELETE)
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
  -- 1B. UPDATE OPERATIONS (BEFORE UPDATE)
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

-- 2. REATTACH TRIGGER TO public.profiles FOR BOTH UPDATE AND DELETE
DROP TRIGGER IF EXISTS trigger_protect_profile_privileges ON public.profiles;
CREATE TRIGGER trigger_protect_profile_privileges
BEFORE UPDATE OR DELETE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_privileges();

-- 3. AFFIRM AUDIT LOG TRUST BOUNDARY
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon;
