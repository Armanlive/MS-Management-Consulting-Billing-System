import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve('.');

test('LANGUAGE AUDIT: Zero Roman Hindi or Hinglish tokens across user-facing files', () => {
  const targetFiles = [
    'src.js',
    'index.html',
    'style.css',
    'api/_utils.js',
    'api/invite.js',
    'api/users.js',
    'api/audit.js',
    'api/register.js',
    'api/bootstrap-admin.js',
    'api/invoices.js',
    'api/payments.js'
  ];

  const prohibitedTokens = [
    'kholein', 'badlein', 'kripya', 'safalta', 'mutabiq', 'alag', 'samundari', 'shahi', 'suryaast', 'andheri',
    'saaf', 'safed', 'aankhon', 'sukoon', 'prakritik', 'jankari', 'suraksha', 'kaam', 'likhein', 'dobara',
    'naya', 'rang', 'rangin', 'neela', 'hara', 'baingani', 'narangi', 'bhai', 'karo', 'karein', 'kare', 'nahi',
    'hua', 'hai', 'wala', 'wali', 'gaya', 'gayi', 'pehle', 'aap', 'aapki', 'aapka', 'aapke', 'paas', 'thik',
    'dekho', 'dekh', 'raha', 'rahe', 'aaye', 'sajhe', 'chahiye', 'dusre', 'banaya', 'kuch', 'bolo', 'kaise',
    'din', 'raat', 'turant', 'pura', 'badal', 'chun', 'sakte', 'hain', 'aur', 'karta', 'karti', 'hoga', 'hogi',
    'namaste', 'dhanyawad', 'shukriya', 'alvida', 'shuru', 'khatam', 'band', 'chalu', 'sahi', 'galat',
    'zaruri', 'zaroori', 'jaruri', 'pata', 'batana', 'bhejo', 'bhejna', 'wapas', 'phir', 'fir', 'abhi'
  ];

  const regex = new RegExp('\\b(' + prohibitedTokens.join('|') + ')\\b', 'i');

  const violations = [];

  targetFiles.forEach(fileRel => {
    const filePath = path.join(projectRoot, fileRel);
    if (!fs.existsSync(filePath)) return;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    lines.forEach((line, lineNum) => {
      // Exclude standard words if any false positives emerge
      if (regex.test(line)) {
        const match = line.match(regex);
        violations.push({
          file: fileRel,
          line: lineNum + 1,
          matchedWord: match[0],
          content: line.trim()
        });
      }
    });
  });

  assert.strictEqual(
    violations.length,
    0,
    `Found ${violations.length} prohibited Roman Hindi / Hinglish tokens:\n` +
    violations.map(v => `  ${v.file}:${v.line} [${v.matchedWord}]: ${v.content}`).join('\n')
  );
});

test('LANGUAGE AUDIT: Toast notifications use polished English terminology', () => {
  const src = fs.readFileSync(path.join(projectRoot, 'src.js'), 'utf8');
  const toastRegex = /toast\s*\(\s*([^,\)]+)(?:,\s*([^,\)]+))?\s*\)/g;
  let match;
  const toasts = [];

  while ((match = toastRegex.exec(src)) !== null) {
    toasts.push(match[1].trim());
  }

  assert.ok(toasts.length > 20, 'Expected extensive toast notification coverage in application');
  
  // Verify no non-English patterns in toast strings
  toasts.forEach(t => {
    assert.doesNotMatch(t, /ho gaya|nahi hua|kripya|badal|safalta/i, `Toast contains non-English wording: ${t}`);
  });
});

test('LANGUAGE AUDIT: Official PDF invoice labels strictly match corporate GST standards', () => {
  const src = fs.readFileSync(path.join(projectRoot, 'src.js'), 'utf8');

  // Verify critical GST and business labels in PDF & preview modal
  const requiredLabels = [
    'TAX INVOICE',
    'Invoice No',
    'Invoice Date',
    'PARTICULARS',
    'HSN/SAC',
    'AMOUNT ( Rs. )',
    'CGST',
    'SGST',
    'IGST',
    'TOTAL',
    'AUTHORISED SIGNATORY'
  ];

  requiredLabels.forEach(label => {
    assert.ok(
      src.includes(label),
      `Expected official PDF invoice label "${label}" to be present in src.js`
    );
  });
});

test('NON-REGRESSION: Company Settings uses UPDATE operation preserving permissions fix', () => {
  const src = fs.readFileSync(path.join(projectRoot, 'src.js'), 'utf8');

  // Ensure settings update uses .from('company_settings').update(
  assert.ok(
    /\.from\('company_settings'\)\s*\.update\(/m.test(src),
    'Company settings must use .update() rather than .upsert() to avoid PostgreSQL 42501 permission error'
  );
});
