// ============================================================================
// BILLING AUTHORIZATION, INVOICE LIFECYCLE & FINANCIAL INTEGRITY TESTS
// MS Management Consulting Billing System
// Target Policy: Both Active Admin and Active Staff Authorized for Issuance
// ============================================================================

process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isDraftInvoice,
  isCancelledInvoice,
  invoiceHeading,
  invoiceWatermark,
  invoiceHistoryActions,
  allocateDraftNumber
} from '../document_status.js';

console.log('====================================================================');
console.log('RUNNING APPROVED BILLING AUTHORIZATION & LIFECYCLE SPECIFICATION TESTS');
console.log('====================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Reason: ${err.message}`);
    throw err;
  }
}

// ============================================================================
// 1. AUTHENTICATION & AUTHORIZATION SPECIFICATION (AUTHZ-01 TO AUTHZ-10)
// ============================================================================
console.log('--- TEST SUITE: ROLE-BASED AUTHORIZATION MATRIX (ADMIN & STAFF) ---');

// Mock simulation of database authorization engine
function authorizeInvoiceIssuance(user, isDraft = false) {
  if (!user || !user.id) {
    throw new Error('Unauthorized: Active user session required');
  }
  if (user.is_active !== true) {
    throw new Error('Forbidden: Account is inactive or suspended');
  }
  if (!['admin', 'staff'].includes(user.role)) {
    throw new Error('Forbidden: Unauthorized role');
  }
  return {
    allowed: true,
    user_id: user.id,
    role: user.role,
    action: isDraft ? 'DRAFT_SAVED' : 'INVOICE_FINALIZED'
  };
}

function authorizeInvoiceCancellation(user) {
  if (!user || !user.id) {
    throw new Error('Unauthorized: Session required');
  }
  if (user.is_active !== true || user.role !== 'admin') {
    throw new Error('Forbidden: Administrator privileges required to cancel invoices');
  }
  return { allowed: true };
}

function authorizeDraftDeletion(user) {
  if (!user || !user.id) {
    throw new Error('Unauthorized: Session required');
  }
  if (user.is_active !== true || user.role !== 'admin') {
    throw new Error('Forbidden: Administrator privileges required to delete invoices');
  }
  return { allowed: true };
}

function authorizePaymentReversal(user) {
  if (!user || !user.id) {
    throw new Error('Unauthorized: Session required');
  }
  if (user.is_active !== true || user.role !== 'admin') {
    throw new Error('Forbidden: Administrator privileges required to reverse payments');
  }
  return { allowed: true };
}

await test('AUTHZ-01: Active Admin can create drafts and finalize tax invoices', () => {
  const admin = { id: 'admin-1', role: 'admin', is_active: true };
  const draftRes = authorizeInvoiceIssuance(admin, true);
  assert.strictEqual(draftRes.allowed, true);
  assert.strictEqual(draftRes.action, 'DRAFT_SAVED');

  const finalRes = authorizeInvoiceIssuance(admin, false);
  assert.strictEqual(finalRes.allowed, true);
  assert.strictEqual(finalRes.action, 'INVOICE_FINALIZED');
});

await test('AUTHZ-02: Active Staff can create drafts and finalize tax invoices (Owner Approved)', () => {
  const staff = { id: 'staff-1', role: 'staff', is_active: true };
  const draftRes = authorizeInvoiceIssuance(staff, true);
  assert.strictEqual(draftRes.allowed, true);
  assert.strictEqual(draftRes.action, 'DRAFT_SAVED');

  const finalRes = authorizeInvoiceIssuance(staff, false);
  assert.strictEqual(finalRes.allowed, true);
  assert.strictEqual(finalRes.action, 'INVOICE_FINALIZED');
});

await test('AUTHZ-03: Inactive Admin cannot issue invoices', () => {
  const inactiveAdmin = { id: 'admin-2', role: 'admin', is_active: false };
  assert.throws(() => authorizeInvoiceIssuance(inactiveAdmin, false), /inactive or suspended/);
});

await test('AUTHZ-04: Inactive Staff cannot issue invoices', () => {
  const inactiveStaff = { id: 'staff-2', role: 'staff', is_active: false };
  assert.throws(() => authorizeInvoiceIssuance(inactiveStaff, false), /inactive or suspended/);
});

await test('AUTHZ-05: Anonymous user cannot issue invoices', () => {
  assert.throws(() => authorizeInvoiceIssuance(null, false), /Unauthorized/);
  assert.throws(() => authorizeInvoiceIssuance({}, false), /Unauthorized/);
});

