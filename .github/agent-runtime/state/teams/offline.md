TEAM: OFFLINE
CURRENT ISSUE: #292 M2 Offline Capture Outbox, Offline Add & Reconnect Sync
STATUS: ACTIVE — implemented on m2/offline/292: durable IndexedDB outbox (outbox.js), flush+reconcile (outboxSync.js), useCollection.add offline routing + minimal pending primitive, foreground-only useOutboxSync reconnect hook, outbox clear wired into useAuth sign-out/logout-all/account-switch, server idempotent add push via clientOpId (Blobs + Postgres). Affected suites pass (135 tests across outbox/useCollection/offlineMirror/itemUuid/offlineTrust + server collection). Working-tree collision with parallel #159 UX (SyncStatus/offlineOutbox/App.jsx/CollectionView.jsx) — those files are NOT part of this PR.
ACTIVE PR: (pending open — m2/offline/292)
LAST GATE: local PASS — outbox 14, outboxSync 4, useOutboxSync 3, useCollection-offline 11, useCollection 7, offlineMirror 14, itemUuid, offlineTrust, collection.test 58; oxlint clean on touched files
BLOCKER: working-tree collision with parallel #159 UX writes in the same directory; PR contains ONLY #292 files. Independent Offline Architect + Security Auditor + Tester must verify (not self-approved).
NEXT: open PR for m2/offline/292 with only the #292 file set
