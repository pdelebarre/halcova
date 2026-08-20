#!/usr/bin/env node
// scripts/security/dependency-audit-allowlist.js
//
// Allowlist gate for the security-CI blocking `dependency-audit` job
// (.github/workflows/security-ci.yml). Reads `npm audit --json` from stdin and
// exits non-zero if any high/critical advisory source is NOT allowlisted.
//
// EXCEPTIONS POLICY: only high/critical findings with a filed ticket AND
// Security Auditor sign-off may be waived (see .github/ai/README.md, #213).
// An implementer never self-approves an exception.
//
// APPROVED SET (issue #386 — Security Auditor sign-off):
//   All dev-only, no production path, no fix available. Reached exclusively via
//   the `netlify-cli` devDependency (local `netlify dev` tooling). Recheck on
//   every upstream netlify-cli release and close #386 when a fix lands.
//   - extract-zip          GHSA-jmr9-qjv8-65gv  (unvalidated symlink path traversal)
//   - sharp / libvips      GHSA-f88m-g3jw-g9cj  (CVE-2026-33327, CVE-2026-33328,
//                                                CVE-2026-35590, CVE-2026-35591; <0.35.0)
//
// FAIL-CLOSED: this list is the ONLY exemption. Any high/critical advisory
// source anywhere in the tree that is not in the allowlist — a new advisory,
// a new CVE on the same package, or a non-exempt package — makes the job fail.
// We deliberately do NOT use blanket `continue-on-error` or a global
// `--audit-level` downgrade.

import fs from 'node:fs';

// Approved advisory sources. Keyed by the GHSA id embedded in each advisory's
// `url` (e.g. https://github.com/advisories/GHSA-jmr9-qjv8-65gv). This is the
// exact approved #386 set and nothing else.
const ALLOWLIST = new Set([
  'GHSA-jmr9-qjv8-65gv', // extract-zip
  'GHSA-f88m-g3jw-g9cj', // sharp / libvips <0.35.0
]);

// Extract a stable advisory identifier from an npm audit `via` object entry.
function advisoryId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const url = entry.url || '';
  const m = url.match(/GHSA-[0-9A-Za-z-]+/);
  if (m) return m[0];
  if (typeof entry.source === 'string') return entry.source;
  if (typeof entry.name === 'string') return entry.name;
  return null;
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    // Non-JSON audit output (registry/network/parse error) is an unknown state:
    // fail closed rather than silently pass.
    console.error(
      'dependency-audit FAIL: could not parse `npm audit --json` output — failing closed.'
    );
    process.exit(1);
  }

  const vulns = (data && data.vulnerabilities) || {};
  const unallowlisted = [];

  for (const [pkg, info] of Object.entries(vulns)) {
    if (!info || (info.severity !== 'high' && info.severity !== 'critical')) {
      continue;
    }
    const via = Array.isArray(info.via) ? info.via : [];
    for (const entry of via) {
      // Only object entries carry a concrete advisory (a string entry is just a
      // pointer to another package whose own `via` holds the advisory object).
      if (!entry || typeof entry !== 'object') continue;
      if (entry.severity !== 'high' && entry.severity !== 'critical') continue;
      const id = advisoryId(entry);
      if (!id || !ALLOWLIST.has(id)) {
        unallowlisted.push({
          package: pkg,
          severity: entry.severity,
          advisory: id || entry.title || entry.url || '(unknown)',
          title: entry.title || '',
        });
      }
    }
  }

  if (unallowlisted.length > 0) {
    console.error(
      'dependency-audit FAIL: un-allowlisted high/critical advisory(ies) found:'
    );
    for (const u of unallowlisted) {
      console.error(
        `  - ${u.advisory} (${u.severity}) on ${u.package}: ${u.title}`
      );
    }
    console.error(
      'Only the approved #386 dev-only no-fix set is exempt (see ' +
        'scripts/security/dependency-audit-allowlist.js and .github/ai/README.md).'
    );
    process.exit(1);
  }

  console.log('dependency-audit OK: no un-allowlisted high/critical advisories.');
}

main();
