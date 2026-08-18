# ADR-0005: Collector-first UX architecture

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related epic:** #319

## Decision

Optimize the product around the primary collector loop: **Capture -> Identify -> Confirm -> Add -> Browse**.

The mobile UI will use one dominant Add action, progressive disclosure, infer-first metadata, one-handed controls, 44px+ touch targets, explicit offline/loading/error states, global search and reusable item-detail patterns. Shared canonical metadata and My Copy ownership data must be visually distinct.

Critical flows target WCAG 2.2 AA. AI remains an optional assistant rather than the primary navigation model.

## Rationale

Collectors often use the app while shopping, browsing shelves or handling physical items. A database-style form-first UI increases friction and reduces adoption. The product must make capture and identification dramatically faster than manual entry.

## Product quality target

For a known item, target less than 10 seconds from capture to successful add under realistic device/network conditions.

## Consequences

Some advanced fields move behind progressive disclosure. The domain model may be rich, but the primary UI should remain simple. UX metrics become release criteria rather than subjective polish.
