---
description: "Review the current changes (git diff) against Runout's conventions before committing: dark-screen render risks, splitArtistTitle imports, copy leaking into components, API normalization in views, auth/secret leaks, and skill compliance. Triggers: 'review changes', 'review my diff', 'check my changes', 'is this safe to commit', 'pre-commit review', 'review the code'."
name: "Review changes"
argument-hint: "Any specific area to focus on (e.g. 'the scanner changes')?"
agent: "Runout Engineer"
---
Review the uncommitted changes in this repo against Runout's conventions and
failure modes, and report findings by severity before anything is committed.

## Steps
1. Inspect the current diff (staged + unstaged) — summarize what changed and
   which files are touched.
2. Check for the app's known failure modes:
   - **Dark-screen risk**: any new unguarded render path (missing/undefined
     item fields, `title`/`genre`/`coverImage` access, missing
     `splitArtistTitle` import from `src/utils/match.js`).
   - **Copy leaks**: user-facing strings hardcoded in components instead of the
     catalog's `.copy`.
   - **Normalization**: raw API fields reaching views instead of being
     normalized in `src/api/*`.
   - **Secret leaks**: access codes or the admin key (`RUNOUT_ADMIN_KEY`)
     logged, returned, or committed; `publicUser` bypassed.
   - **Auth**: any new function endpoint missing its authorization check.
   - **Storage**: blob store keys changed without a migration path.
3. Confirm the changed areas follow the matching `.github/skills/` workflow.
4. If it looks mergeable, run `npm run lint` and `npm test` and report the
   result.

## Deliverables
- A short summary of the diff.
- Findings by severity (critical / major / minor) with file + fix.
- Verdict: safe to commit, or what to fix first.
