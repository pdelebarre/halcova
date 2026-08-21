# Halcova Architecture Decision Records

ADRs are the authoritative record of durable architecture decisions. See ADR-0015 for governance rules.

## Registry

| ADR | Decision | Status |
|---|---|---|
| 0001 | Demo space and free tier | Accepted |
| 0002 | Phased scaling architecture | Accepted |
| 0003 | Generic collection domain | Accepted |
| 0004 | Security and privacy by design | Accepted |
| 0005 | Collector-first UX | Accepted |
| 0006 | AI provider abstraction and secure tools | Accepted |
| 0007 | Collection-centric social | Accepted |
| 0008 | Monetization and self-serve access | Proposed |
| 0009 | Authentication and session evolution | Accepted |
| 0010 | API contract, validation and error semantics | Accepted |
| 0011 | Offline-first boundaries and synchronization | Accepted |
| 0012 | Observability and privacy-preserving analytics | Accepted |
| 0013 | External provider and cache boundaries | Accepted |
| 0014 | Data migration and backward compatibility | Accepted |
| 0015 | Architecture decision governance | Accepted |
| 0016 | Passkeys and Sign in with Apple evaluation | Accepted — Deferred |
| 0017 | Lookup resilience and provider fallbacks | Accepted |
| 0018 | Persistent multi-team delivery model | Accepted |
| 0019 | Platform foundation and offline-first architecture | Proposed |
| 0020 | Generic collection domain model | Proposed |
| 0021 | AI collection tool contracts and data-minimization policy | Proposed |

## Important relationships

```text
0002 Scaling
  |
  +-- 0014 Migration
  +-- 0010 API contract
  |
  +-- 0003 Generic collection domain
          |
          +-- 0011 Offline/sync
          +-- 0013 Providers/caches
          +-- 0006 AI
          +-- 0007 Social
          +-- 0008 Monetization
          +-- 0020 Generic collection domain model (operationalizes 0003)

0009 Authentication
  |
  +-- 0016 Passkeys/Apple evaluation
  +-- 0004 Security/privacy

0013 External providers/caches
  |
  +-- 0017 Lookup resilience & provider fallbacks
          |
          +-- 0011 Offline-first boundaries (future mirror/outbox posture)
```

## Numbering note

The repository previously contained duplicate ADR-0003 and ADR-0004 filenames. The monetization decision is now ADR-0008 and the passkey evaluation is ADR-0016. The duplicate files were removed so every ADR number is unique.

The offline-first platform ADR was renumbered from `0015` to `0019` to resolve a collision with the Accepted `0015` Architecture decision governance ADR (unique-number rule). The new/conflicting decision was renumbered per the governance rule.
