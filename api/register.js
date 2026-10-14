import { clients, hash, normalizeEmail, checkRateLimit, reply, safeAuditLog } from './_utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return reply(res, 405, { error: 'Method not allowed' });
  }

  // 1. Rate limiting (max 10 registration attempts per 15 minutes per IP)
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`register:${clientIp}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) {
    return reply(res, 429, {
      error: 'Too many registration attempts. Please wait a few minutes before trying again.'
    });
  }

  try {
    const { email, password, confirm_password, full_name, invite_code } = req.body || {};

    const normalizedEmail = normalizeEmail(email);
    const cleanPassword = (password || '').trim();
    const cleanConfirm = (confirm_password || '').trim();
    const cleanName = (full_name || '').trim();
    const cleanCode = (invite_code || '').trim();

    // 2. Strict Payload Validation
    if (!cleanCode) {
      return reply(res, 400, { error: 'A valid single-use invitation code is required to register.' });
    }

    if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return reply(res, 400, { error: 'A valid email address is required.' });
    }

    if (!cleanName) {
      return reply(res, 400, { error: 'Full legal name is required.' });
    }

    if (!cleanPassword || cleanPassword.length < 8) {
      return reply(res, 400, { error: 'Password must be at least 8 characters long.' });
    }

    if (cleanConfirm && cleanPassword !== cleanConfirm) {
      return reply(res, 400, { error: 'Password confirmation does not match.' });
    }

    const { admin } = clients();
    if (!admin) {
      return reply(res, 500, {
        error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is required to process invitations.'
      });
    }

    // 3. Cryptographic Invitation Lookup
    const submittedHash = hash(cleanCode);

    const { data: invite, error: fetchErr } = await admin
      .from('signup_invites')
      .select('id, email, role, status, expires_at, used_at, reserved_at')
      .eq('code_hash', submittedHash)
      .maybeSingle();

    if (fetchErr) {
      console.error('Database query error on invite lookup:', fetchErr);
      return reply(res, 500, { error: 'Unable to verify invitation at this time.' });
    }

    if (!invite) {
      return reply(res, 400, { error: 'Invalid invitation code.' });
    }

    // 4. Verify Invitation State & Binding
    if (invite.status === 'revoked') {
      return reply(res, 400, { error: 'This invitation code has been revoked by an administrator.' });
    }

    if (invite.status === 'redeemed' || invite.used_at) {
      return reply(res, 400, { error: 'This invitation code has already been redeemed and cannot be reused.' });
    }

    if (new Date(invite.expires_at) <= new Date()) {
      return reply(res, 400, { error: 'This invitation code has expired.' });
    }

    if (invite.email.toLowerCase() !== normalizedEmail) {
      return reply(res, 400, { error: 'This invitation code was issued for a different email address.' });
    }

    // 5. Concurrency Protection: Atomically reserve the invitation
    const reservationTime = new Date().toISOString();
    const { data: reservedInvite, error: reserveErr } = await admin
      .from('signup_invites')
      .update({
        status: 'reserved',
        reserved_at: reservationTime
      })
      .eq('id', invite.id)
      .eq('status', 'active')
      .is('used_at', null)
      .select()
      .maybeSingle();

    if (reserveErr || !reservedInvite) {
      return reply(res, 409, {
        error: 'This invitation is currently being processed or has already been redeemed.'
      });
    }

    // 6. Server-Side Supabase Auth Provisioning
    let newAuthUser = null;
    try {
      const { data: createdAuth, error: authCreateErr } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: cleanPassword,
        email_confirm: true,
        user_metadata: {
          full_name: cleanName,
          role: invite.role // Enforce the role assigned in invitation!
        }
      });

      if (authCreateErr) {
        throw authCreateErr;
      }

      newAuthUser = createdAuth?.user;
      if (!newAuthUser?.id) {
        throw new Error('Supabase Auth did not return a valid user identifier.');
      }
    } catch (authErr) {
      console.error('Auth provisioning error:', authErr);
      // Compensation: Revert the reservation so the valid invitation is not burned on failure
      try {
        await admin
          .from('signup_invites')
          .update({ status: 'active', reserved_at: null })
          .eq('id', invite.id);
      } catch (rollbackErr) {
        console.warn('Invite rollback notice:', rollbackErr?.message);
      }

      if (authErr.message?.toLowerCase().includes('already registered')) {
        return reply(res, 400, { error: 'An account with this email address is already registered. Please sign in.' });
      }

      return reply(res, 400, { error: authErr.message || 'Failed to create authentication user.' });
    }

    // 7. Profile Upsert and Final Invitation Redemption
    const redeemedTime = new Date().toISOString();
    try {
      // Create user profile with assigned role
      const { error: profileErr } = await admin.from('profiles').upsert({
        id: newAuthUser.id,
        email: normalizedEmail,
        full_name: cleanName,
        role: invite.role, // strictly role from invite
        is_active: true,
        updated_at: redeemedTime
      });

      if (profileErr) throw profileErr;

      // Mark invitation redeemed permanently
      const { error: redeemErr } = await admin
        .from('signup_invites')
        .update({
          status: 'redeemed',
          used_at: redeemedTime,
          redeemed_by: newAuthUser.id
        })
        .eq('id', invite.id);

      if (redeemErr) throw redeemErr;

      // Create Audit Log entry
      await safeAuditLog(admin, {
        user_id: newAuthUser.id,
        action: 'INVITATION_REDEEMED',
        entity_type: 'signup_invites',
        entity_id: invite.id,
        details: { email: normalizedEmail, role: invite.role, redeemed_at: redeemedTime }
      });

      return reply(res, 201, {
        ok: true,
        message: 'Account created successfully! You can now sign in with your email and password.',
        user: {
          id: newAuthUser.id,
          email: normalizedEmail,
          role: invite.role
        }
      });
    } catch (postAuthErr) {
      console.error('Post-auth profile setup error:', postAuthErr);
      // Compensation: If profile creation or redemption failed, roll back the created Auth user
      // and revert the invitation to active state to prevent orphaned users or burned invites
      if (newAuthUser?.id) {
        try {
          await admin.auth.admin.deleteUser(newAuthUser.id);
        } catch (cleanupErr) {
          console.warn('Auth user cleanup notice:', cleanupErr?.message);
        }
      }
      try {
        await admin
          .from('signup_invites')
          .update({ status: 'active', reserved_at: null })
          .eq('id', invite.id);
      } catch (rollbackErr) {
        console.warn('Invite rollback notice:', rollbackErr?.message);
      }

      return reply(res, 500, {
        error: 'Registration setup encountered an internal error. Please try again or contact your administrator.'
      });
    }
  } catch (err) {
    console.error('Registration handler fatal error:', err);
    return reply(res, 500, { error: 'An unexpected error occurred during registration.' });
  }
}
