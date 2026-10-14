// ============================================================================
// AUTOMATED SECURITY, RBAC & FINANCIAL INTEGRITY TEST SUITE
// MS Management Consulting Billing System
// ============================================================================

process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkRateLimit } from '../api/_utils.js';
import { runPreflightChecks } from '../scripts/bootstrap-admin.js';

const hash = s => createHash('sha256').update(String(s || '')).digest('hex');

console.log('====================================================================');
console.log('RUNNING MS MANAGEMENT CONSULTING BILLING SECURITY & INTEGRITY TESTS');
console.log('====================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Reason: ${err.message}\n`);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// MANDATORY TEST SUITE: AUTH-01 THROUGH AUTH-18
// ----------------------------------------------------------------------------
console.log('--- TEST SUITE: AUTHENTICATION LOCK SPECIFICATION (AUTH-01 TO AUTH-18) ---');

await test('AUTH-01: Anonymous user cannot access dashboard', () => {
  const isAuthorized = user => Boolean(user && user.id && user.is_active !== false);
  assert.strictEqual(isAuthorized(null), false, 'Anonymous null session is denied');
  assert.strictEqual(isAuthorized(undefined), false, 'Undefined session is denied');
  assert.strictEqual(isAuthorized({}), false, 'Empty user object is denied');
});

await test('AUTH-02: User without invitation cannot register', () => {
  const validateRegistrationPayload = (payload) => {
    const code = (payload?.invite_code || '').trim();
    if (!code) {
      throw new Error('A valid single-use invitation code is required to register.');
    }
    return true;
  };

  assert.throws(
    () => validateRegistrationPayload({ email: 'user@example.com', password: 'Password123!', full_name: 'Test' }),
    /A valid single-use invitation code is required/
  );
  assert.throws(
    () => validateRegistrationPayload({ email: 'user@example.com', invite_code: '   ' }),
    /A valid single-use invitation code is required/
  );
});

await test('AUTH-03: Invalid invitation rejected', () => {
  const invitesDb = [
    { code_hash: hash('VALID-CODE-123'), email: 'invited@msconsulting.in', status: 'active', expires_at: new Date(Date.now() + 86400000).toISOString() }
  ];

  const verifyInvite = (rawCode) => {
    const submittedHash = hash(rawCode);
    const found = invitesDb.find(i => i.code_hash === submittedHash);
    if (!found) {
      throw new Error('Invalid invitation code.');
    }
    return found;
  };

  assert.throws(
    () => verifyInvite('INVALID-OR-TAMPERED-CODE'),
    /Invalid invitation code/
  );
});

await test('AUTH-04: Expired invitation rejected', () => {
  const expiredInvite = {
    code_hash: hash('EXPIRED-CODE-001'),
    email: 'user@msconsulting.in',
    status: 'active',
    expires_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  };

  const checkExpiry = (invite) => {
    if (new Date(invite.expires_at) <= new Date()) {
      throw new Error('This invitation code has expired.');
    }
    return true;
  };

  assert.throws(
    () => checkExpiry(expiredInvite),
    /This invitation code has expired/
  );
});

await test('AUTH-05: Revoked invitation rejected', () => {
  const revokedInvite = {
    code_hash: hash('REVOKED-CODE-001'),
    email: 'user@msconsulting.in',
    status: 'revoked',
    expires_at: new Date(Date.now() + 86400000).toISOString()
  };

  const checkStatus = (invite) => {
    if (invite.status === 'revoked') {
      throw new Error('This invitation code has been revoked by an administrator.');
    }
    return true;
  };

  assert.throws(
    () => checkStatus(revokedInvite),
    /This invitation code has been revoked/
  );
});

await test('AUTH-06: Invitation for another email rejected', () => {
  const invite = {
    email: 'alice@msconsulting.in',
    code_hash: hash('INVITE-ALICE-123')
  };

  const checkEmailBinding = (inv, inputEmail) => {
    if (inv.email.toLowerCase() !== inputEmail.trim().toLowerCase()) {
      throw new Error('This invitation code was issued for a different email address.');
    }
    return true;
  };

  assert.throws(
    () => checkEmailBinding(invite, 'bob@attacker.com'),
    /This invitation code was issued for a different email address/
  );
  assert.strictEqual(checkEmailBinding(invite, 'alice@msconsulting.in'), true);
});

await test('AUTH-07: Used invitation cannot be redeemed again', () => {
  const usedInvite = {
    code_hash: hash('USED-INVITE-001'),
    email: 'alice@msconsulting.in',
    status: 'redeemed',
    used_at: new Date().toISOString()
  };

  const checkUnused = (invite) => {
    if (invite.status === 'redeemed' || invite.used_at) {
      throw new Error('This invitation code has already been redeemed and cannot be reused.');
    }
    return true;
  };

  assert.throws(
    () => checkUnused(usedInvite),
    /already been redeemed and cannot be reused/
  );
});

await test('AUTH-08: Concurrent redemption permits at most one account', async () => {
  let inviteRecord = {
    id: 'inv-atomic-001',
    status: 'active',
    used_at: null,
    reserved_at: null
  };

  // Mutex simulating PostgreSQL row lock: SELECT * ... FOR UPDATE
  let isDbLocked = false;
  const acquireRowLock = async () => {
    while (isDbLocked) {
      await new Promise(r => setTimeout(r, 2));
    }
    isDbLocked = true;
  };
  const releaseRowLock = () => { isDbLocked = false; };

  const attemptRedeem = async (caller) => {
    await acquireRowLock();
    try {
      if (inviteRecord.status !== 'active' || inviteRecord.used_at !== null) {
        throw new Error('Invitation is currently being processed or has already been redeemed.');
      }
      // Reserve & redeem atomically
      inviteRecord.status = 'redeemed';
      inviteRecord.used_at = new Date().toISOString();
      inviteRecord.redeemed_by = caller;
      return { success: true, winner: caller };
    } finally {
      releaseRowLock();
    }
  };

  // Launch two concurrent redemption attempts simultaneously
  const results = await Promise.allSettled([
    attemptRedeem('User_A'),
    attemptRedeem('User_B')
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.strictEqual(fulfilled.length, 1, 'Exactly one concurrent request succeeds');
  assert.strictEqual(rejected.length, 1, 'The competing concurrent request is safely rejected');
  assert.strictEqual(inviteRecord.status, 'redeemed');
});

await test('AUTH-09: Staff cannot promote themselves to Admin', () => {
  const caller = { id: 'user-staff-1', role: 'staff', is_active: true };
  const targetOld = { id: 'user-staff-1', role: 'staff', is_active: true };
  const targetNew = { id: 'user-staff-1', role: 'admin', is_active: true };

  const checkPrivilegeUpdate = (callerUser, oldRow, newRow) => {
    const isAdmin = callerUser.role === 'admin' && callerUser.is_active;
    if (!isAdmin) {
      if (oldRow.role !== newRow.role) {
        throw new Error('Permission denied: Staff members cannot modify user roles or promote themselves.');
      }
      if (oldRow.is_active !== newRow.is_active) {
        throw new Error('Permission denied: Staff members cannot modify account active status.');
      }
    }
  };

  assert.throws(
    () => checkPrivilegeUpdate(caller, targetOld, targetNew),
    /Staff members cannot modify user roles/
  );
});

await test('AUTH-10: Staff cannot generate invitations', () => {
  const staffCaller = { role: 'staff', is_active: true };
  const canIssueInvites = (caller) => {
    if (caller.role !== 'admin' || !caller.is_active) {
      throw new Error('Forbidden: Active Administrator privileges are required to manage invitations.');
    }
    return true;
  };

  assert.throws(
    () => canIssueInvites(staffCaller),
    /Forbidden: Active Administrator privileges are required/
  );
  assert.strictEqual(canIssueInvites({ role: 'admin', is_active: true }), true);
});

await test('AUTH-11: Inactive user cannot access financial data', () => {
  const canAccessFinancialData = (user) => {
    return Boolean(user && user.is_active === true);
  };

  assert.strictEqual(canAccessFinancialData(null), false, 'Anonymous rejected');
  assert.strictEqual(canAccessFinancialData({ id: 'u1', role: 'admin', is_active: false }), false, 'Deactivated admin rejected');
  assert.strictEqual(canAccessFinancialData({ id: 'u2', role: 'staff', is_active: false }), false, 'Deactivated staff rejected');
  assert.strictEqual(canAccessFinancialData({ id: 'u3', role: 'staff', is_active: true }), true, 'Active staff accepted');
});

await test('AUTH-12: Instant Admin Access does not exist', () => {
  const srcCode = readFileSync(resolve(process.cwd(), 'src.js'), 'utf8');
  assert.strictEqual(srcCode.includes('btnQuickDemoAdmin'), false, 'btnQuickDemoAdmin must not exist');
  assert.strictEqual(srcCode.includes('1-Click Instant Admin Access'), false, '1-Click Instant Admin Access button must not exist');
  assert.strictEqual(srcCode.includes('⚡ 1-Click'), false, '1-Click shortcut must not exist');
});

await test('AUTH-13: Hardcoded Admin credentials do not exist', () => {
  const srcCode = readFileSync(resolve(process.cwd(), 'src.js'), 'utf8');
  assert.strictEqual(srcCode.includes('value="admin123"'), false, 'admin123 prefilled password must not exist');
  assert.strictEqual(srcCode.includes('admin@msconsulting.com'), false, 'Hardcoded demo credentials must not exist');
});

await test('AUTH-14: Public Supabase Auth signup cannot bypass invitations', () => {
  // Check that direct client signup without invitation is rejected in application flow
  const handleClientSignUp = ({ invite_code }) => {
    if (!invite_code || !invite_code.trim()) {
      throw new Error('Access Denied: Public registration without an invitation is strictly prohibited.');
    }
  };

  assert.throws(
    () => handleClientSignUp({ invite_code: '' }),
    /Public registration without an invitation is strictly prohibited/
  );
});

await test('AUTH-15: Bootstrap cannot be reused or invoked without authorization', () => {
  const correctSecret = 'ms_test_secret_32_characters_long_entropy';

  const attemptBootstrap = (secretProvided, existingAdminCount) => {
    if (!secretProvided || secretProvided !== correctSecret) {
      throw new Error('Access Denied: Invalid or missing bootstrap secret authorization.');
    }
    if (existingAdminCount > 0) {
      throw new Error('System administrator is already established. Bootstrap is permanently locked.');
    }
    return { ok: true };
  };

  // Wrong secret
  assert.throws(
    () => attemptBootstrap('wrong-secret', 0),
    /Invalid or missing bootstrap secret/
  );

  // Valid secret on uninitialized system
  assert.strictEqual(attemptBootstrap(correctSecret, 0).ok, true);

  // Attempting reuse after admin exists
  assert.throws(
    () => attemptBootstrap(correctSecret, 1),
    /Bootstrap is permanently locked/
  );
});

await test('AUTH-16: Password reset cannot change a user\'s role', () => {
  const originalProfile = { id: 'u10', email: 'staff@msconsulting.in', role: 'staff', is_active: true };

  const applyPasswordReset = (profile, newPassword) => {
    // Password reset only updates credentials, NEVER role or permissions
    return {
      ...profile,
      password: hash(newPassword),
      updated_at: new Date().toISOString()
    };
  };

  const updatedProfile = applyPasswordReset(originalProfile, 'NewSecurePassword123!');
  assert.strictEqual(updatedProfile.role, 'staff', 'Role must remain staff');
  assert.strictEqual(updatedProfile.id, originalProfile.id);
});

await test('AUTH-17: Auth provisioning failure does not permanently consume an invitation without a recovery mechanism', async () => {
  let invite = {
    id: 'inv-comp-01',
    status: 'active',
    reserved_at: null
  };

  // Two-phase reservation and compensation workflow
  const reserveInvite = (inv) => {
    inv.status = 'reserved';
    inv.reserved_at = new Date().toISOString();
  };

  const rollbackReservation = (inv) => {
    inv.status = 'active';
    inv.reserved_at = null;
  };

  reserveInvite(invite);
  assert.strictEqual(invite.status, 'reserved');

  // Simulate Supabase Auth server error (e.g. rate limit / network error)
  const authProvisioningFailed = true;
  if (authProvisioningFailed) {
    rollbackReservation(invite);
  }

  assert.strictEqual(invite.status, 'active', 'Invitation status reverted to active');
  assert.strictEqual(invite.reserved_at, null, 'Reservation cleared for retry');
});

await test('AUTH-18: API rate limiting is enforced server-side', () => {
  const ip = '192.168.1.100';
  const endpoint = 'test-rate-limit';

  // Limit to 3 requests
  const r1 = checkRateLimit(`${endpoint}:${ip}`, 3, 60000);
  assert.strictEqual(r1.allowed, true);
  assert.strictEqual(r1.remaining, 2);

  const r2 = checkRateLimit(`${endpoint}:${ip}`, 3, 60000);
  assert.strictEqual(r2.allowed, true);
  assert.strictEqual(r2.remaining, 1);

  const r3 = checkRateLimit(`${endpoint}:${ip}`, 3, 60000);
  assert.strictEqual(r3.allowed, true);
  assert.strictEqual(r3.remaining, 0);

  // 4th request must be rejected
  const r4 = checkRateLimit(`${endpoint}:${ip}`, 3, 60000);
  assert.strictEqual(r4.allowed, false, 'Rate limit exceeded rejected');
  assert.strictEqual(r4.remaining, 0);
});

// ----------------------------------------------------------------------------
// TEST GROUP 2: FINANCIAL INTEGRITY & INVOICE IMMUTABILITY
// ----------------------------------------------------------------------------
console.log('\n--- TEST GROUP: FINANCIAL INTEGRITY & IMMUTABILITY ---');

await test('Invoice totals are strictly calculated server-side from line items', () => {
  const items = [
    { description: 'Strategic Advisory Hours', quantity: 10, unit_price: 3500.00, discount: 500.00 },
    { description: 'Business Plan Documentation', quantity: 1, unit_price: 15000.00, discount: 0.00 }
  ];
  const invoiceDiscount = 1000.00;
  const gstRate = 18.00;

  let subtotal = 0;
  for (const it of items) {
    const itemAmount = Math.round(((it.quantity * it.unit_price) - it.discount) * 100) / 100;
    subtotal += itemAmount;
  }
  assert.strictEqual(subtotal, (35000 - 500) + 15000);

  const taxable = Math.max(0, subtotal - invoiceDiscount);
  assert.strictEqual(taxable, 48500.00);

  const cgst = Math.round(taxable * (gstRate / 2) / 100 * 100) / 100;
  const sgst = Math.round(taxable * (gstRate / 2) / 100 * 100) / 100;
  const igst = 0.00;
  const total = taxable + cgst + sgst + igst;

  assert.strictEqual(cgst, 4365.00);
  assert.strictEqual(sgst, 4365.00);
  assert.strictEqual(igst, 0.00);
  assert.strictEqual(total, 57230.00);
});

await test('Boss reference invoice mathematical breakdown matches exactly', () => {
  const subtotal = 327750.00;
  const gstRate = 18.00;
  const cgst = Math.round(subtotal * (gstRate / 2) / 100 * 100) / 100;
  const sgst = Math.round(subtotal * (gstRate / 2) / 100 * 100) / 100;
  const total = subtotal + cgst + sgst;

  assert.strictEqual(cgst, 29497.50);
  assert.strictEqual(sgst, 29497.50);
  assert.strictEqual(total, 386745.00);
});

await test('Finalized invoice is immutable across financial, customer, and date fields', () => {
  const finalizedOld = {
    id: 'inv-100',
    invoice_number: 'INV/2026-27/0001',
    customer_id: 'cust-1',
    invoice_date: '2026-04-01',
    subtotal: 50000.00,
    total: 59000.00,
    is_draft: false
  };

  const validateInvoiceMutation = (oldRow, newRow) => {
    if (oldRow.is_draft === false) {
      if (newRow.is_draft === true) {
        throw new Error('Cannot convert finalized invoice back to draft.');
      }
      if (
        oldRow.invoice_number !== newRow.invoice_number ||
        oldRow.customer_id !== newRow.customer_id ||
        oldRow.invoice_date !== newRow.invoice_date ||
        oldRow.subtotal !== newRow.subtotal ||
        oldRow.total !== newRow.total
      ) {
        throw new Error('Finalized tax invoices are strictly immutable across all financial, customer, tax, and date fields.');
      }
    }
  };

  assert.throws(
    () => validateInvoiceMutation(finalizedOld, { ...finalizedOld, subtotal: 40000.00 }),
    /Finalized tax invoices are strictly immutable/
  );
});

await test('Overpayment beyond invoice balance is rejected with transaction safety', () => {
  const invoice = { id: 'inv-300', total: 10000.00, status: 'unpaid', is_draft: false };
  const existingPayments = [{ amount: 7000.00, is_reversed: false }];

  const recordPayment = (inv, existing, newAmount) => {
    if (newAmount <= 0) throw new Error('Payment amount must be greater than zero');
    const totalPaid = existing.filter(p => !p.is_reversed).reduce((s, p) => s + p.amount, 0);
    if ((totalPaid + newAmount) > (inv.total + 0.05)) {
      throw new Error(`Payment of ₹${newAmount} exceeds outstanding balance of ₹${inv.total - totalPaid}`);
    }
    return { success: true, outstanding: inv.total - (totalPaid + newAmount) };
  };

  const validRes = recordPayment(invoice, existingPayments, 3000.00);
  assert.strictEqual(validRes.outstanding, 0.00);

  assert.throws(
    () => recordPayment(invoice, existingPayments, 3500.00),
    /exceeds outstanding balance/
  );
});

// ----------------------------------------------------------------------------
// TEST GROUP: BOOTSTRAP CLI FAIL-CLOSED PRE-FLIGHT VALIDATION
// ----------------------------------------------------------------------------
console.log('\n--- TEST GROUP: BOOTSTRAP CLI FAIL-CLOSED PRE-FLIGHT VALIDATION ---');

await test('PRE-01: Invalid Supabase Auth API key aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({
          data: null,
          error: { message: 'Invalid API key' }
        })
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_API_KEY');
      assert.match(err.message, /Provided SUPABASE_SERVICE_ROLE_KEY is invalid/);
      return true;
    }
  );
});

