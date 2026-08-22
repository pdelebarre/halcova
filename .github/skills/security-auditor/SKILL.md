# Security Auditor Skill

## SAST/DAST Scanning Workflows

### Automated Scanning
```bash
# NPM audit for dependencies
npm audit --audit-level=high

# Snyk for comprehensive scanning
npx snyk test
npx snyk code test

# OWASP ZAP for DAST (in CI)
zap-baseline.py -t https://staging.halcova.app
```

### GitHub Actions Integration
```yaml
- name: Security Scan
  uses: snyk/actions/node@master
  env:
    SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

## Threat Modeling

### STRIDE Framework
| Threat | Question | Mitigation |
|--------|----------|------------|
| **Spoofing** | Can an attacker impersonate a user? | Multi-factor auth, JWT validation |
| **Tampering** | Can data be modified in transit? | HTTPS, input validation, signatures |
| **Repudiation** | Can users deny actions? | Audit logging, immutable records |
| **Information Disclosure** | Can sensitive data be leaked? | Encryption, RLS, access controls |
| **DoS** | Can service be overwhelmed? | Rate limiting, timeouts, scaling |
| **Elevation of Privilege** | Can users access more than allowed? | RLS, authorization checks |

### Data Flow Diagram
1. User → Frontend → BFF → Services → Database
2. Identify trust boundaries
3. Mark sensitive data flows
4. Document security controls at each boundary

## Security Checklist for Features

### Pre-Implementation
- [ ] Threat modeling completed
- [ ] Security requirements defined
- [ ] Data classification identified
- [ ] Compliance requirements checked (GDPR, etc.)

### Implementation
- [ ] Input validation on all user input
- [ ] Output encoding for all user-generated content
- [ ] Authentication/authorization implemented
- [ ] RLS policies for multi-tenant data
- [ ] Secrets managed via environment variables
- [ ] Error messages don't leak sensitive info

### Pre-Release
- [ ] SAST scan passed (no high/critical issues)
- [ ] DAST scan passed (if applicable)
- [ ] Dependency audit passed
- [ ] Penetration testing completed (for major features)
- [ ] Security review by @security-auditor agent

## Incident Response Runbook

### Detection
1. Monitor logs for anomalies
2. Set up alerts for:
   - Failed login attempts > 10/minute
   - Unusual data access patterns
   - Error rate spikes
   - RLS policy violations

### Containment
1. Identify affected systems/users
2. Revoke compromised tokens/sessions
3. Enable additional logging
4. Consider temporary feature disable

### Investigation
1. Collect logs and evidence
2. Determine attack vector
3. Assess data exposure
4. Document timeline

### Remediation
1. Patch vulnerability
2. Rotate affected credentials
3. Notify affected users (if required)
4. Update security controls

### Post-Incident
1. Conduct retrospective
2. Update threat models
3. Add detection for similar attacks
4. Improve security controls

## Compliance Validation

### GDPR Checklist
- [ ] Data minimization (collect only what's needed)
- [ ] Purpose limitation (use data only as stated)
- [ ] Consent management (opt-in, withdrawable)
- [ ] Data subject rights (access, deletion, portability)
- [ ] Data retention policies
- [ ] Breach notification procedures

### SOC2 Controls
- [ ] Access controls (least privilege)
- [ ] Change management (code review, CI/CD)
- [ ] Risk assessment (threat modeling)
- [ ] Vendor management (third-party audits)
- [ ] Incident response (runbook tested)

## Tools and Resources
- **SAST**: Snyk Code, GitHub CodeQL, Semgrep
- **DAST**: OWASP ZAP, Burp Suite
- **Dependency Scan**: npm audit, Snyk, Dependabot
- **Secrets Scan**: GitHub secret scanning, GitLeaks
- **Pen Testing**: Annual third-party assessment

## References
- `.github/agents/security-auditor.agent.md` — Security review agent
- `.github/agents/multi-tenant-security.agent.md` — Tenant isolation specialist
- `.github/skills/multi-tenant-data/SKILL.md` — RLS implementation
- `.github/workflows/security-ci.yml` — CI security checks
