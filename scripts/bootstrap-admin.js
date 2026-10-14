#!/usr/bin/env node
/**
 * ============================================================================
 * OPERATOR-CONTROLLED PRIMARY ADMINISTRATOR BOOTSTRAP CLI
 * MS Management Consulting Billing System
 * ============================================================================
 *
 * Security Requirements:
 * - Strictly operator-only CLI execution
 * - Never accepts passwords via process.argv (prevents process-list credential leakage)
 * - Verifies target Supabase project URL and service-role key validity BEFORE requesting credentials
 * - Strict FAIL-CLOSED pre-flight: aborts immediately on invalid credentials, DB connection failure, or permission errors
 * - Never interprets an API or database error as an empty database
 * - Requires explicit operator 'CONFIRM' input before execution
 * - Does not silently bypass email verification (requires explicit operator policy selection)
 * - Safe compensation: deletes provisioned Auth user if database RPC fails
 * - ZERO fallback to direct profile upsert if authorized RPC fails
 * - Never prints or leaks API keys or credentials
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// 1. Check for unsafe command-line argument credential leakage
const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
  const hasHelp = cliArgs.includes('--help') || cliArgs.includes('-h');
  if (hasHelp) {
    console.log(`
Usage:
  npm run bootstrap:admin

Security Notice:
  Do not pass credentials as command-line arguments.
  Credentials entered via CLI arguments are logged in shell history (.bash_history)
  and visible to unprivileged local processes via process monitoring tools.
  All credentials are requested securely at runtime via hidden prompts.
`);
    process.exit(0);
  }

  console.error('\n❌ SECURITY VIOLATION: Command-line arguments detected.');
  console.error('   Passing credentials via command-line arguments is strictly prohibited.');
  console.error('   Run without arguments: npm run bootstrap:admin\n');
  process.exit(1);
}

export function mask(str, visibleChars = 4) {
  if (!str) return '—';
  if (str.length <= visibleChars) return '***';
  return str.slice(0, visibleChars) + '...' + str.slice(-visibleChars);
}

/**
 * Strict, fail-closed pre-flight validation.
 * Verifies Supabase credentials, database connectivity, table accessibility, and zero-admin state.
 * Throws immediately with a descriptive code and message on ANY error.
 */
