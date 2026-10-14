import { clients, code, hash, normalizeEmail, checkRateLimit, reply, safeAuditLog } from './_utils.js';

export default async function handler(req, res) {
  // Apply rate limiting (30 requests per minute)
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`invite:${clientIp}`, 30, 60000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Rate limit exceeded. Please try again in a moment.' });
  }

  try {
    const { admin, publicClient } = clients();
    if (!admin) {
      return reply(res, 500, {
        error: 'Server security configuration error: SUPABASE_SERVICE_ROLE_KEY is required on server to manage secure invitations.'
      });
    }

    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return reply(res, 401, { error: 'Authentication required' });
    }

    const { data: { user }, error: authError } = await publicClient.auth.getUser(token);
    if (authError || !user) {
      return reply(res, 401, { error: 'Invalid or expired session. Please sign in again.' });
    }

    // Verify requester is an active Administrator in PostgreSQL profiles table
    const { data: profile, error: profError } = await admin
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (profError || profile?.role !== 'admin' || !profile?.is_active) {
      return reply(res, 403, { error: 'Forbidden: Active Administrator privileges are required to manage invitations.' });
    }

    // 1. GET: List all invitations
    if (req.method === 'GET') {
      const { data: invites, error } = await admin
        .from('signup_invites')
        .select('id, email, role, status, expires_at, used_at, redeemed_by, revoked_at, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return reply(res, 200, { invites: invites || [] });
    }

    // 2. DELETE: Permanently delete an invitation or Revoke
    if (req.method === 'DELETE' && req.body?.action === 'delete') {
      const { id } = req.body || {};
      if (!id) return reply(res, 400, { error: 'Invitation ID is required' });

      const { data: existingInvite, error: fetchErr } = await admin
        .from('signup_invites')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!existingInvite) {
        return reply(res, 404, { error: 'Invitation not found.' });
      }

      const { error: delErr } = await admin
        .from('signup_invites')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'INVITATION_DELETED',
        entity_type: 'signup_invites',
        entity_id: id,
        details: { email: existingInvite.email, role: existingInvite.role, status: existingInvite.status, deleted_by: profile.email }
      });

      return reply(res, 200, { ok: true, message: `Invitation for ${existingInvite.email} permanently deleted.` });
    }

    if (req.method === 'DELETE' || (req.method === 'PATCH' && req.body?.action === 'revoke')) {
      const { id } = req.body || {};
      if (!id) return reply(res, 400, { error: 'Invitation ID is required' });

      const now = new Date().toISOString();
      const { data: updated, error } = await admin
        .from('signup_invites')
        .update({
          status: 'revoked',
          revoked_at: now,
          revoked_by: user.id
        })
        .eq('id', id)
        .is('used_at', null)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!updated) {
        return reply(res, 400, { error: 'Invitation could not be revoked (may be already redeemed or not found).' });
      }

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'INVITATION_REVOKED',
        entity_type: 'signup_invites',
        entity_id: id,
        details: { email: updated.email, revoked_at: now }
      });

      return reply(res, 200, { ok: true, message: 'Invitation successfully revoked.' });
    }

    // 2b. PATCH: Reissue an invitation
    if (req.method === 'PATCH' && req.body?.action === 'reissue') {
      const { id, hours = 48 } = req.body || {};
      if (!id) return reply(res, 400, { error: 'Invitation ID is required' });

      const { data: existingInvite, error: fetchErr } = await admin
        .from('signup_invites')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !existingInvite) {
        return reply(res, 404, { error: 'Invitation not found.' });
      }

      if (existingInvite.status === 'redeemed' || existingInvite.used_at) {
        return reply(res, 400, { error: 'Cannot reissue an invitation that has already been redeemed.' });
      }

      // Generate new cryptographically secure one-time invitation code
      const rawCode = code();
      const codeHash = hash(rawCode);
      const validityHours = Math.min(168, Math.max(1, Number(hours) || 48));
      const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000).toISOString();

      const { data: updated, error: updateErr } = await admin
        .from('signup_invites')
        .update({
          code_hash: codeHash,
          status: 'active',
          expires_at: expiresAt,
          reserved_at: null,
          revoked_at: null,
          revoked_by: null
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'INVITATION_REISSUED',
        entity_type: 'signup_invites',
        entity_id: id,
        details: { email: updated.email, role: updated.role, expires_at: expiresAt }
      });

      return reply(res, 200, {
        ok: true,
        code: rawCode,
        id: updated.id,
        email: updated.email,
        role: updated.role,
        expires_at: expiresAt,
        message: 'A fresh one-time invitation code has been generated. Share this code securely with the recipient.'
      });
    }

    // 3. POST: Generate new invitation
    if (req.method === 'POST') {
      const { email, role = 'staff', hours = 48 } = req.body || {};
      const normalizedEmail = normalizeEmail(email);

      if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail) || !['admin', 'staff'].includes(role)) {
        return reply(res, 400, { error: 'Valid recipient email address and role (admin/staff) are required.' });
      }

      // Check if user is already an active member in profiles
      const { data: existingUser } = await admin
        .from('profiles')
        .select('id, is_active')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (existingUser) {
        return reply(res, 400, { error: 'An account with this email address already exists.' });
      }

      // Generate cryptographically secure one-time invitation code
      const rawCode = code();
      const codeHash = hash(rawCode);
      const validityHours = Math.min(168, Math.max(1, Number(hours) || 48)); // 1 hour to 7 days
      const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000).toISOString();

      const { data: insertedInvite, error: insertError } = await admin
        .from('signup_invites')
        .insert({
          email: normalizedEmail,
          role,
          code_hash: codeHash,
          status: 'active',
          expires_at: expiresAt,
          created_by: user.id
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'INVITATION_ISSUED',
        entity_type: 'signup_invites',
        entity_id: insertedInvite.id,
        details: { email: normalizedEmail, role, expires_at: expiresAt }
      });

      // Return plaintext code strictly on creation only
      return reply(res, 201, {
        ok: true,
        code: rawCode,
        id: insertedInvite.id,
        email: normalizedEmail,
        role,
        expires_at: expiresAt,
        message: 'Share this one-time invitation code securely with the recipient. This plaintext code cannot be retrieved again.'
      });
    }

    return reply(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    console.error('Invite API error:', e);
    return reply(res, 500, { error: 'Unable to process invitation: ' + (e.message || String(e)) });
  }
}