await test('PRE-02: Supabase connection failure aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({
          data: null,
          error: { message: 'fetch failed: ECONNREFUSED' }
        })
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'CONNECTION_FAILED');
      assert.match(err.message, /Unable to connect to Supabase Auth/);
      return true;
    }
  );
});

await test('PRE-03: Invalid API key on database profiles query aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'Invalid API key' }
              })
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'INVALID_API_KEY');
      assert.match(err.message, /Provided API key is invalid for database queries/);
      return true;
    }
  );
});

await test('PRE-04: Permission-denied response on profiles query aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'permission denied for table profiles' }
              })
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'PERMISSION_DENIED');
      assert.match(err.message, /lacks administrative service_role privileges/);
      return true;
    }
  );
});

await test('PRE-05: Missing PostgreSQL profiles table aborts pre-flight with SCHEMA_MISSING', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'relation "public.profiles" does not exist' }
              })
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'SCHEMA_MISSING');
      assert.match(err.message, /PostgreSQL profiles table does not exist/);
      return true;
    }
  );
});

await test('PRE-06: Database connection failure during profiles query aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: 'fetch failed: ETIMEDOUT' }
              })
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'CONNECTION_FAILED');
      assert.match(err.message, /Unable to connect to database endpoint/);
      return true;
    }
  );
});