export async function runPreflightChecks(adminClient, supabaseUrl) {
  if (!adminClient) {
    const err = new Error('[INVALID_CONFIGURATION] Admin Supabase client is required.');
    err.code = 'INVALID_CONFIGURATION';
    throw err;
  }

  // A. Verify Supabase Auth service_role privileges
  const { data: authData, error: authError } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 10 });
  if (authError) {
    const msg = authError.message || String(authError);
    if (/invalid api key|invalid jwt|unauthorized|jwt expired|apikey/i.test(msg)) {
      const err = new Error(`[INVALID_API_KEY] Provided SUPABASE_SERVICE_ROLE_KEY is invalid for project ${supabaseUrl}. Ensure you copied the service_role key, not the anon key.`);
      err.code = 'INVALID_API_KEY';
      throw err;
    }
    if (/fetch failed|econnrefused|enotfound|etimedout/i.test(msg)) {
      const err = new Error(`[CONNECTION_FAILED] Unable to connect to Supabase Auth endpoint at ${supabaseUrl}. (Details: ${msg})`);
      err.code = 'CONNECTION_FAILED';
      throw err;
    }
    const err = new Error(`[AUTH_VERIFICATION_FAILED] ${msg}`);
    err.code = 'AUTH_VERIFICATION_FAILED';
    throw err;
  }

  // B. Verify no confirmed admin already exists in auth.users
  if (authData?.users?.length > 0) {
    const confirmedAdmin = authData.users.find(u =>
      (u.user_metadata?.role === 'admin' || u.app_metadata?.role === 'admin') &&
      (u.email_confirmed_at || u.confirmed_at)
    );
    if (confirmedAdmin) {
      const err = new Error(`[ADMIN_ALREADY_EXISTS] A confirmed administrator already exists in Supabase Auth (${mask(confirmedAdmin.email, 3)}). Bootstrap is permanently locked.`);
      err.code = 'ADMIN_ALREADY_EXISTS';
      throw err;
    }
  }

  // C. Verify Database connectivity & profiles table (FAIL-CLOSED)
  const { data: existingAdmin, error: checkError } = await adminClient
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('role', 'admin')
    .maybeSingle();

  if (checkError) {
    const msg = checkError.message || String(checkError);
    if (/invalid api key|invalid jwt|unauthorized|jwt expired|apikey/i.test(msg)) {
      const err = new Error(`[INVALID_API_KEY] Provided API key is invalid for database queries on project ${supabaseUrl}.`);
      err.code = 'INVALID_API_KEY';
      throw err;
    }
    if (/permission denied/i.test(msg)) {
      const err = new Error(`[PERMISSION_DENIED] Access denied when querying profiles table. The provided key lacks administrative service_role privileges.`);
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    if (/relation .*profiles.* does not exist/i.test(msg)) {
      const err = new Error(`[SCHEMA_MISSING] PostgreSQL profiles table does not exist in project ${supabaseUrl}. Please apply the database schema migration first.`);
      err.code = 'SCHEMA_MISSING';
      throw err;
    }
    if (/fetch failed|econnrefused|enotfound|etimedout/i.test(msg)) {
      const err = new Error(`[CONNECTION_FAILED] Unable to connect to database endpoint at ${supabaseUrl}. (Details: ${msg})`);
      err.code = 'CONNECTION_FAILED';
      throw err;
    }
    const err = new Error(`[DATABASE_QUERY_ERROR] Database query failed on profiles table: ${msg}`);
    err.code = 'DATABASE_QUERY_ERROR';
    throw err;
  }

  if (existingAdmin && existingAdmin.role === 'admin') {
    const err = new Error(`[ADMIN_ALREADY_EXISTS] An administrator already exists in database profiles (${mask(existingAdmin.email, 3)}). Bootstrap is permanently locked.`);
    err.code = 'ADMIN_ALREADY_EXISTS';
    throw err;
  }

  // D. Verify company_settings table access
  const { error: settingsError } = await adminClient
    .from('company_settings')
    .select('id')
    .limit(1);

  if (settingsError) {
    const msg = settingsError.message || String(settingsError);
    if (/permission denied/i.test(msg)) {
      const err = new Error(`[PERMISSION_DENIED] Access denied when querying company_settings table. Service-role privileges required.`);
      err.code = 'PERMISSION_DENIED';
      throw err;
    }
    if (/relation .*company_settings.* does not exist/i.test(msg)) {
      const err = new Error(`[SCHEMA_MISSING] PostgreSQL company_settings table does not exist. Please apply the database schema migration first.`);
      err.code = 'SCHEMA_MISSING';
      throw err;
    }
    const err = new Error(`[DATABASE_QUERY_ERROR] Failed to query company_settings table: ${msg}`);
    err.code = 'DATABASE_QUERY_ERROR';
    throw err;
  }

  return { success: true, message: 'Pre-flight verification passed: Service key is valid and system is uninitialized.' };
}

