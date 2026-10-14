import { clients, normalizeEmail, checkRateLimit, reply } from './_utils.js';
import { timingSafeEqual } from 'node:crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return reply(res, 405, { error: 'Method not allowed' });
  }

  // Rate limiting (max 5 attempts per 15 minutes)
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`bootstrap:${clientIp}`, 5, 15 * 60 * 1000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Too many bootstrap requests. Please try again later.' });
  }

  try {
    const configuredSecret = process.env.BOOTSTRAP_SECRET;
    if (!configuredSecret || configuredSecret.length < 16) {
      return reply(res, 500, {
        error: 'Bootstrap authorization error: BOOTSTRAP_SECRET is not configured or insufficient entropy in server environment.'
      });
    }

    const providedSecret = req.headers['x-bootstrap-secret'] || req.body?.bootstrap_secret || '';

    // Constant-time comparison to prevent timing attacks
    const providedBuffer = Buffer.from(String(providedSecret));
    const targetBuffer = Buffer.from(String(configuredSecret));

    if (providedBuffer.length !== targetBuffer.length || !timingSafeEqual(providedBuffer, targetBuffer)) {
      return reply(res, 403, { error: 'Access Denied: Invalid or missing bootstrap secret authorization.' });
    }

    const { admin } = clients();
    if (!admin) {
      return reply(res, 500, {
        error: 'Server configuration error: SUPABASE_SERVICE_ROLE_KEY is required to bootstrap the primary administrator.'
      });
    }

    const { email, password, full_name = 'MADHU M. S.' } = req.body || {};
    const normalized = normalizeEmail(email);
    const cleanPassword = (password || '').trim();
    const cleanName = (full_name || '').trim();

    if (!normalized || !/^\S+@\S+\.\S+$/.test(normalized)) {
      return reply(res, 400, { error: 'Valid administrator email address is required.' });
    }

    if (!cleanPassword || cleanPassword.length < 8) {
      return reply(res, 400, { error: 'Administrator password must be at least 8 characters long.' });
    }

    // 1. Permanent Lock: Check if an active administrator already exists
    const { data: existingAdmin, error: checkError } = await admin
      .from('profiles')
      .select('id, email')
      .eq('role', 'admin')
      .limit(1)
      .maybeSingle();

    if (checkError) {
      console.error('Check admin profile error:', checkError);
    }

    if (existingAdmin) {
      return reply(res, 403, {
        error: 'System administrator is already established. Bootstrap is permanently locked.'
      });
    }

    // 2. Check if users already exist in auth.users
    const { data: userList } = await admin.auth.admin.listUsers();
    if (userList?.users?.length > 0) {
      const existingConfirmed = userList.users.some(u => u.email_confirmed_at || u.confirmed_at);
      if (existingConfirmed) {
        return reply(res, 403, {
          error: 'System is already initialized with existing users. Bootstrap is permanently disabled.'
        });
      }
    }

    // 3. Create administrator in Supabase Auth
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalized,
      password: cleanPassword,
      email_confirm: true,
      user_metadata: {
        full_name: cleanName,
        role: 'admin'
      }
    });

    if (createError) {
      return reply(res, 400, { error: createError.message });
    }

    const userId = created.user.id;

    // 4. Initialize Profile and Company Settings atomically via database RPC
    const { error: rpcError } = await admin.rpc('bootstrap_admin_account', {
      p_user_id: userId,
      p_email: normalized,
      p_full_name: cleanName
    });

    if (rpcError) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch (cleanupErr) {
        console.warn('Bootstrap cleanup notice:', cleanupErr?.message);
      }
      throw rpcError;
    }

    return reply(res, 201, {
      ok: true,
      message: 'Primary Administrator successfully initialized and provisioned. Bootstrap is now permanently locked.'
    });
  } catch (err) {
    console.error('Bootstrap admin fatal error:', err);
    return reply(res, 500, { error: 'Admin setup failed: ' + (err.message || String(err)) });
  }
}
