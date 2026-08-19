# ADR-0016: Offline capability and trust matrix

- **Status:** Accepted
- **Date:** 2026-08-19
- **Related roadmap:** #150, #152, #157, #158, #159, #162, #289, #292

## Capability matrix

| Capability | Offline | Local state | Synchronization | Notes |
| --- | --- | --- | --- | --- |
| App shell/startup | Yes after installation/initial visit | Static precache | No | M1 #157 |
| Browse synchronized collection | Yes | IndexedDB mirror | Pull/reconcile | M2 |
| View item details already synchronized | Yes | IndexedDB | No immediate network required | M2 |
| Add collection item | Yes after required local identification data is available | Durable outbox | Push on reconnect | M2 #292 |
| Edit collection item | Yes for supported fields | Durable outbox | Push on reconnect | M2 |
| Delete collection item | Yes for supported workflow | Durable outbox | Push on reconnect | M2 |
| Barcode scan | Yes when scanner assets are installed/available | Device/runtime | No lookup required for decode | Existing iOS validation; M1/M2 regression |
| OCR cover scan | Yes when required OCR assets are installed/available | Device/runtime | No network required for OCR | Provider lookup may remain unavailable offline |
| Identify from local synchronized catalogue | Yes | IndexedDB | No | M2 |
| External provider lookup | No | Optional safe cache only | N/A | Requires current provider/network access |
| Registration/access request | No | None | N/A | Online-only |
| Login/re-authentication | No for new authentication | Minimal session bootstrap only | N/A | Online-only; cached trusted session may permit approved offline capabilities |
| Session revocation/security administration | No | None | N/A | Requires current authorization |
| Payment/checkout | No | None | N/A | Online-only |
| Admin/security administration | No | None | N/A | Online-only |
| User asset upload | No by default | Local staging only if later approved | Push when online | Requires explicit asset policy |
| Sync status | Yes | Local operation state | Reconciled on reconnect | Must be visible to user |

## Trust rules

1. Offline data is scoped to the authenticated user, tenant and device context.
2. No raw password, access code, bearer token or session credential is persisted in IndexedDB.
3. Offline access is limited to a previously trusted session/device and an approved capability set.
4. Local records are deleted or invalidated on sign-out/account switch according to the security policy.
5. Server synchronization re-authorizes every operation; browser-supplied tenant/owner identifiers are never authoritative.
6. Outbox operation IDs are unique and cannot be replayed by another user/tenant.
7. Cached provider responses are not treated as authorization evidence.
8. Offline UI must distinguish local, pending, synchronized, failed and conflicted states.
9. No offline operation may silently discard a user mutation.
10. Sensitive operations remain online-only unless a later ADR explicitly changes this matrix.

## Synchronization invariants

- Every offline mutation has a durable operation ID.
- Processing the same operation more than once is idempotent.
- Reconnect may be interrupted and resumed without losing queued operations.
- Server-side authorization is evaluated at synchronization time.
- Local state never becomes a source of truth for tenant ownership.
- Conflict-sensitive entities use explicit optimistic concurrency/version checks.
- User edits are never overwritten silently by metadata enrichment.

## UX requirements

Offline state is a normal application state, not an error screen. The UI must communicate:

- offline availability;
- pending mutations;
- synchronization progress/result;
- failed operations requiring attention;
- conflicts requiring user action.

No feature may imply that an offline mutation is permanently saved to the server until synchronization succeeds.
