// ============================================================================
// COMPANY SETTINGS PERMISSION & RLS VERIFICATION TEST
// MS Management Consulting Billing System
// ============================================================================

import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 1. Load configuration from .env
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key] && val) process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.log('ℹ️ Skipping live permission test: SUPABASE_URL, SERVICE_ROLE_KEY and ANON_KEY required in environment.');
  process.exit(0);
}

const adminClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const pubClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

console.log('====================================================================');
console.log('RUNNING LIVE COMPANY SETTINGS RBAC & PERMISSION TESTS');
console.log('Target Supabase URL:', supabaseUrl);
console.log('====================================================================\n');

async function run() {
  const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

  // TEST 1: Demonstrates why UPSERT causes HTTP 401 / code 42501 (requires INSERT privilege)
  console.log('1. Testing UPSERT operation against real database...');
  const upsertAttempt = await pubClient
    .from('company_settings')
    .upsert({ id: SETTINGS_ID, business_name: 'MS Management Consulting' });

  assert.strictEqual(upsertAttempt.error?.code, '42501', 'Upsert fails with 42501 because INSERT privilege is revoked');
  assert.match(upsertAttempt.error?.message, /permission denied for table company_settings/);
  console.log('  ✅ Confirmed: UPSERT triggers PostgreSQL 42501 permission denied (requires INSERT privilege)\n');

  // TEST 2: Anonymous user attempts UPDATE (must be rejected by RLS)
  console.log('2. Testing Anonymous UPDATE rejection against real database...');
  const anonUpdate = await pubClient
    .from('company_settings')
    .update({ business_name: 'Malicious Anon Name' })
    .eq('id', SETTINGS_ID)
    .select();

  assert.strictEqual(anonUpdate.error, null, 'No syntax error, RLS cleanly filters row');
  assert.deepStrictEqual(anonUpdate.data, [], 'Anonymous update affects 0 rows due to RLS is_admin() policy');
  console.log('  ✅ Confirmed: Anonymous update is strictly blocked by RLS (0 rows affected)\n');

  // TEST 3: Staff member attempts UPDATE (must be rejected by RLS)
  console.log('3. Testing Staff member UPDATE rejection against real database...');
  const testStaffEmail = `test_staff_${Date.now()}@msconsulting.in`;
  const testStaffPass = 'SecureStaffPassword123!';

  // Provision temporary staff user
  const { data: createdStaff, error: createStaffErr } = await adminClient.auth.admin.createUser({
    email: testStaffEmail,
    password: testStaffPass,
    email_confirm: true,
    user_metadata: { role: 'staff', full_name: 'Test Staff Member' }
  });
  assert.strictEqual(createStaffErr, null, 'Staff auth created');

  await adminClient.from('profiles').insert({
    id: createdStaff.user.id,
    email: testStaffEmail,
    full_name: 'Test Staff Member',
    role: 'staff',
    is_active: true
  });

  // Sign in as staff
  const staffClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const staffSignIn = await staffClient.auth.signInWithPassword({
    email: testStaffEmail,
    password: testStaffPass
  });
  assert.strictEqual(staffSignIn.error, null, 'Staff successfully signed in');

  const staffUpdate = await staffClient
    .from('company_settings')
    .update({ business_name: 'Unauthorized Staff Modification' })
    .eq('id', SETTINGS_ID)
    .select();

  assert.strictEqual(staffUpdate.error, null);
  assert.deepStrictEqual(staffUpdate.data, [], 'Staff update affects 0 rows due to RLS is_admin() restriction');
  console.log('  ✅ Confirmed: Staff member update is strictly blocked by RLS (0 rows affected)\n');

  // Clean up temporary staff user
  await adminClient.auth.admin.deleteUser(createdStaff.user.id);
  await adminClient.from('profiles').delete().eq('id', createdStaff.user.id);

  // TEST 4: Signed-in Administrator UPDATE (must succeed and persist)
  console.log('4. Testing Signed-in Admin UPDATE against real database...');
  const adminEmail = adminUsers?.[0]?.email;
  if (!adminEmail) {
    console.log('  ℹ️ Notice: No active administrator found to test OTP login. Skipping test 4.');
    return;
  }

  const linkRes = await adminClient.auth.admin.generateLink({ type: 'magiclink', email: adminEmail });
  const otp = linkRes.data?.properties?.email_otp;
  assert.ok(otp, 'Generated OTP for admin session');

  const adminWebClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const adminAuthRes = await adminWebClient.auth.verifyOtp({
    email: adminEmail,
    token: otp,
    type: 'magiclink'
  });
  assert.ok(adminAuthRes.data?.session?.access_token, 'Admin session acquired');

  // Perform legal settings update
  const timestamp = new Date().toISOString();
  const updatePayload = {
    business_name: 'MS Management Consulting',
    issuer_name: 'MADHU M. S.',
    invoice_prefix: 'MS',
    updated_at: timestamp
  };

  const adminUpdate = await adminWebClient
    .from('company_settings')
    .update(updatePayload)
    .eq('id', SETTINGS_ID)
    .select();

  assert.strictEqual(adminUpdate.error, null, 'Admin update executed without error');
  assert.strictEqual(adminUpdate.data?.length, 1, 'Admin update modified exactly 1 row');
  assert.strictEqual(adminUpdate.data?.[0]?.business_name, 'MS Management Consulting');
  assert.strictEqual(adminUpdate.data?.[0]?.invoice_prefix, 'MS');
  console.log('  ✅ Confirmed: Authenticated Admin UPDATE succeeds completely with access token!\n');

  console.log('====================================================================');
  console.log('ALL 4 LIVE DATABASE COMPANY SETTINGS PERMISSION TESTS PASSED!');
  console.log('====================================================================');
}

run().catch(err => {
  console.error('\n❌ Live test failure:', err);
  process.exit(1);
});