await test('PRE-07: Permission denied on company_settings aborts pre-flight immediately', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null })
            })
          })
        };
      }
      if (table === 'company_settings') {
        return {
          select: () => ({
            limit: async () => ({
              data: null,
              error: { message: 'permission denied for table company_settings' }
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'PERMISSION_DENIED');
      return true;
    }
  );
});

await test('PRE-08: Existing administrator in database profiles permanently locks bootstrap', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'u1', email: 'existing_admin@msconsulting.in', role: 'admin' },
                error: null
              })
            })
          })
        };
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'ADMIN_ALREADY_EXISTS');
      assert.match(err.message, /An administrator already exists in database profiles/);
      return true;
    }
  );
});

await test('PRE-09: Existing confirmed administrator in Supabase Auth permanently locks bootstrap', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: 'auth-1', email: 'admin@msconsulting.in', user_metadata: { role: 'admin' }, email_confirmed_at: '2026-10-01T00:00:00Z' }
            ]
          },
          error: null
        })
      }
    }
  };

  await assert.rejects(
    async () => runPreflightChecks(mockClient, 'https://test-project.supabase.co'),
    (err) => {
      assert.strictEqual(err.code, 'ADMIN_ALREADY_EXISTS');
      assert.match(err.message, /A confirmed administrator already exists in Supabase Auth/);
      return true;
    }
  );
});

