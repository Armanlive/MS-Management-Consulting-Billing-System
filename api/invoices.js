import { clients, checkRateLimit, reply, authenticateCaller, safeAuditLog } from './_utils.js';

export default async function handler(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`invoices:${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Rate limit exceeded. Please try again in a moment.' });
  }

  try {
    // Only active administrators can delete invoices
    const { user, profile, admin } = await authenticateCaller(req, true);

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        return reply(res, 400, { error: 'Invoice ID is required' });
      }

      // Check invoice existence
      const { data: inv, error: fetchErr } = await admin
        .from('invoices')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!inv) {
        return reply(res, 404, { error: 'Invoice not found' });
      }

      // Check if any payment records exist
      const { data: pays, error: payErr } = await admin
        .from('payments')
        .select('id, amount')
        .eq('invoice_id', id);

      if (payErr) throw payErr;
      if (pays && pays.length > 0) {
        return reply(res, 400, {
          error: `Cannot delete invoice ${inv.invoice_number} because it has ${pays.length} associated payment record(s). Please delete all payments in Payment Tracking first.`
        });
      }

      // Delete invoice (ON DELETE CASCADE removes invoice_items automatically)
      const { error: delErr } = await admin
        .from('invoices')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;

      // Record audit event
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'INVOICE_DELETED',
        entity_type: 'invoices',
        entity_id: id,
        details: {
          invoice_number: inv.invoice_number,
          customer_id: inv.customer_id,
          total: inv.total,
          status: inv.status,
          is_draft: inv.is_draft,
          deleted_by: profile.email
        }
      });

      return reply(res, 200, {
        ok: true,
        message: `Invoice ${inv.invoice_number} successfully deleted.`
      });
    }

    return reply(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Invoices API error:', err);
    const status = err.status || 500;
    return reply(res, status, { error: err.message || 'Internal server error' });
  }
}