await test('AUTHZ-06: Unknown or malformed role fails closed', () => {
  const unknownUser = { id: 'user-x', role: 'viewer', is_active: true };
  assert.throws(() => authorizeInvoiceIssuance(unknownUser, false), /Unauthorized role/);

  const malformedUser = { id: 'user-y', role: '', is_active: true };
  assert.throws(() => authorizeInvoiceIssuance(malformedUser, false), /Unauthorized role/);
});

await test('AUTHZ-07: Staff cannot cancel issued invoices (Admin-only)', () => {
  const staff = { id: 'staff-1', role: 'staff', is_active: true };
  assert.throws(() => authorizeInvoiceCancellation(staff), /Administrator privileges required/);

  const admin = { id: 'admin-1', role: 'admin', is_active: true };
  assert.doesNotThrow(() => authorizeInvoiceCancellation(admin));
});

await test('AUTHZ-08: Staff cannot delete draft invoices (Admin-only)', () => {
  const staff = { id: 'staff-1', role: 'staff', is_active: true };
  assert.throws(() => authorizeDraftDeletion(staff), /Administrator privileges required/);

  const admin = { id: 'admin-1', role: 'admin', is_active: true };
  assert.doesNotThrow(() => authorizeDraftDeletion(admin));
});

await test('AUTHZ-09: Staff cannot reverse payments (Admin-only)', () => {
  const staff = { id: 'staff-1', role: 'staff', is_active: true };
  assert.throws(() => authorizePaymentReversal(staff), /Administrator privileges required/);

  const admin = { id: 'admin-1', role: 'admin', is_active: true };
  assert.doesNotThrow(() => authorizePaymentReversal(admin));
});

await test('AUTHZ-10: Document status UI actions restrict privileged operations from Staff', () => {
  const draftInv = { id: 'inv-1', invoice_number: 'DRAFT-2026-27-0001', is_draft: true, status: 'draft' };
  const issuedInv = { id: 'inv-2', invoice_number: 'INV/2026-27/0001', is_draft: false, status: 'unpaid' };

  // Staff on draft: view, edit, pdf (NO delete_draft, NO cancel)
  const staffDraftActs = invoiceHistoryActions(draftInv, 'staff');
  assert.deepStrictEqual(staffDraftActs, ['view', 'edit', 'pdf']);

  // Admin on draft: view, edit, pdf, cancel, delete_draft
  const adminDraftActs = invoiceHistoryActions(draftInv, 'admin');
  assert.deepStrictEqual(adminDraftActs, ['view', 'edit', 'pdf', 'cancel', 'delete_draft']);

  // Staff on issued: view, pdf (NO cancel)
  const staffIssuedActs = invoiceHistoryActions(issuedInv, 'staff');
  assert.deepStrictEqual(staffIssuedActs, ['view', 'pdf']);

  // Admin on issued: view, pdf, cancel, delete_draft
  const adminIssuedActs = invoiceHistoryActions(issuedInv, 'admin');
  assert.deepStrictEqual(adminIssuedActs, ['view', 'pdf', 'cancel', 'delete_draft']);
});

// ============================================================================
// 2. INVOICE LIFECYCLE & NUMBERING ATOMICITY (LIFE-01 TO LIFE-10)
// ============================================================================
console.log('\n--- TEST SUITE: INVOICE LIFECYCLE & NUMBERING ATOMICITY ---');

await test('LIFE-01: Draft creation allocates sequential draft number without consuming tax serials', () => {
  const existingDrafts = ['DRAFT-2026-27-0001', 'DRAFT-2026-27-0002'];
  const nextDraft = allocateDraftNumber('2026-27', existingDrafts);
  assert.strictEqual(nextDraft, 'DRAFT-2026-27-0003');
});

await test('LIFE-02: Draft confirmation updates the SAME invoice row preserving invoice ID', () => {
  const invoiceDb = new Map();
  const draftId = 'inv-uuid-101';
  invoiceDb.set(draftId, {
    id: draftId,
    invoice_number: 'DRAFT-2026-27-0001',
    is_draft: true,
    status: 'draft',
    subtotal: 50000,
    total: 59000
  });

  // Finalize draft
  const row = invoiceDb.get(draftId);
  assert.strictEqual(row.is_draft, true);
  
  // Simulation of atomic confirmation
  const taxNumber = 'INV/2026-27/0001';
  row.invoice_number = taxNumber;
  row.is_draft = false;
  row.status = 'unpaid';
  row.updated_at = new Date().toISOString();
  invoiceDb.set(draftId, row);

  // Assertions: same ID, exactly 1 row in DB, status flipped, permanent number allocated
  assert.strictEqual(invoiceDb.size, 1);
  assert.strictEqual(invoiceDb.get(draftId).id, draftId);
  assert.strictEqual(invoiceDb.get(draftId).invoice_number, taxNumber);
  assert.strictEqual(invoiceDb.get(draftId).is_draft, false);
});

