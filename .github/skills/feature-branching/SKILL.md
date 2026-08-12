---
name: feature-branching
description: "Create and work on feature branches for Runout: never commit new features to main. Covers branch naming (feat/ fix/ docs/ chore/), creating a branch off main, keeping it in sync, finishing with a pull request, and the gotcha that untracked folders like .github can appear lost when switching branches. Triggers: 'new branch', 'feature branch', 'branch for this', 'create a branch', 'never commit to main', 'start a feature', 'PR'."
---
# Feature Branching

Runout's rule: **new features (and fixes, docs, tooling) are developed on a
feature branch and merged via a pull request — never committed straight to
`main`.**

## When to Use
- The user asks to start new work (a feature, fix, or refactor).
- Any agent is about to create or edit files for a new feature.

## The Workflow
1. **Confirm the base**: `git branch --show-current`. Already on a feature
   branch → reuse it (or confirm with the user). On `main` → proceed to create
   one.
2. **Create the branch** (kebab-case, prefixed by intent):
   ```bash
   git switch -c feat/<short-slug>   # feat/ fix/ docs/ chore/
   ```
   e.g. `feat/scan-next`, `fix/detail-notes-save`, `docs/architecture`.
3. **Do the work on that branch** — implementation, tests, and docs together.
4. **Keep it in sync**: `git fetch origin && git merge origin/main` (or rebase)
   so the branch doesn't drift.
5. **Finish with a PR**: push the branch and open a pull request back into
   `main` (see the `create-pull-request` skill / GitHub MCP). Don't fast-forward
   straight to `main`.
6. **Exception**: only the user can explicitly ask to work directly on `main`
   (e.g. a one-line hotfix to a deployed site).

## Verification
- `git status` before and after work: confirm you're on the intended branch
  and only your feature's files changed.
- `git log origin/main..HEAD` shows exactly the feature's commits.

## Gotchas
- **Untracked files are not carried by branches.** `.github/` (this
  customization pack) is untracked in git — switching branches can make it
  look "lost" (the working tree reverts to whatever is on disk). Before
  branching, if `.github/` isn't committed yet, commit or copy it aside first.
- Don't leave half-done work on `main`; if you accidentally started there,
  move it to a branch before committing.
