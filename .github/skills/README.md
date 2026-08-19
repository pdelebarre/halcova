# Skill inventory

Reusable skills in `.github/skills/<name>/SKILL.md`. Agents reference these
instead of duplicating long instructions. A skill's folder name is its
identifier.

## Governance / delivery

| Skill | Purpose | Primary consumers |
|---|---|---|
| `agentic-workflow` | Governed delivery graph: PM orchestration, gates, DAG, loops | Project Manager, all gates |
| `feature-branching` | Branch naming and PR discipline | All implementers |
| `token-efficient-work` | Minimum-sufficient-context inspection discipline | All agents |
| `testing` | Vitest + Testing Library workflow and quality gate | Tester, implementers |
| `release-readiness` | Release checklist before merge/deploy | Release Validator |

## Architecture / data / platform

| Skill | Purpose | Primary consumers |
|---|---|---|
| `whole-stack-architecture` | End-to-end architecture and cloud evolution | Whole Stack Architect |
| `api-contracts` | Endpoint design and compatibility | API Contract Reviewer, Netlify Backend |
| `postgres-migrations` | Schema and database initialization changes | Data Architect |
| `docker-synology` | Local/NAS deployment design | Platform Architect |
| `offline-data` | IndexedDB and local-first workflows | Offline Architect, Sync Engineer |
| `sync-protocol` | Offline mutation queues and reconciliation | Offline Architect, Sync Engineer |
| `observability` | Production diagnostics and operational evidence | Observability Engineer |

## Security / tenant

| Skill | Purpose | Primary consumers |
|---|---|---|
| `auth-access` | Access-code auth, admin panel, session lifecycle | Netlify Backend, Security Auditor |
| `multi-tenant-data` | Tenant-owned data and authorization | Multi-tenant Security, Data Architect |

## Domain / product

| Skill | Purpose | Primary consumers |
|---|---|---|
| `add-catalog-type` | New collection type (records → books pattern) | Catalog Designer |
| `lookup-api-integration` | Discogs / Google Books lookup normalization | Runout Engineer, Netlify Backend |
| `barcode-scanning` | Camera barcode scanner (zxing-wasm) | Scanner Builder |
| `netlify-collection` | Collection Netlify function + Blobs + optimistic hook | Netlify Backend |
| `pwa-offline` | PWA / offline precache and runtime caching | Netlify Backend, Offline Architect |
| `ergonomics-review` | UX/a11y review (read-only, may block critical UX) | Ergonomics Reviewer |
| `figma-design` | Figma design-to-code / code-to-design | UI UX Expert |
