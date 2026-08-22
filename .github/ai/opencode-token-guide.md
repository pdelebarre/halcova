# OpenCode Token Optimization Guide (DeepSeek Flash)

## Quick Start

### 1. Install DCP Plugin (Dynamic Context Pruning)

Edit your global OpenCode config `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": [
    "@tarquinen/opencode-dcp@latest",
    "@rtk/opencode-plugin@latest"
  ]
}
```

Restart OpenCode, then verify installation:
```bash
/dcp
```

### 2. Configure DCP for Your Project

Create `.opencode/dcp.jsonc` (or use global `~/.config/opencode/dcp.jsonc`):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
  "enabled": true,
  "compress": {
    "maxContextLimit": 50000,
    "minContextLimit": 20000,
    "nudgeFrequency": 1,
    "nudgeForce": "strong",
    "iterationNudgeThreshold": 5
  },
  "strategies": {
    "deduplication": true,
    "purgeErrors": true,
    "supersedeWrites": true
  }
}
```

### 3. Install RTK (Rust Token Killer) - Optional

Download from [RTK releases](https://github.com/danielgross/rtk/releases):
```bash
# macOS
brew install rust-token-killer

# Or download binary and add to PATH
rtk init -g --opencode
```

Verify:
```bash
rtk --version
rtk gain  # Shows token savings
```

### 4. Copy Project Config
```bash
cp .opencode/config.yaml ~/.config/opencode/config.yaml
cp .opencode/dcp.jsonc ~/.config/opencode/dcp.jsonc
```

### 5. Update `.opencodeignore`
Already configured to exclude:
- `.github/ai/README.md` (8.7KB savings)
- `node_modules/`, `dist/`, `build/`
- Large generated files (`*.min.js`, `*.map`)

## DeepSeek Flash Configuration

### Model Setup
Your config uses **DeepSeek Flash** for all tasks:
```yaml
models:
  default: deepseek/deepseek-chat
  explorer: deepseek/deepseek-chat
  planner: deepseek/deepseek-chat
  coder: deepseek/deepseek-chat
  debugger: deepseek/deepseek-chat
```

### Why DeepSeek Flash?
- **Cost**: ~10-20x cheaper than Claude Sonnet
- **Speed**: Very fast responses
- **Quality**: Good for most coding tasks
- **Context**: 128K context window

### When to Use Other Models
- **DeepSeek Flash**: 95% of tasks (implementation, debugging, planning)
- **Claude Sonnet**: Only for very complex reasoning or when Flash struggles

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
# Plan first
/goal --plan "Refactor auth module"

# Then execute
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

### 4. Monitor DCP Stats
```bash
/dcp stats
```

Shows token savings from pruning and compression.

### 5. Manual Pruning (if needed)
```bash
# Prune last N tool outputs
/dcp sweep 5

# View context composition
/dcp context
```

## Monitoring Token Usage

### Check Context Usage
```bash
/context
```

**Target**: < 50% utilization after preloading

### Check DCP Stats
```bash
/dcp stats
```

Shows:
- Tokens pruned
- Compression ratio
- Session history

### Check RTK Savings
```bash
rtk gain
```

Shows tokens saved by RTK compression.

### Signs of Context Bloat
- Responses become generic or unfocused
- Instructions are ignored
- Quality degrades after 10+ turns
- Agent repeats information

### Recovery Actions
1. **Manual pruning**: `/dcp sweep 5`
2. **Fresh session**: `/new`
3. **Reduce scope**: Use specific file references instead of `#codebase`

## Cost Estimates (DeepSeek Flash)

### Before Optimization
- **Average session**: 15,000 tokens
- **Sessions per day**: 30
- **Daily cost**: 450,000 tokens
- **Monthly cost**: 13.5M tokens
- **Cost at $0.14/1M**: ~$1.89/month

### After Optimization
- **Average session**: 6,000 tokens (60% reduction)
- **Sessions per day**: 30
- **Daily cost**: 180,000 tokens
- **Monthly cost**: 5.4M tokens
- **Cost at $0.14/1M**: ~$0.76/month

**Monthly savings**: ~8M tokens (~60% reduction, ~$1.13/month)

### DeepSeek Flash Pricing
- **Input**: $0.14 per 1M tokens
- **Output**: $0.28 per 1M tokens
- **Context**: 128K tokens

**Note**: Even at these low prices, 60% reduction matters for high-volume usage!

## Configuration Reference

### Key Settings in `config.yaml`
```yaml
# DeepSeek Flash for all tasks
models:
  default: deepseek/deepseek-chat
  explorer: deepseek/deepseek-chat
  coder: deepseek/deepseek-chat

# Auto-compact prevents runaway sessions
autoCompact: true

# Terse output saves tokens
caveman: true
```

### Key Settings in `dcp.jsonc`
```jsonc
{
  "compress": {
    "maxContextLimit": 50000,  // Start pruning at 50K tokens
    "minContextLimit": 20000,  // Aggressive below 20K
    "nudgeFrequency": 1,       // Nudge every turn
    "nudgeForce": "strong"     // Strong suggestions to compact
  },
  "strategies": {
    "deduplication": true,     // Remove duplicate tool calls
    "purgeErrors": true,       // Clean old error outputs
    "supersedeWrites": true    // Compress superseded file writes
  }
}
```

## Files to Reference
- `.opencodeignore` — Files excluded from context
- `.opencode/config.yaml` — OpenCode configuration (DeepSeek Flash)
- `.opencode/dcp.jsonc` — DCP plugin configuration
- `.github/copilot-instructions.md` — Project-wide standards
- `.github/frontend/.instructions.md` — Frontend patterns
- `.github/backend/.instructions.md` — Backend patterns

## Troubleshooting

### High Token Usage
1. Check `.opencodeignore` — Ensure large files excluded
2. Verify DCP installed — `/dcp` should show stats
3. Check DCP config — `maxContextLimit: 50000` (lower if needed)
4. Use `/new` — Reset session between tasks

### DCP Not Working
1. Check plugin installed — `~/.config/opencode/opencode.jsonc` has DCP
2. Restart OpenCode — Plugins load on startup
3. Check DCP config — `.opencode/dcp.jsonc` or `~/.config/opencode/dcp.jsonc`
4. Verify with `/dcp` — Should show status, not error

### RTK Not Working
1. Check binary in PATH — `rtk --version`
2. Initialize RTK — `rtk init -g --opencode`
3. Check plugin in OpenCode config — `@rtk/opencode-plugin@latest`
4. Verify with `rtk gain` — Should show savings

### Agent Quality Issues with Flash
1. **Most tasks**: Flash should handle 95% well
2. **Complex reasoning**: If Flash struggles, temporarily use Sonnet
3. **Context bloat**: Check `/context` — reduce if > 50%
4. **Specific prompts**: Use clearer, more structured prompts

## Resources
- [DCP Plugin GitHub](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning)
- [RTK GitHub](https://github.com/danielgross/rtk)
- [OpenCode Ecosystem](https://opencode.ai/docs/ecosystem/)
- [DeepSeek Pricing](https://platform.deepseek.com/pricing)
- [DCP Commands Guide](https://opencodedocs.com/Opencode-DCP/opencode-dynamic-context-pruning/platforms/commands/)
