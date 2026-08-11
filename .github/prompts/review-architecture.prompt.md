---
description: "Review Runout's whole-stack architecture for scalability, cloud-readiness, and maintainability — or design a target architecture (including a Spring Boot backend option) with an incremental migration path. Read-only. Triggers: 'review architecture', 'architecture review', 'is it scalable', 'cloud-ready', 'design the backend', 'Spring Boot', 'system design', 'scale this', 'architect this'."
name: "Review architecture"
argument-hint: "Focus (e.g. 'collection API scalability', 'Spring Boot backend design') or leave blank for a full review?"
agent: "Whole Stack Architect"
---
Review or design Runout's end-to-end architecture using the
`whole-stack-architecture` skill (read its `SKILL.md` and
`references/scalability-review.md`).

## Scope
- Current state: React/Vite SPA, Netlify functions (`collection`, `auth`,
  `admin`, `discogs`), Netlify Blobs, auth model, caching, PWA.
- If a target is requested (e.g. a Spring Boot backend or a cloud move),
  produce a design: service boundary, API contract, data model, auth, caching,
  and incremental migration steps that preserve the owner's stores and PWA
  behavior.

## Deliverables
- A current-state assessment scored across the skill's review dimensions
  (contracts, auth/isolation, storage, caching/rate limits, reliability,
  deployment).
- Findings by severity — or the target design with trade-offs and a
  migration path.
- A one-line verdict on whether the current architecture is right-sized.
- Do NOT edit code — this is a design/review deliverable.
