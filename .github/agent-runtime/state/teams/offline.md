TEAM: OFFLINE
CURRENT ISSUE: #159 M2 Offline Capability Matrix & Collector UX
STATUS: ACTIVE — rebased onto main incl. merged #292 outbox (outbox.js/outboxSync.js/useOutboxSync.js); #159 ships offline-capability-matrix.md + SyncStatus component + useOfflineSyncStatus hook (pending/error/attention + Sync-now) + SettingsModal local-data reset (per-user) + i18n keys in 8 locales + no-silent-fallback tests. offlineOutbox read interface wired to the real #292 durable outbox (safe {opId,status,kind} only); CollectionView Sync-now bound to flushOutbox (not re-pull); mutation counter keeps the pending strip fresh; SettingsModal clear focus management + 44px Sync-now target + synced state surfaced.
ACTIVE PR: #422 (m2/offline/159)
LAST GATE: local PASS — affected suites green (offlineOutbox, sync-status, settings-modal, no-silent-fallback, useCollection-offline, useOutboxSync, outbox, outboxSync, i18n); oxlint clean on touched files. Independent Ergonomics + Security + Tester gates to re-verify (not self-approved).
BLOCKER: none
NEXT: independent Ergonomics Reviewer + Security Auditor + Tester verification of the wired offline journey
