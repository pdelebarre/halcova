// scripts/security/dependency-audit-allowlist.test.mjs
//
// Proves the dependency-audit allowlist gate is FAIL-CLOSED:
//   - a clean report (no high/critical)                       -> exit 0
//   - the approved #386 dev-only no-fix set only              -> exit 0 (exempt)
//   - a NEW high/critical advisory outside the allowlist      -> exit 1 (fail)
//
// Run: node scripts/security/dependency-audit-allowlist.test.mjs
// It spawns the real allowlist gate and asserts its exit code.

import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.join(here, 'dependency-audit-allowlist.js');

// Minimal but structurally faithful npm audit --json fragments.
const leafVuln = (pkg, severity, url) => ({
  severity,
  isDirect: false,
  via: [
    {
      source: 0,
      name: pkg,
      dependency: pkg,
      title: pkg,
      url,
      severity,
      range: '>=0',
    },
  ],
});

// (a) Clean: no vulnerabilities.
const clean = { vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };

// (b) Only the approved #386 set, plus the parent string-reference chain the
//     real report emits (extract-zip + sharp leaves carry the advisory objects;
//     the netlify-cli chain only carries string pointers).
const approved = {
  vulnerabilities: {
    'netlify-cli': { severity: 'high', isDirect: true, via: ['@netlify/dev'] },
    '@netlify/dev': { severity: 'high', isDirect: false, via: ['@netlify/functions-dev', '@netlify/images'] },
    '@netlify/functions-dev': { severity: 'high', isDirect: false, via: ['extract-zip'] },
    'extract-zip': leafVuln('extract-zip', 'high', 'https://github.com/advisories/GHSA-jmr9-qjv8-65gv'),
    '@netlify/images': { severity: 'high', isDirect: false, via: ['ipx'] },
    ipx: { severity: 'high', isDirect: false, via: ['sharp'] },
    sharp: leafVuln('sharp', 'high', 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj'),
  },
};

// (c) Un-allowlisted: a NEW high advisory (different GHSA) on a non-exempt package.
const newHigh = {
  vulnerabilities: {
    'some-new-pkg': leafVuln('some-new-pkg', 'high', 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'),
  },
};

// (d) A new CVE on an already-exempt package family is NOT exempted (its GHSA
//     differs from the approved source id) — still fail-closed.
const newCveOnApprovedPkg = {
  vulnerabilities: {
    sharp: leafVuln('sharp', 'high', 'https://github.com/advisories/GHSA-zzzz-0000-9999'),
  },
};

function runGate(inputJson) {
  try {
    execFileSync('node', [gate], { input: JSON.stringify(inputJson), encoding: 'utf8' });
    return 0;
  } catch (err) {
    return err.status;
  }
}

assert.strictEqual(runGate(clean), 0, 'clean report should pass');
assert.strictEqual(runGate(approved), 0, 'approved #386 set should be exempt');
assert.strictEqual(runGate(newHigh), 1, 'new un-allowlisted high should fail');
assert.strictEqual(runGate(newCveOnApprovedPkg), 1, 'new CVE on exempt package should fail');

console.log(
  'dependency-audit-allowlist gate: FAIL-CLOSED confirmed ' +
    '(clean=pass, approved#386=pass, new-high=fail, new-CVE=fail).'
);