// Interactive helper stream
class MutableStdout extends Writable {
  constructor() {
    super();
    this.muted = false;
  }
  _write(chunk, encoding, callback) {
    if (!this.muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  }
}

// Main interactive CLI execution
export async function main() {
  // Load environment variables
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

  let supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const mutableStdout = new MutableStdout();
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: Boolean(process.stdin.isTTY)
  });

  const terminate = (code = 0) => {
    process.exitCode = code;
    try { rl.close(); } catch (_) {}
  };

  const ask = query => new Promise(res => {
    mutableStdout.muted = false;
    rl.question(query, ans => res(ans.trim()));
  });

  const askSecret = query => new Promise(res => {
    mutableStdout.muted = false;
    process.stdout.write(query);
    mutableStdout.muted = true;
    rl.question('', ans => {
      mutableStdout.muted = false;
      process.stdout.write('\n');
      res(ans.trim());
    });
  });

  console.log('====================================================================');
  console.log('MS MANAGEMENT CONSULTING — PRIMARY ADMINISTRATOR BOOTSTRAP CLI');
  console.log('====================================================================');

  if (!supabaseUrl) {
    console.log('\nSupabase URL is not configured in .env or environment.');
    console.log('Retrieve from: Supabase Dashboard -> Project Settings -> API -> Project URL');
    supabaseUrl = await ask('Enter Supabase Project URL (e.g., https://your-id.supabase.co): ');
    if (!supabaseUrl || !supabaseUrl.startsWith('https://')) {
      console.error('❌ Error: A valid HTTPS Supabase Project URL is required.');
      terminate(1);
      return;
    }
  }

  console.log(`Target Supabase URL: ${supabaseUrl}`);

  // 1. Obtain SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    console.log('\nSUPABASE_SERVICE_ROLE_KEY is not configured in .env or environment.');
    console.log('Retrieve from: Supabase Dashboard -> Project Settings -> API -> service_role secret');
    serviceKey = await askSecret('Enter SUPABASE_SERVICE_ROLE_KEY [input hidden]: ');
    if (!serviceKey || serviceKey.length < 20) {
      console.error('❌ Error: A valid service_role secret key is required.');
      terminate(1);
      return;
    }
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 2. STRICT FAIL-CLOSED PRE-FLIGHT VALIDATION
  // Runs BEFORE asking for Administrator credentials
  console.log('\nChecking Supabase credentials and database status (strict pre-flight)...');
  try {
    await runPreflightChecks(adminClient, supabaseUrl);
    console.log('✅ Pre-flight verification passed: Service key is valid and system is uninitialized.\n');
  } catch (preflightErr) {
    console.error('\n❌ PRE-FLIGHT VALIDATION FAILED:');
    console.error(`   ${preflightErr.message}`);
    console.error('\n⚠️ Bootstrap aborted immediately. Non-zero exit code returned.\n');
    terminate(1);
    return;
  }

  // 3. Prompt for Administrator details
  const emailInput = await ask('Enter Administrator Email (e.g., admin@yourcompany.com): ');
  const email = (emailInput || '').trim().toLowerCase();

  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    console.error('❌ Error: A valid email address is required.');
    terminate(1);
    return;
  }

  const nameInput = await ask('Enter Administrator Full Name (e.g., Primary Administrator): ');
  const fullName = (nameInput || 'Primary Administrator').trim();

  // 4. Secure runtime password prompt (masked)
  let password = '';
  let confirmPass = '';
  while (true) {
    password = await askSecret('Enter Administrator Password (min 8 characters) [input hidden]: ');
    if (!password || password.length < 8) {
      console.log('❌ Password must be at least 8 characters long. Please try again.');
      continue;
    }
    confirmPass = await askSecret('Confirm Administrator Password [input hidden]: ');
    if (password !== confirmPass) {
      console.log('❌ Passwords do not match. Please try again.');
      continue;
    }
    break;
  }

  // 5. Explicit Email Verification Policy (Never silently bypassed)
  console.log('\nSelect Email Verification Policy:');
  console.log('  [1] Auto-confirm email immediately (Operator-approved initial access)');
  console.log('  [2] Require email verification link (Dispatches confirmation email via Supabase SMTP)');
  const policyChoice = await ask('Enter policy [1 or 2, default: 1]: ');
  const shouldAutoConfirm = policyChoice !== '2';

  // 6. Explicit Operator Confirmation
  console.log('\n====================================================================');
  console.log('OPERATOR PROVISIONING SUMMARY:');
  console.log('====================================================================');
  console.log(`Target Project:     ${supabaseUrl}`);
  console.log(`Administrator Name: ${fullName}`);
  console.log(`Administrator Email:${email}`);
  console.log(`Email Policy:       ${shouldAutoConfirm ? 'Auto-Confirmed (Explicit Operator Approval)' : 'Requires SMTP Email Link Confirmation'}`);
  console.log('====================================================================');
  const confirmation = await ask("Type 'CONFIRM' to execute provisioning (any other input will abort): ");

  if (confirmation !== 'CONFIRM') {
    console.log('\n⚠️ Bootstrap aborted by operator. No changes were made.\n');
    terminate(0);
    return;
  }

  // 7. Provision user in Supabase Auth
  console.log('\n1. Provisioning user in Supabase Auth...');
  let userId = null;
  try {
    const { data: createdAuth, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: shouldAutoConfirm,
      user_metadata: {
        full_name: fullName,
        role: 'admin'
      }
    });

    if (createError) throw createError;

    userId = createdAuth?.user?.id;
    if (!userId) throw new Error('Supabase Auth did not return a user identifier.');
    console.log(`   Auth user provisioned successfully with ID: ${userId}`);
  } catch (authErr) {
    console.error('❌ Supabase Auth user creation failed:', authErr.message);
    terminate(1);
    return;
  }

  // 8. Atomic Database RPC Execution (ZERO fallback upserts!)
  console.log('2. Provisioning Administrator profile & entity defaults via atomic RPC...');
  try {
    const { error: rpcError } = await adminClient.rpc('bootstrap_admin_account', {
      p_user_id: userId,
      p_email: email,
      p_full_name: fullName
    });

    if (rpcError) {
      console.error('\n❌ DATABASE RPC FAILURE: bootstrap_admin_account rejected execution.');
      console.error(`   Error details: ${rpcError.message}`);
      console.log('   Executing safe rollback: Deleting provisioned Supabase Auth user...');
      await adminClient.auth.admin.deleteUser(userId).catch(delErr => {
        console.error('   Warning during auth deletion rollback:', delErr.message);
      });
      console.error('   Rollback complete. No unauthorized administrator profile was created.');
      console.error('   Reason: Database constraints or missing RPC. Apply the incremental migration first.');
      terminate(1);
      return;
    }

    console.log('   Database profile and initial settings created atomically.');
  } catch (rpcFatal) {
    console.error('\n❌ Fatal RPC execution error:', rpcFatal.message);
    console.log('   Executing safe rollback: Deleting provisioned Supabase Auth user...');
    await adminClient.auth.admin.deleteUser(userId).catch(() => {});
    terminate(1);
    return;
  }

  // 9. Completion Summary
  console.log('\n====================================================================');
  console.log('✅ PRIMARY ADMINISTRATOR SUCCESSFULLY INITIALIZED!');
  console.log('====================================================================');
  console.log(`Administrator:  ${fullName}`);
  console.log(`Email:          ${email}`);
  console.log(`Role:           ADMIN`);
  console.log('Status:         ACTIVE');
  console.log('Portal URL:     http://localhost:3005/');
  console.log('--------------------------------------------------------------------');
  console.log('Next Steps:');
  console.log('1. Sign in to the portal at http://localhost:3005/');
  console.log('2. Navigate to "User Management" to issue single-use staff invitations.');
  console.log('3. Bootstrap is now PERMANENTLY LOCKED against reuse.');
  console.log('====================================================================\n');

  terminate(0);
}

// Execute when invoked directly from CLI
const currentFile = fileURLToPath(import.meta.url);
const executedFile = process.argv[1] ? resolve(process.argv[1]) : '';
const isDirectRun = executedFile && (
  currentFile.toLowerCase() === executedFile.toLowerCase() ||
  executedFile.toLowerCase().endsWith('bootstrap-admin.js')
);

if (isDirectRun && process.env.NODE_ENV !== 'test') {
  main().catch(err => {
    console.error('\n❌ Fatal error in bootstrap script:', err?.message || err);
    process.exitCode = 1;
  });
}
