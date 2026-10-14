import { parse, loadModule } from 'pgsql-parser';
import fs from 'node:fs';
import path from 'node:path';

async function validateSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const relName = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  try {
    const ast = await parse(sql);
    const count = ast?.stmts?.length ?? 0;
    console.log(`✅ [VALID] ${relName} (${count} top-level AST statements)`);
    return true;
  } catch (err) {
    console.error(`❌ [INVALID] ${relName}:`, err.message);
    if (err.sqlDetails) {
      console.error(`   Details:`, err.sqlDetails);
      const pos = err.sqlDetails.cursorPosition;
      if (pos) {
        console.error(`   Snippet around byte ${pos}:\n---`);
        console.error(sql.substring(Math.max(0, pos - 150), Math.min(sql.length, pos + 150)));
        console.error(`---`);
      }
    }
    return false;
  }
}

async function run() {
  await loadModule();
  console.log('====================================================================');
  console.log('POSTGRESQL SYNTAX VALIDATOR — FULL AST COMPLIANCE CHECK');
  console.log('====================================================================\n');

  let allValid = true;

  // 1. Validate complete single-file schema.sql
  const schemaFile = path.resolve('supabase/schema.sql');
  const schemaOk = await validateSqlFile(schemaFile);
  if (!schemaOk) allValid = false;

  // 2. Validate all chronological forward migrations
  const migrationsDir = path.resolve('supabase/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`\nValidating ${migrationFiles.length} chronological forward migrations in supabase/migrations/...`);
  for (const f of migrationFiles) {
    const fullPath = path.join(migrationsDir, f);
    const ok = await validateSqlFile(fullPath);
    if (!ok) allValid = false;
  }

  // 3. Validate isolated rollback procedures
  const rollbackDir = path.resolve('supabase/rollback');
  if (fs.existsSync(rollbackDir)) {
    const rollbackFiles = fs.readdirSync(rollbackDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    console.log(`\nValidating ${rollbackFiles.length} rollback procedures in supabase/rollback/...`);
    for (const f of rollbackFiles) {
      const fullPath = path.join(rollbackDir, f);
      const ok = await validateSqlFile(fullPath);
      if (!ok) allValid = false;
    }
  }

  console.log('\n====================================================================');
  if (allValid) {
    console.log('🎉 ALL SQL SCHEMAS, MIGRATIONS & ROLLBACKS PASSED POSTGRESQL PARSER VALIDATION!');
  } else {
    console.error('🛑 SYNTAX ERRORS DETECTED. VALIDATION FAILED.');
  }
  console.log('====================================================================\n');

  return allValid;
}

run().then(ok => {
  if (!ok) process.exit(1);
});
