# Session Memory Template

Copy this template to `.github/ai/session-memory.md` and update during agent workflows.

```markdown
# Session: [Feature/Bug/Task Name]
**Started**: YYYY-MM-DD HH:MM
**Coordinator**: @coordinator
**Status**: [In Progress | Blocked | Complete]

## Context
[1-2 sentences describing what this session is about]

## Decisions Made
- [ ] Decision 1: [Description]
- [ ] Decision 2: [Description]
- [ ] Decision 3: [Description]

## Tasks Assigned
| Agent | Task | Status | Notes |
|-------|------|--------|-------|
| @agent-name | Task description | [Pending | In Progress | Complete] | [Any notes] |
| @tester | Implement tests | Pending | Waiting for implementation |
| @security-auditor | Security review | Pending | User-facing feature |

## Blockers
- [ ] [Blocker description] — [Who is resolving] — [ETA if known]

## Files Modified
- `path/to/file1.ts`
- `path/to/file2.tsx`
- `path/to/file3.test.ts`

## Open Questions
- [ ] [Question for user or architect]

## Next Steps
- [ ] [Next action item]
- [ ] [Next action item]

## Session Notes
[Any additional context, learnings, or observations from this session]

---
**Last Updated**: YYYY-MM-DD HH:MM
```

## Usage Guidelines

### When to Update
1. **After each agent handoff** — Record which agent was invoked and outcome
2. **After major decisions** — Document architectural or design decisions
3. **When blockers are identified** — Track what's blocking progress
4. **At session end** — Summarize what was accomplished

### What to Include
- **Decisions**: Architectural, design, or implementation choices
- **Tasks**: Which agents were assigned what work
- **Blockers**: Anything preventing progress
- **Files**: All files created or modified
- **Questions**: Unresolved items needing user input

### What to Exclude
- Verbose code snippets (reference files instead)
- Agent conversation transcripts (summarize outcomes)
- Temporary debugging notes (clean up before session end)