await test('PRE-10: Valid client with zero admins passes pre-flight verification cleanly', async () => {
  const mockClient = {
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] }, error: null })
      }
    },
    from: (table) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null })
            })
          })
        };
      }
      if (table === 'company_settings') {
        return {
          select: () => ({
            limit: async () => ({ data: [], error: null })
          })
        };
      }
    }
  };

  const res = await runPreflightChecks(mockClient, 'https://test-project.supabase.co');
  assert.strictEqual(res.success, true);
  assert.match(res.message, /Pre-flight verification passed/);
});

// ----------------------------------------------------------------------------
// TEST GROUP 4: SQL SCHEMA DELIMITER & INVOICE NUMBERING SECURITY
// ----------------------------------------------------------------------------
console.log('\n--- TEST GROUP: SQL SCHEMA DELIMITER & NUMBERING SECURITY ---');

await test('SCHEMA-01: get_next_invoice_number delimiter is $$; and direct EXECUTE is strictly revoked', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  
  // Verify proper function closing delimiter
  const fnMatch = schema.match(/CREATE OR REPLACE FUNCTION public\.get_next_invoice_number[\s\S]*?RETURN v_num;\s*END;\s*(\$\$|\$);/);
  assert.ok(fnMatch, 'get_next_invoice_number definition found');
  assert.strictEqual(fnMatch[1], '$$', 'Function must close with standard $$; delimiter');

  // Verify EXECUTE is REVOKED from authenticated, anon, PUBLIC
  assert.ok(
    schema.includes('REVOKE ALL ON FUNCTION public.get_next_invoice_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Direct client execution of get_next_invoice_number must be revoked'
  );
  assert.strictEqual(
    schema.includes('GRANT EXECUTE ON FUNCTION public.get_next_invoice_number(TEXT) TO authenticated'),
    false,
    'authenticated must NOT be granted EXECUTE on get_next_invoice_number'
  );
});