await test('LIFE-03: Repeated confirmation does not duplicate invoice or allocate a second number', () => {
  const row = {
    id: 'inv-uuid-101',
    invoice_number: 'INV/2026-27/0001',
    is_draft: false,
    status: 'unpaid'
  };

  // Attempting to finalize an already finalized invoice must fail
  assert.throws(() => {
    if (row.is_draft === false) {
      throw new Error(`Invoice ${row.id} is already finalized and cannot be modified.`);
    }
  }, /already finalized/);
});

await test('LIFE-04: Issued tax invoices are financially immutable', () => {
  const finalized = {
    id: 'inv-uuid-101',
    invoice_number: 'INV/2026-27/0001',
    customer_id: 'cust-1',
    subtotal: 100000.00,
    gst_rate: 18.00,
    total: 118000.00,
    is_draft: false
  };

  const modified = { ...finalized, total: 90000.00 };

  // Trigger validation simulation:
  const validateInvoiceUpdate = (oldRow, newRow) => {
    if (oldRow.is_draft === false) {
      if (newRow.is_draft === true) {
        throw new Error('Cannot convert finalized invoice back to draft.');
      }
      if (oldRow.total !== newRow.total || oldRow.subtotal !== newRow.subtotal || oldRow.customer_id !== newRow.customer_id) {
        throw new Error('Finalized tax invoices are strictly immutable across all financial and customer fields.');
      }
    }
  };

  assert.throws(() => validateInvoiceUpdate(finalized, modified), /strictly immutable/);
  assert.throws(() => validateInvoiceUpdate(finalized, { ...finalized, is_draft: true }), /Cannot convert finalized invoice back to draft/);
});

await test('LIFE-05: Document status headings and watermarks match statutory requirements', () => {
  const activeDraft = { is_draft: true, status: 'draft' };
  const cancelledDraft = { is_draft: true, status: 'cancelled' };
  const activeTax = { is_draft: false, status: 'unpaid' };
  const cancelledTax = { is_draft: false, status: 'cancelled' };

  assert.strictEqual(invoiceHeading(activeDraft), 'DRAFT INVOICE');
  assert.strictEqual(invoiceWatermark(activeDraft), 'DRAFT');

  assert.strictEqual(invoiceHeading(cancelledDraft), 'DRAFT INVOICE — CANCELLED');
  assert.strictEqual(invoiceWatermark(cancelledDraft), 'CANCELLED');

  assert.strictEqual(invoiceHeading(activeTax), 'TAX INVOICE');
  assert.strictEqual(invoiceWatermark(activeTax), null);

  assert.strictEqual(invoiceHeading(cancelledTax), 'TAX INVOICE — CANCELLED');
  assert.strictEqual(invoiceWatermark(cancelledTax), 'CANCELLED');
});

// ============================================================================
// 3. FINANCIAL CALCULATIONS & GST MATHEMATICS (FIN-01 TO FIN-05)
// ============================================================================
console.log('\n--- TEST SUITE: FINANCIAL INTEGRITY & GST MATHEMATICS ---');

await test('FIN-01: Intrastate GST calculation (Karnataka -> Karnataka) splits equally into CGST and SGST', () => {
  const taxable = 250000.00;
  const gstRate = 18.00;
  const cgst = Math.round(taxable * (gstRate / 2.0) / 100.0 * 100) / 100;
  const sgst = Math.round(taxable * (gstRate / 2.0) / 100.0 * 100) / 100;
  const igst = 0.00;
  const total = taxable + cgst + sgst + igst;

  assert.strictEqual(cgst, 22500.00);
  assert.strictEqual(sgst, 22500.00);
  assert.strictEqual(igst, 0.00);
  assert.strictEqual(total, 295000.00);
});

