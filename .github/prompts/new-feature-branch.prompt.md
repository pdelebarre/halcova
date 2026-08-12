---
description: "Start new feature work on a fresh feature branch for Runout — never on main. Creates (or reuses) a properly-named branch off main, confirms you're on it, and reports before any code is written. Triggers: 'start a feature', 'new feature branch', 'create a branch', 'branch for this', 'make sure it is on a branch'."
name: "New feature branch"
argument-hint: "Describe the feature (used for the branch name, e.g. 'scan next button')?"
agent: "Runout Engineer"
---
Create (or confirm) a feature branch before starting new work — Runout never
commits new features to `main`.

## Steps
1. Follow the `feature-branching` skill
   (`.github/skills/feature-branching/SKILL.md`).
2. Check `git branch --show-current`:
   - Already on a feature branch → confirm with the user it's the right one
     and reuse it.
   - On `main` → `git fetch origin` (if a remote exists), then
     `git switch -c feat/<kebab-slug>` from the latest `main`.
3. Report the branch name and whether the working tree is clean (or what's
   pending), then wait for the feature task.

## Deliverables
- The feature branch name you're on.
- Confirmation no new work will be committed to `main`.
