import { authenticateCaller, checkRateLimit, reply } from './_utils.js';

export default async function handler(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`audit:${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Rate limit exceeded. Please try again in a moment.' });
  }

  try {
    // 1. GET: Query Audit Ledger (Strictly Administrator Only)
    if (req.method === 'GET') {
      const { admin } = await authenticateCaller(req, true);

      const url = new URL(req.url, 'http://localhost');
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const actionFilter = (url.searchParams.get('action') || '').trim();
      const userFilter = (url.searchParams.get('user_id') || '').trim();

      let query = admin
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (actionFilter) {
        query = query.eq('action', actionFilter);
      }
      if (userFilter) {
        query = query.eq('user_id', userFilter);
      }

      const { data: logs, count, error } = await query;
      if (error) throw error;

      // Enrich user names from profiles
      const userIds = [...new Set((logs || []).map(l => l.user_id).filter(Boolean))];
      let profileMap = new Map();
      if (userIds.length > 0) {
        const { data: profs } = await admin
          .from('profiles')
          .select('id, email, full_name, role')
          .in('id', userIds);
        profs?.forEach(p => profileMap.set(p.id, p));
      }

      const enriched = (logs || []).map(log => {
        const prof = profileMap.get(log.user_id);
        return {
          ...log,
          actor_email: prof?.email || 'System',
          actor_name: prof?.full_name || 'System',
          actor_role: prof?.role || 'system'
        };
      });

      return reply(res, 200, {
        logs: enriched,
        total: count || 0,
        limit,
        offset
      });
    }

    // 2. POST: Record Client-Reported Session Event (Strictly Narrowed Scope)
    if (req.method === 'POST') {
      const { user, profile, admin } = await authenticateCaller(req, false);
      const { action } = req.body || {};

      // Trust Boundary Enforcement:
      // Clients may NOT submit privileged audit actions (role changes, deactivations, financial events).
      // Only client-reported session telemetry is accepted, and clearly tagged as client-reported.
      const allowedClientActions = [
        'CLIENT_SIGN_IN_REPORTED',
        'CLIENT_SIGN_OUT_REPORTED'
      ];

      if (!action || !allowedClientActions.includes(action)) {
        return reply(res, 400, {
          error: 'Forbidden: Clients cannot submit arbitrary or privileged audit actions. Privileged events are recorded strictly by trusted server operations.'
        });
      }

      const now = new Date().toISOString();

      // Record in audit ledger with verified actor ID and server-derived IP address
      const { error: insertErr } = await admin.from('audit_logs').insert({
        user_id: user.id,
        action,
        entity_type: 'client_session',
        entity_id: user.id,
        details: {
          event_origin: 'client_reported',
          verified_user_id: user.id,
          email: profile.email,
          role: profile.role,
          recorded_at: now
        },
        ip_address: clientIp
      });

      if (insertErr) throw insertErr;

      // Update timestamps in profiles gracefully
      try {
        if (action === 'CLIENT_SIGN_IN_REPORTED') {
          await admin
            .from('profiles')
            .update({ last_sign_in_at: now, last_activity_at: now, updated_at: now })
            .eq('id', user.id);
        } else if (action === 'CLIENT_SIGN_OUT_REPORTED') {
          await admin
            .from('profiles')
            .update({ last_sign_out_at: now, last_activity_at: now, updated_at: now })
            .eq('id', user.id);
        }
      } catch (profileUpdateErr) {
        console.warn('Profile timestamp update notice:', profileUpdateErr?.message);
      }

      return reply(res, 201, { ok: true, action, recorded_at: now });
    }

    return reply(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Audit API error:', err);
    const status = err.status || 500;
    return reply(res, status, { error: err.message || 'Internal server error' });
  }
}