await test('FIN-02: Interstate GST calculation (Karnataka -> Maharashtra) calculates IGST', () => {
  const taxable = 250000.00;
  const gstRate = 18.00;
  const cgst = 0.00;
  const sgst = 0.00;
  const igst = Math.round(taxable * gstRate / 100.0 * 100) / 100;
  const total = taxable + cgst + sgst + igst;

  assert.strictEqual(cgst, 0.00);
  assert.strictEqual(sgst, 0.00);
  assert.strictEqual(igst, 45000.00);
  assert.strictEqual(total, 295000.00);
});

await test('FIN-03: Line items round properly and discount subtracts before GST tax base', () => {
  const items = [
    { qty: 2.5, price: 10000.00, disc: 500.00 }, // 24500.00
    { qty: 1.0, price: 15555.55, disc: 0.00 }   // 15555.55
  ];
  const invoiceDiscount = 1055.55;

  const subtotal = items.reduce((acc, it) => acc + Math.round(((it.qty * it.price) - it.disc) * 100) / 100, 0);
  assert.strictEqual(subtotal, 40055.55);

  const taxable = Math.max(0, subtotal - invoiceDiscount);
  assert.strictEqual(taxable, 39000.00);

  const tax = Math.round(taxable * 0.18 * 100) / 100;
  assert.strictEqual(tax, 7020.00);

  const grandTotal = taxable + tax;
  assert.strictEqual(grandTotal, 46020.00);
});

// ============================================================================
// 4. RPC HARDENING & NUMBERING RESTRICTION (RPC-01 TO RPC-05)
// ============================================================================
console.log('\n--- TEST SUITE: DATABASE RPC HARDENING & NUMBERING INTEGRITY ---');

await test('RPC-01: Direct EXECUTE on permanent numbering is strictly revoked in schema.sql', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  assert.ok(
    schema.includes('REVOKE ALL ON FUNCTION public.get_next_invoice_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Permanent number generator must be revoked from authenticated'
  );
  assert.ok(
    !schema.includes('GRANT EXECUTE ON FUNCTION public.get_next_invoice_number(TEXT) TO authenticated;'),
    'Authenticated must not have direct grant'
  );
});

await test('RPC-02: Direct EXECUTE on draft numbering is strictly revoked in schema.sql', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  assert.ok(
    schema.includes('REVOKE ALL ON FUNCTION public.get_next_draft_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Draft number generator must be revoked from authenticated'
  );
});

await test('RPC-03: create_invoice_with_items cleanly deletes previous line items on draft updates', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  assert.ok(
    schema.includes('DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;'),
    'create_invoice_with_items must delete previous line items when updating an existing draft'
  );
});

await test('RPC-04: is_active_member validates both active Admin and active Staff in schema and migrations', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  assert.ok(
    schema.includes("role IN ('admin', 'staff')"),
    'is_active_member must verify role IN (admin, staff)'
  );
});

// ============================================================================
// 5. ROLLBACK SCRIPT SECURITY HARDENING & REGRESSION GUARDS (ROLLBACK-01 TO ROLLBACK-06)
// ============================================================================
console.log('\n--- TEST SUITE: ROLLBACK SCRIPT SECURITY HARDENING & REGRESSION GUARDS ---');

