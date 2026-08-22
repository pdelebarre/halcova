# Context Budget Documentation

## Current Context Overhead

| File/Component | Size | Estimated Tokens | Loaded When |
|----------------|------|------------------|-------------|
| `.github/copilot-instructions.md` | 3.3 KB | ~550 | Every session |
| `.github/ai/README.md` | 8.7 KB | ~1,500 | Every session |
| Agent definitions (avg) | 2 KB | ~350 | When agent invoked |
| Agent definitions (large) | 9 KB | ~1,500 | When agent invoked |
| Skills (on-demand) | 2-4 KB | ~500-700 | When skill activated |

## Baseline Context Usage

**Minimum session** (copilot-instructions + ai/README):
- ~2,050 tokens baseline

**Typical session** (baseline + 1 agent + 1 skill):
- ~2,900-3,250 tokens

**Complex session** (baseline + coordinator + 3 specialist agents):
- ~4,000+ tokens

## Target Context Budget

| Layer | Target | Current | Status |
|-------|--------|---------|--------|
| Baseline (instructions + README) | ≤3,000 tokens | ~2,050 tokens | ✅ OK |
| Agent definitions | ≤500 tokens avg | ~350-1,500 tokens | ⚠️ Large agents need refactor |
| Skills (on-demand) | ≤700 tokens each | ~500-700 tokens | ✅ OK |
| **Total session** | ≤50% of context window | Varies | ⚠️ Monitor |

## Optimization Actions

### Completed
- [x] Refactor `copilot-instructions.md` → 7.7KB to 3.3KB (57% reduction)
- [x] Create `coordinator.agent.md` for orchestration
- [x] Create `project-manager.agent.md` refactored version
- [x] Create `.github/ai/ai-state.json` for persistent decisions
- [x] Create `.github/skills/project-management/SKILL.md`

### Pending
- [ ] Refactor large agent files (>3 KB):
  - `marketing-manager.agent.md` (3.8 KB)
  - `runout.agent.md` (3.1 KB)
  - `security-auditor.agent.md` (2.8 KB)
  - `ergonomics-reviewer.agent.md` (2.7 KB)
  - `agent-developer.agent.md` (2.6 KB)
- [ ] Split large skills (>200 lines):
  - Review `.github/skills/whole-stack-architecture/`
  - Review `.github/skills/sync-protocol/`
  - Review `.github/skills/offline-data/`

## Monitoring

### Check Context Usage
```bash
# In Copilot Chat or CLI
/context
```

### Signs of Context Bloat
- Agent responses become generic or unfocused
- Instructions are ignored or forgotten
- Session quality degrades after 10+ turns
- Agents repeat information already in context

### Recovery Actions
1. **Manual compaction**: `/compact` in Copilot CLI
2. **Clear context**: `/clear` or `/new` for fresh session
3. **Session restart**: Save to session memory, start new session
4. **Reduce agents**: Use fewer specialist agents per session

## Best Practices

### Do
- Use path-specific `.instructions.md` files for targeted loading
- Keep agent definitions under 50 lines (identity + scope only)
- Store procedures in skills, not agents
- Use session memory for multi-agent workflows
- Compact or clear context between unrelated tasks

### Don't
- Preload entire codebase with `#codebase`
- Include verbose examples in agent definitions
- Store temporary tool output in persistent context
- Run 10+ agent turns without compaction
- Mix unrelated tasks in same session