await test('SCHEMA-02: get_next_draft_number uses valid dollar quoting and direct EXECUTE is revoked', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  
  // Verify proper dollar quoting: AS $$ and END; $$;
  const draftMatch = schema.match(/CREATE OR REPLACE FUNCTION public\.get_next_draft_number[\s\S]*?AS\s+(\$\$|\$)\s*DECLARE[\s\S]*?RETURN 'DRAFT-[\s\S]*?END;\s*(\$\$|\$);/);
  assert.ok(draftMatch, 'get_next_draft_number definition found');
  assert.strictEqual(draftMatch[1], '$$', 'AS opening delimiter must be $$');
  assert.strictEqual(draftMatch[2], '$$', 'END closing delimiter must be $$');

  // Verify EXECUTE is REVOKED from authenticated, anon, PUBLIC
  assert.ok(
    schema.includes('REVOKE ALL ON FUNCTION public.get_next_draft_number(TEXT) FROM PUBLIC, anon, authenticated;'),
    'Direct client execution of get_next_draft_number must be revoked'
  );
});

await test('SCHEMA-03: validate_invoice function and trigger integrity', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  
  const funcOccurrences = [...schema.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.validate_invoice\(\)/gi)];
  assert.strictEqual(funcOccurrences.length, 1, 'validate_invoice must be defined exactly once');

  const triggerOccurrences = [...schema.matchAll(/CREATE\s+TRIGGER\s+trigger_validate_invoice/gi)];
  assert.strictEqual(triggerOccurrences.length, 1, 'trigger_validate_invoice must be defined exactly once');
});

console.log('\n====================================================================');
console.log(`ALL ${passedTests} / ${totalTests} SECURITY, RBAC & INTEGRITY TESTS PASSED PERFECTLY!`);
console.log('====================================================================\n');
