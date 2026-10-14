import { authenticateCaller, checkRateLimit, reply, safeAuditLog } from './_utils.js';

export default async function handler(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`users:${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Rate limit exceeded. Please try again in a moment.' });
  }

  try {
    // All user management operations strictly require an active Administrator
    const { user: callerUser, profile: callerProfile, admin } = await authenticateCaller(req, true);

    // ========================================================================
    // 1. GET: Fetch Team Members, Metrics & Enriched Auth Metadata
    // ========================================================================
    if (req.method === 'GET') {
      // 1a. Fetch profiles
      const { data: profiles, error: profError } = await admin
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profError) throw profError;

      // 1b. Fetch Auth metadata from Supabase Auth admin API
      let authUsers = [];
      try {
        const { data: authData, error: authListError } = await admin.auth.admin.listUsers();
        if (!authListError && authData?.users) {
          authUsers = authData.users;
        }
      } catch (authErr) {
        console.warn('Could not list auth users:', authErr);
      }

      const authMap = new Map();
      authUsers.forEach(u => authMap.set(u.id, u));

      // 1c. Fetch active invitations count
      const nowIso = new Date().toISOString();
      const { count: pendingInvitesCount } = await admin
        .from('signup_invites')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('expires_at', nowIso);

      // 1d. Identify users with financial records (invoices or payments)
      const { data: invoiceCreators } = await admin
        .from('invoices')
        .select('created_by');

      const { data: paymentRecorders } = await admin
        .from('payments')
        .select('recorded_by, reversed_by');

      const financialUserIds = new Set();
      invoiceCreators?.forEach(i => { if (i.created_by) financialUserIds.add(i.created_by); });
      paymentRecorders?.forEach(p => {
        if (p.recorded_by) financialUserIds.add(p.recorded_by);
        if (p.reversed_by) financialUserIds.add(p.reversed_by);
      });

      // 1e. Enrich team members
      const enrichedUsers = (profiles || []).map(p => {
        const authUser = authMap.get(p.id);
        const lastSignIn = p.last_sign_in_at || authUser?.last_sign_in_at || null;
        const lastSignOut = p.last_sign_out_at || null;
        const lastActivity = p.last_activity_at || lastSignIn || null;
        const hasFinancialHistory = financialUserIds.has(p.id);

        return {
          id: p.id,
          email: p.email,
          full_name: p.full_name || 'Team Member',
          role: p.role,
          is_active: p.is_active !== false,
          created_at: p.created_at,
          last_sign_in_at: lastSignIn,
          last_sign_out_at: lastSignOut,
          last_activity_at: lastActivity,
          has_financial_records: hasFinancialHistory
        };
      });

      const totalUsers = enrichedUsers.length;
      const activeUsers = enrichedUsers.filter(u => u.is_active).length;
      const inactiveUsers = enrichedUsers.filter(u => !u.is_active).length;

      return reply(res, 200, {
        users: enrichedUsers,
        metrics: {
          total_users: totalUsers,
          active_users: activeUsers,
          inactive_users: inactiveUsers,
          pending_invites: pendingInvitesCount || 0
        }
      });
    }

    // ========================================================================
    // 2. PATCH: Activate, Deactivate, Change Role, Revoke Sessions
    // ========================================================================
    if (req.method === 'PATCH') {
      const { id, action, role: newRole } = req.body || {};
      if (!id) {
        return reply(res, 400, { error: 'Target user ID is required.' });
      }

      // Fetch target user profile
      const { data: targetProfile, error: targetErr } = await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', id)
        .maybeSingle();

      if (targetErr || !targetProfile) {
        return reply(res, 404, { error: 'Target user account not found.' });
      }

      // Helper: Count total active admins
      const getActiveAdminCount = async () => {
        const { count } = await admin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true);
        return count || 0;
      };

      const now = new Date().toISOString();

      // 2a. ACTIVATE USER
      if (action === 'activate') {
        const { error: updateErr } = await admin
          .from('profiles')
          .update({ is_active: true, updated_at: now })
          .eq('id', id);

        if (updateErr) throw updateErr;

        await safeAuditLog(admin, {
          user_id: callerUser.id,
          action: 'USER_ACTIVATED',
          entity_type: 'profiles',
          entity_id: id,
          details: { email: targetProfile.email, role: targetProfile.role }
        });

        return reply(res, 200, {
          ok: true,
          message: `User account for ${targetProfile.email} has been activated.`
        });
      }

      // 2b. DEACTIVATE USER
      if (action === 'deactivate') {
        // Prevent Admin self-deactivation
        if (id === callerUser.id) {
          return reply(res, 400, {
            error: 'Self-deactivation is prohibited. You cannot deactivate your own administrative account.'
          });
        }

        // Prevent deactivating the last active Admin
        if (targetProfile.role === 'admin' && targetProfile.is_active) {
          const activeAdmins = await getActiveAdminCount();
          if (activeAdmins <= 1) {
            return reply(res, 400, {
              error: 'Cannot deactivate the last active Administrator. At least one active Administrator must remain.'
            });
          }
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update({ is_active: false, updated_at: now })
          .eq('id', id);

        if (updateErr) throw updateErr;

        // Invalidate all active sessions for this user in Supabase Auth
        try {
          await admin.auth.admin.signOut(id, 'global');
        } catch (signOutErr) {
          console.warn('Session revocation notice:', signOutErr?.message);
        }

        await safeAuditLog(admin, {
          user_id: callerUser.id,
          action: 'USER_DEACTIVATED',
          entity_type: 'profiles',
          entity_id: id,
          details: { email: targetProfile.email, role: targetProfile.role }
        });

        return reply(res, 200, {
          ok: true,
          message: `User account for ${targetProfile.email} has been deactivated and active sessions revoked.`
        });
      }

      // 2c. CHANGE ROLE
      if (action === 'change_role') {
        if (!newRole || !['admin', 'staff'].includes(newRole)) {
          return reply(res, 400, { error: 'Valid role (admin or staff) is required.' });
        }

        if (targetProfile.role === newRole) {
          return reply(res, 400, { error: `User is already assigned the '${newRole}' role.` });
        }

        // Prevent Admin self-demotion
        if (id === callerUser.id && newRole !== 'admin') {
          return reply(res, 400, {
            error: 'Self-demotion is prohibited. You cannot demote your own administrative role.'
          });
        }

        // Prevent demoting the last active Admin
        if (targetProfile.role === 'admin' && newRole === 'staff' && targetProfile.is_active) {
          const activeAdmins = await getActiveAdminCount();
          if (activeAdmins <= 1) {
            return reply(res, 400, {
              error: 'Cannot demote the last active Administrator. At least one active Administrator must remain.'
            });
          }
        }

        const { error: updateErr } = await admin
          .from('profiles')
          .update({ role: newRole, updated_at: now })
          .eq('id', id);

        if (updateErr) throw updateErr;

        // Update Supabase Auth user_metadata
        try {
          await admin.auth.admin.updateUserById(id, { user_metadata: { role: newRole } });
        } catch (metaErr) {
          console.warn('Auth metadata update notice:', metaErr?.message);
        }

        await safeAuditLog(admin, {
          user_id: callerUser.id,
          action: 'USER_ROLE_CHANGED',
          entity_type: 'profiles',
          entity_id: id,
          details: {
            email: targetProfile.email,
            previous_role: targetProfile.role,
            new_role: newRole
          }
        });

        return reply(res, 200, {
          ok: true,
          message: `Role for ${targetProfile.email} successfully updated to ${newRole.toUpperCase()}.`
        });
      }

      // 2d. REVOKE SESSIONS
      if (action === 'revoke_sessions') {
        try {
          await admin.auth.admin.signOut(id, 'global');
        } catch (signOutErr) {
          console.warn('Session revocation notice:', signOutErr?.message);
        }

        await safeAuditLog(admin, {
          user_id: callerUser.id,
          action: 'USER_SESSIONS_REVOKED',
          entity_type: 'profiles',
          entity_id: id,
          details: { email: targetProfile.email }
        });

        return reply(res, 200, {
          ok: true,
          message: `Active session tokens for ${targetProfile.email} have been revoked.`
        });
      }

      return reply(res, 400, { error: `Unsupported action: '${action}'.` });
    }

    // ========================================================================
    // 3. DELETE: Safe Account Removal with Financial Dependency Guard
    // ========================================================================
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        return reply(res, 400, { error: 'Target user ID is required.' });
      }

      // Prevent Admin self-deletion
      if (id === callerUser.id) {
        return reply(res, 400, {
          error: 'Self-deletion is prohibited. You cannot delete your own administrative account.'
        });
      }

      // Fetch target user profile
      const { data: targetProfile, error: targetErr } = await admin
        .from('profiles')
        .select('id, email, full_name, role, is_active')
        .eq('id', id)
        .maybeSingle();

      if (targetErr || !targetProfile) {
        return reply(res, 404, { error: 'Target user account not found.' });
      }

      // Prevent deleting the last active Admin
      if (targetProfile.role === 'admin' && targetProfile.is_active) {
        const { count: activeAdmins } = await admin
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('is_active', true);

        if ((activeAdmins || 0) <= 1) {
          return reply(res, 400, {
            error: 'Cannot delete the last active Administrator. At least one active Administrator must remain.'
          });
        }
      }

      // Dependency Check: Query all foreign-key dependent records (financial, invitation, audit ledger)
      const [
        { count: invCount },
        { count: payRecCount },
        { count: payRevCount },
        { count: invCreatedCount },
        { count: invRedeemedCount },
        { count: invRevokedCount },
        { count: auditCount }
      ] = await Promise.all([
        admin.from('invoices').select('*', { count: 'exact', head: true }).eq('created_by', id),
        admin.from('payments').select('*', { count: 'exact', head: true }).eq('recorded_by', id),
        admin.from('payments').select('*', { count: 'exact', head: true }).eq('reversed_by', id),
        admin.from('signup_invites').select('*', { count: 'exact', head: true }).eq('created_by', id),
        admin.from('signup_invites').select('*', { count: 'exact', head: true }).eq('redeemed_by', id),
        admin.from('signup_invites').select('*', { count: 'exact', head: true }).eq('revoked_by', id),
        admin.from('audit_logs').select('*', { count: 'exact', head: true }).eq('user_id', id)
      ]);

      const financialDeps = (invCount || 0) + (payRecCount || 0) + (payRevCount || 0);
      const inviteDeps = (invCreatedCount || 0) + (invRedeemedCount || 0) + (invRevokedCount || 0);
      const auditDeps = auditCount || 0;
      const totalDependencies = financialDeps + inviteDeps + auditDeps;

      if (totalDependencies > 0) {
        const details = [];
        if (financialDeps > 0) details.push(`${invCount || 0} invoices, ${(payRecCount || 0) + (payRevCount || 0)} payment records`);
        if (inviteDeps > 0) details.push(`${inviteDeps} invitation operations`);
        if (auditDeps > 0) details.push(`${auditDeps} immutable audit logs`);

        return reply(res, 400, {
          error: `Permanent account deletion is prohibited because ${targetProfile.email} has ${totalDependencies} associated system records (${details.join(', ')}). Statutory financial, GST, and audit compliance requires permanent attribution retention. Please use 'Deactivate Account' instead to revoke all system access while preserving historical attribution.`,
          can_deactivate: true,
          dependencies: {
            financial: financialDeps,
            invitations: inviteDeps,
            audit: auditDeps
          }
        });
      }

      // Check audit logs references (if needed, unlinked users can be cleaned)
      // If 0 financial records, proceed with permanent deletion
      const { error: profileDeleteErr } = await admin
        .from('profiles')
        .delete()
        .eq('id', id);

      if (profileDeleteErr) throw profileDeleteErr;

      // Delete from Supabase Auth
      try {
        await admin.auth.admin.deleteUser(id);
      } catch (authDeleteErr) {
        console.warn('Auth user deletion notice:', authDeleteErr?.message);
      }

      await safeAuditLog(admin, {
        user_id: callerUser.id,
        action: 'USER_DELETED',
        entity_type: 'profiles',
        entity_id: id,
        details: { email: targetProfile.email, role: targetProfile.role }
      });

      return reply(res, 200, {
        ok: true,
        message: `Account for ${targetProfile.email} has been permanently deleted.`
      });
    }

    return reply(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Users API error:', err);
    const status = err.status || 500;
    return reply(res, status, { error: err.message || 'Internal server error' });
  }
}
