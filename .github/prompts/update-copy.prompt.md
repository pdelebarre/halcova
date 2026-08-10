---
description: "Update user-facing copy in Runout (labels, toasts, empty states, buttons) by editing the catalog objects' .copy blocks — never hardcoding strings into components, and keeping records/books parallel. Triggers: 'change the wording', 'update copy', 'rename the label', 'crate should say', 'update toasts', 'change empty state text', 'rewrite the copy'."
name: "Update copy"
argument-hint: "What wording should change (e.g. 'crate → collection')?"
agent: "Runout Engineer"
---
Update user-facing copy in Runout the right way: all UI strings live in the
`copy` blocks of the catalog objects in `src/catalog.js`
(`recordsCatalog.copy` / `booksCatalog.copy`), never hardcoded in components.

## Steps
1. Locate the strings to change — check the catalog `.copy` blocks first, then
   the components (if a string is hardcoded, move it into `.copy` rather than
   just editing it).
2. Keep the two catalogs parallel: the same label/toast/key exists in both
   `recordsCatalog.copy` and `booksCatalog.copy` (e.g. "crate" vs "shelf").
   Change both unless the request is clearly for one kind only.
3. Preserve the copy-key contract — `copy` is a map of keys consumed by
   components (`emptyTitle`, `addToast`, `resultOwned`, `moreBy`, …); don't
   rename keys without updating their consumers.
4. Some `copy` values are functions (`moreBy`, `nothingElseBy`) — keep their
   signatures when rewording.
5. Grep for the old string to make sure no component, test, or empty-state
   still references it.
6. Run `npm test` (copy may be asserted) and `npm run lint`.

## Deliverables
- Which `copy` keys changed (both catalogs if applicable).
- Confirmation no hardcoded strings were introduced and no tests broke.
