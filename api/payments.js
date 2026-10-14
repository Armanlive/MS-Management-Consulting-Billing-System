import { clients, checkRateLimit, reply, authenticateCaller, safeAuditLog } from './_utils.js';

export default async function handler(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown-client';
  const rate = checkRateLimit(`payments:${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return reply(res, 429, { error: 'Rate limit exceeded. Please try again in a moment.' });
  }

  try {
    // Only active administrators can edit or delete payments
    const { user, profile, admin } = await authenticateCaller(req, true);

    // 1. DELETE PAYMENT
    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) {
        return reply(res, 400, { error: 'Payment ID is required' });
      }

      // Fetch payment
      const { data: payment, error: fetchErr } = await admin
        .from('payments')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!payment) {
        return reply(res, 404, { error: 'Payment record not found' });
      }

      // Delete payment
      const { error: delErr } = await admin
        .from('payments')
        .delete()
        .eq('id', id);

      if (delErr) throw delErr;

      // Recalculate parent invoice payment status and amount_paid
      const { data: remainingPays, error: remErr } = await admin
        .from('payments')
        .select('amount, is_reversed')
        .eq('invoice_id', payment.invoice_id)
        .eq('is_reversed', false);

      if (remErr) throw remErr;

      const activePaid = (remainingPays || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const { data: parentInv } = await admin
        .from('invoices')
        .select('id, total, status')
        .eq('id', payment.invoice_id)
        .maybeSingle();

      if (parentInv && parentInv.status !== 'cancelled') {
        const newStatus = activePaid >= Number(parentInv.total) ? 'paid' : (activePaid > 0 ? 'partial' : 'unpaid');
        await admin.from('invoices').update({
          status: newStatus,
          updated_at: new Date().toISOString()
        }).eq('id', payment.invoice_id);
      }

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'PAYMENT_DELETED',
        entity_type: 'payments',
        entity_id: id,
        details: {
          invoice_id: payment.invoice_id,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          deleted_by: profile.email
        }
      });

      return reply(res, 200, {
        ok: true,
        message: 'Payment record successfully deleted.'
      });
    }

    // 2. PATCH PAYMENT (EDIT)
    if (req.method === 'PATCH') {
      const { id, amount, payment_date, method, reference, remarks } = req.body || {};
      if (!id) {
        return reply(res, 400, { error: 'Payment ID is required' });
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return reply(res, 400, { error: 'Valid payment amount is required' });
      }

      if (!payment_date) {
        return reply(res, 400, { error: 'Payment date is required' });
      }

      // Fetch payment
      const { data: payment, error: fetchErr } = await admin
        .from('payments')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!payment) {
        return reply(res, 404, { error: 'Payment record not found' });
      }

      // Update payment
      const { data: updated, error: updateErr } = await admin
        .from('payments')
        .update({
          amount: numAmount,
          payment_date,
          method: method || 'Bank Transfer',
          reference: (reference || '').trim(),
          remarks: (remarks || '').trim()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Recalculate parent invoice
      const { data: remainingPays, error: remErr } = await admin
        .from('payments')
        .select('amount, is_reversed')
        .eq('invoice_id', payment.invoice_id)
        .eq('is_reversed', false);

      if (remErr) throw remErr;

      const activePaid = (remainingPays || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const { data: parentInv } = await admin
        .from('invoices')
        .select('id, total, status')
        .eq('id', payment.invoice_id)
        .maybeSingle();

      if (parentInv && parentInv.status !== 'cancelled') {
        const newStatus = activePaid >= Number(parentInv.total) ? 'paid' : (activePaid > 0 ? 'partial' : 'unpaid');
        await admin.from('invoices').update({
          status: newStatus,
          updated_at: new Date().toISOString()
        }).eq('id', payment.invoice_id);
      }

      // Audit log
      await safeAuditLog(admin, {
        user_id: user.id,
        action: 'PAYMENT_UPDATED',
        entity_type: 'payments',
        entity_id: id,
        details: {
          invoice_id: payment.invoice_id,
          previous_amount: payment.amount,
          new_amount: numAmount,
          method: method || 'Bank Transfer',
          reference: reference || '',
          updated_by: profile.email
        }
      });

      return reply(res, 200, {
        ok: true,
        payment: updated,
        message: 'Payment record successfully updated.'
      });
    }

    return reply(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('Payments API error:', err);
    const status = err.status || 500;
    return reply(res, status, { error: err.message || 'Internal server error' });
  }
}