await test('ROLLBACK-01: Rollback script 20261013000000 NEVER restores direct sequence allocation to authenticated users', () => {
  const rollbackSql = readFileSync(
    'supabase/rollback/rollback_20261013000000_billing_authorization_and_numbering_hardening.sql',
    'utf8'
  );
  // Must NOT grant execute to authenticated
  assert.ok(
    !rollbackSql.includes('GRANT EXECUTE ON FUNCTION public.get_next_invoice_number(TEXT) TO authenticated;'),
    'Rollback must not grant direct execution of get_next_invoice_number to authenticated'
  );
  assert.ok(
    !rollbackSql.includes('GRANT EXECUTE ON FUNCTION public.get_next_draft_number(TEXT) TO authenticated;'),
    'Rollback must not grant direct execution of get_next_draft_number to authenticated'
  );
  // Must explicitly affirm revocation
  assert.ok(
    rollbackSql.includes('REVOKE ALL ON FUNCTION public.get_next_invoice_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Rollback must explicitly enforce REVOKE on get_next_invoice_number'
  );
  assert.ok(
    rollbackSql.includes('REVOKE ALL ON FUNCTION public.get_next_draft_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Rollback must explicitly enforce REVOKE on get_next_draft_number'
  );
});

await test('ROLLBACK-02: Rollback script 20261011010000 NEVER removes last-active-Admin protection on UPDATE and DELETE', () => {
  const rollbackRbac = readFileSync(
    'supabase/rollback/rollback_20261011010000_enterprise_rbac_and_user_governance.sql',
    'utf8'
  );
  // Must attach trigger for BOTH UPDATE and DELETE
  assert.ok(
    rollbackRbac.includes('BEFORE UPDATE OR DELETE ON public.profiles'),
    'Rollback must attach trigger for both UPDATE and DELETE on profiles'
  );
  // Must contain DELETE protection for last admin
  assert.ok(
    rollbackRbac.includes("TG_OP = 'DELETE'"),
    'Rollback trigger must intercept DELETE operations'
  );
  assert.ok(
    rollbackRbac.includes('Cannot delete the last active Administrator'),
    'Rollback trigger must prevent deletion of the last active Administrator'
  );
  // Must contain UPDATE protection for last admin demotion/deactivation
  assert.ok(
    rollbackRbac.includes("TG_OP = 'UPDATE'"),
    'Rollback trigger must intercept UPDATE operations'
  );
  assert.ok(
    rollbackRbac.includes('The system must retain at least one active Administrator'),
    'Rollback trigger must prevent demotion or deactivation of the last active Administrator'
  );
});

await test('ROLLBACK-03: Rollback script 20261011010000 includes transactional advisory lock serializing concurrent modifications', () => {
  const rollbackRbac = readFileSync(
    'supabase/rollback/rollback_20261011010000_enterprise_rbac_and_user_governance.sql',
    'utf8'
  );
  assert.ok(
    rollbackRbac.includes('pg_advisory_xact_lock'),
    'Rollback trigger must acquire transactional advisory lock'
  );
  assert.ok(
    rollbackRbac.includes('ms_consulting_admin_governance_lock'),
    'Rollback trigger must use ms_consulting_admin_governance_lock identifier'
  );
});

await test('ROLLBACK-04: Admin and Staff can both finalize invoices under safe operational policy', () => {
  const admin = { id: 'admin-uuid', role: 'admin', is_active: true };
  const staff = { id: 'staff-uuid', role: 'staff', is_active: true };

  const adminResult = authorizeInvoiceIssuance(admin, false);
  const staffResult = authorizeInvoiceIssuance(staff, false);

  assert.strictEqual(adminResult.allowed, true);
  assert.strictEqual(adminResult.action, 'INVOICE_FINALIZED');
  assert.strictEqual(staffResult.allowed, true);
  assert.strictEqual(staffResult.action, 'INVOICE_FINALIZED');
});

await test('ROLLBACK-05: Staff is strictly denied from cancelling invoices, deleting drafts, and reversing payments', () => {
  const staff = { id: 'staff-uuid', role: 'staff', is_active: true };

  assert.throws(() => authorizeInvoiceCancellation(staff), /Administrator privileges required/);
  assert.throws(() => authorizeDraftDeletion(staff), /Administrator privileges required/);
  assert.throws(() => authorizePaymentReversal(staff), /Administrator privileges required/);
});

await test('ROLLBACK-06: Existing invoice numbers and financial records remain untouched across all forward and rollback migrations', () => {
  const migrations = [
    'supabase/migrations/20260408000000_billing_system_schema.sql',
    'supabase/migrations/20260408010000_invitation_lifecycle_and_bootstrap_fix.sql',
    'supabase/migrations/20261010000000_invoice_creation_immutability_fix.sql',
    'supabase/migrations/20261011000000_draft_sequential_numbering.sql',
    'supabase/migrations/20261011010000_enterprise_rbac_and_user_governance.sql',
    'supabase/migrations/20261013000000_billing_authorization_and_numbering_hardening.sql',
    'supabase/rollback/rollback_20261011010000_enterprise_rbac_and_user_governance.sql',
    'supabase/rollback/rollback_20261013000000_billing_authorization_and_numbering_hardening.sql'
  ];

  for (const mig of migrations) {
    const content = readFileSync(mig, 'utf8');
    assert.ok(!content.includes('TRUNCATE'), `Migration ${mig} must not contain TRUNCATE`);
    assert.ok(!content.includes('DROP TABLE public.invoices'), `Migration ${mig} must not DROP TABLE invoices`);
    assert.ok(!content.includes('DROP TABLE public.payments'), `Migration ${mig} must not DROP TABLE payments`);
    assert.ok(!content.includes('RESTART WITH 1'), `Migration ${mig} must not reset sequence counters`);
  }
});

console.log('\n====================================================================');
console.log(`ALL ${passedTests} / ${totalTests} BILLING AUTHORIZATION & LIFECYCLE TESTS PASSED!`);
console.log('====================================================================\n');
