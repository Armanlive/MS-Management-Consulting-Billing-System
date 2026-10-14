import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';

export const hash = s => createHash('sha256').update(String(s || '')).digest('hex');

export const code = () => {
  const bytes = randomBytes(16);
  return 'INV-' + bytes.toString('hex').toUpperCase();
};

export const normalizeEmail = email => (email || '').trim().toLowerCase();

// In-memory sliding-window token rate limiter
const rateLimitBuckets = new Map();

export function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  let bucket = rateLimitBuckets.get(identifier);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 1, resetAt: now + windowMs };
    rateLimitBuckets.set(identifier, bucket);
    return { allowed: true, remaining: maxRequests - 1 };
  }
  if (bucket.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(0, bucket.resetAt - now)
    };
  }
  bucket.count += 1;
  return { allowed: true, remaining: maxRequests - bucket.count };
}

export function clients() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pub = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    const err = new Error('Server configuration missing: SUPABASE_URL');
    err.status = 500;
    throw err;
  }

  return {
    admin: secret ? createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } }) : null,
    publicClient: pub ? createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  };
}

export const reply = (res, status, body) => res.status(status).json(body);

export async function authenticateCaller(req, requireAdmin = false) {
  const { admin, publicClient } = clients();
  if (!admin || !publicClient) {
    const err = new Error('Server security configuration error: Database client configuration missing.');
    err.status = 500;
    throw err;
  }

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }

  const { data: { user }, error: authError } = await publicClient.auth.getUser(token);
  if (authError || !user) {
    const err = new Error('Invalid or expired session. Please sign in again.');
    err.status = 401;
    throw err;
  }

  const { data: profile, error: profError } = await admin
    .from('profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (profError || !profile || !profile.is_active) {
    const err = new Error('Forbidden: Account is deactivated or not found.');
    err.status = 403;
    throw err;
  }

  if (requireAdmin && profile.role !== 'admin') {
    const err = new Error('Forbidden: Active Administrator privileges are required.');
    err.status = 403;
    throw err;
  }

  return { user, profile, admin, publicClient };
}

export async function safeAuditLog(admin, entry) {
  if (!admin || !entry) return;
  try {
    const { error } = await admin.from('audit_logs').insert(entry);
    if (error) {
      console.warn('Audit log write notice:', error.message || error);
    }
  } catch (err) {
    console.warn('Audit log write notice:', err?.message || err);
  }
}
