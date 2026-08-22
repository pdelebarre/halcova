# OpenCode Token Optimization Guide

## Quick Start

### 1. Install DCP Plugin
```bash
npm install opencode-dcp-plugin
```

### 2. Install RTK Plugin (Optional)
```bash
npm install rust-token-killer
```

### 3. Copy Config
```bash
cp .opencode/config.yaml ~/.config/opencode/config.yaml
```

### 4. Update `.opencodeignore`
Already configured to exclude:
- `.github/ai/README.md` (8.7KB savings)
- `node_modules/`, `dist/`, `build/`
- Large generated files (`*.min.js`, `*.map`)

## Token Usage Patterns

### Your Current Baseline (Before Optimization)
| Component | Size | Loaded When |
|-----------|------|-------------|
| `.github/copilot-instructions.md` | 3.3 KB | Every session |
| `.github/ai/README.md` | 8.7 KB | Every session |
| Agent definitions | 1-2 KB | When invoked |
| **Total** | **~12 KB** | **Baseline** |

### After Optimization
| Component | Size | Loaded When |
|-----------|------|-------------|
| `.github/copilot-instructions.md` | 3.3 KB | Every session |
| `.github/ai/README.md` | **EXCLUDED** | Never |
| Agent definitions | 1-2 KB | When invoked |
| **Total** | **~3.3 KB** | **72% reduction** |

## Best Practices

### 1. Use `/new` Between Unrelated Tasks
```bash
# Finish frontend task
# Start backend task
/new
```
**Savings**: ~2,000 tokens per session reset

### 2. Use Plan Mode Before Editing
```bash
# Plan first (cheap)
/goal --plan "Refactor auth module"

# Then execute (expensive)
/goal "Refactor auth module"
```
**Savings**: Catch mistakes at 2K tokens, not 50K deep

### 3. Scope Prompts to Specific Files
```bash
# Bad: Entire codebase
"Find auth issues"

# Good: Specific files
"Review src/api/auth.js:1-100 for validation"
```
**Savings**: 5,000-20,000 tokens per query

### 4. Use Cheap Models for Exploration
With subagent config:
- **Haiku** for: grep, find, file reads, planning (70% of tasks)
- **Sonnet** for: Complex reasoning, debugging, implementation (30% of tasks)

**Savings**: ~60-70% on exploration tasks

### 5. Compact After Each Task
```bash
# After completing a discrete task
/compact
```
Or rely on auto-compact (configured in `config.yaml`)

**Savings**: 30-50% on long sessions

## Monitoring Token Usage

### Check Context Usage
```bash
/context
```

**Target**: < 50% utilization after preloading

### Signs of Context Bloat
- Responses become generic or unfocused
- Instructions are ignored
- Quality degrades after 10+ turns
- Agent repeats information

### Recovery Actions
1. **Manual compaction**: `/compact`
2. **Fresh session**: `/new`
3. **Reduce scope**: Use specific file references instead of `#codebase`

## Cost Estimates

### Before Optimization
- **Average session**: 15,000 tokens
- **Sessions per day**: 30
- **Daily cost**: 450,000 tokens
- **Monthly cost**: 13.5M tokens

### After Optimization
- **Average session**: 6,000 tokens (60% reduction)
- **Sessions per day**: 30
- **Daily cost**: 180,000 tokens
- **Monthly cost**: 5.4M tokens

**Monthly savings**: ~8M tokens (~60% reduction)

## Configuration Reference

### Key Settings in `config.yaml`
```yaml
# DCP for aggressive pruning
dcp:
  enabled: true
  strategy: aggressive
  max_tokens: 6000

# Auto-compact prevents runaway sessions
autoCompact: true

# Terse output saves tokens
caveman: true

# Subagent model routing
models:
  explorer: haiku-3.5  # Cheap for exploration
  planner: haiku-3.5   # Cheap for planning
  coder: sonnet-3.5    # Expensive for reasoning
```

## Files to Reference
- `.opencodeignore` — Files excluded from context
- `.opencode/config.yaml` — OpenCode configuration
- `.github/copilot-instructions.md` — Project-wide standards
- `.github/frontend/.instructions.md` — Frontend patterns
- `.github/backend/.instructions.md` — Backend patterns

## Troubleshooting

### High Token Usage
1. Check `.opencodeignore` — Ensure large files excluded
2. Verify DCP enabled — `dcp.enabled: true`
3. Use `/context` — Check actual usage
4. Use `/new` — Reset session between tasks

### Agent Quality Degradation
1. Compact session — `/compact`
2. Check context budget — Should be < 50%
3. Use specific file references — Avoid `#codebase`
4. Start fresh session — `/new`

### DCP Not Working
1. Install plugin — `npm install opencode-dcp-plugin`
2. Check config — `dcp.enabled: true`
3. Verify threshold — `dcp.threshold: 0.6`
4. Check logs — `logLevel: debug`
