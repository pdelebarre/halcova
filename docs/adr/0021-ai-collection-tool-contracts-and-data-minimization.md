# ADR-0021: AI Collection Tool Contracts & Data-Minimization Policy

- **Status:** Proposed — pending specialist review (AI Architect, Security Auditor, Whole Stack Architect)
- **Date:** 2026-08-21
- **Related epic:** #331 (Collection Intelligence & AI Assistant)
- **Related issues:** #332 (this design gate), #333 (assistant), #334 (completion/dedup), #306 (feedback triage), #307 (smart inbox), #308 (issue gen), #310 (dashboard), #309 (sync)
- **Builds on:** ADR-0006 (AI provider/tool security boundary), ADR-0013 (external provider/cache boundaries), ADR-0010 (API contract/validation), ADR-0014 (data migration), ADR-0019 (offline-first compatibility), ADR-0020 (generic collection domain model), #303 (AI provider abstraction), #304 (secure LLM config storage), #409 (XSS guard), #317 (provider adapter layer / payload-guard)
- **Design gate:** this PR contains **no implementation code**. It is the frozen tool-contract and data-minimization design that #333/#334/#306/#307/#308/#310/#309 are implemented from.

---

## Context

Halcova's AI capabilities (epic #331) must make collection management dramatically easier without giving the LLM unrestricted access to Halcova data or bypassing normal authorization. The existing foundations are in place:

- **#303** provides the provider-neutral `Provider` interface, `runCapability` runner, typed capability contracts (`CLASSIFY`, `DEDUPLICATE`, `PRIORITIZE`, `GENERATE_ISSUE_EPIC`), and the `validateSchema` output validator.
- **#304** provides secure LLM config storage: admin-only API, secrets at rest, host allowlist, atomic test-before-activate.
- **#409** provides `isDangerousContent` — the XSS guard that rejects script/event-handler/javascript: content in stored text fields.
- **#317** provides `payload-guard.js` — envelope-level size/schema/host validation for untrusted provider output, plus `isSafeCanonicalString` re-export.
- **ADR-0006** establishes the AI provider/tool security boundary: no provider credentials in the client, prompt injection cannot grant permissions, tool calls are rate/cost limited, sensitive content excluded from prompts unless necessary.
- **ADR-0013** establishes that all external providers (including AI) are accessed through server-side adapters with validation, normalization, and data-minimization rules.
- **ADR-0010** establishes that LLM output and imported metadata are untrusted input, validated before use.
- **ADR-0019** establishes offline-first architecture: AI features that assume always-online must not break offline launch.

What is missing is the **tool-contract layer** — the concrete set of tools the AI assistant and capability runners may invoke, the exact data each tool accesses, the data-minimization rules that govern what is sent to the model, and the cost/abuse controls that prevent runaway spending.

This ADR defines that layer so the P1 implementation tickets can proceed directly from it.

---

## Decision

### 1. Architecture overview

```
Browser / PWA
    │
    ▼
AI Endpoint (server-side, Netlify Function)
    │
    ├──► AI Runtime (tool dispatch, authorization, cost tracking)
    │       │
    │       ├──► Provider Adapter (OpenAI / future adapters)
    │       │       └──► LLM (schema-validated output)
    │       │
    │       ├──► Collection Tools (read-only search/read)
    │       │       └──► Domain data (minimum necessary context)
    │       │
    │       └──► Mutation Drafts (validated application commands)
    │               └──► Authorization gate → domain write
    │
    └──► Audit Log (PII-safe, cost + tool-call record)
```

**Key boundaries:**

1. **Browser never holds provider credentials.** All AI calls go through the server-side AI endpoint (#304 secure config).
2. **AI suggests; application authorization decides.** The LLM may propose mutations, but they are represented as validated application command drafts that go through normal authorization before execution.
3. **LLM output is untrusted and schema-validated.** Every structured completion is validated against its capability's output schema (`validateSchema` from #303). Malformed/oversized output is rejected fail-closed.
4. **External metadata/user content is untrusted input.** Any user-supplied or provider-supplied content that reaches the LLM is guarded by `isDangerousContent` (#409) and `payload-guard.js` (#317) at the appropriate boundaries.
5. **Provider can be switched without code/deployment.** The admin configures provider/model via the #304 admin API; the AI runtime reads the active config and constructs the appropriate adapter.

### 2. Tool contracts

Each tool is a typed, schema-validated operation that the AI runtime may invoke. Tools are divided into two categories:

- **Read tools** — query domain data and return minimum necessary context to the model. These are the only way the LLM receives collection data.
- **Mutation drafts** — propose a validated application command. The draft is returned to the caller (assistant UX or capability runner) for explicit user confirmation and normal authorization before execution.

Every tool independently re-checks authorization server-side. The LLM never receives raw SQL, API instructions, or direct database access.

#### 2.1 Collection Assistant Tools

The assistant (#333) is a conversational interface that helps users manage their collection. It may invoke the following tools:

| Tool | Category | Input | Output | Data accessed |
| --- | --- | --- | --- | --- |
| `search_items` | Read | `{ query: string, collectionType?: string, limit?: int (1-20) }` | `{ results: [{ id, title, subtitle?, coverUrl?, collectionType, status }] }` | Public canonical metadata + owned status only. Never private notes, lending state, or audit data. |
| `get_item_detail` | Read | `{ itemId: uuid }` | `{ id, title, subtitle?, description?, coverUrl?, providerIds?, canonicalAttributes?, ownedAttributes? (allowlisted only), status }` | Canonical metadata + allowlisted owned attributes (title, notes — never lending history, grading, or audit fields). |
| `get_collection_summary` | Read | `{ collectionType?: string }` | `{ totalItems, identifiedCount, draftCount, byStatus: { ... } }` | Aggregated counts only. Never individual item data. |
| `get_duplicate_suggestions` | Read | `{ collectionType?: string, limit?: int (1-20) }` | `{ suggestions: [{ itemId, duplicateOfId, title, score, reason }] }` | Duplicate candidate pairs with similarity scores. Never private notes. |
| `get_completion_suggestions` | Read | `{ collectionType?: string, limit?: int (1-20) }` | `{ suggestions: [{ itemId, title, missingFields: string[], suggestedValues: object }] }` | Items with missing canonical fields and AI-suggested completions. |
| `propose_mutation` | Mutation draft | `{ action: string, entityType: string, entityId?: uuid, changes: object }` | `{ draftId: uuid, action, entityType, entityId?, changes, requiresConfirmation: boolean }` | The draft is validated but not executed. Returns a draft id for confirmation. |

#### 2.2 Metadata Completion Tool

The completion capability (#334) fills missing canonical fields on items. It is a specialized tool, not a general assistant call.

| Tool | Category | Input | Output | Data accessed |
| --- | --- | --- | --- | --- |
| `complete_metadata` | Read + draft | `{ itemId: uuid, existingFields: object, providerHints?: string[] }` | `{ suggestedFields: object, confidence: number, source: string }` | The item's existing canonical fields (title, subtitle, description, provider ids) — **never** private owned attributes. Provider hints are allowlisted. |

**Data-minimization rule:** Only the item's canonical identity fields are sent to the model. Private owned attributes (notes, grading, lending, wishlist) are **never** included in the prompt context.

#### 2.3 Duplicate Detection Tool

The dedup capability (#334) finds likely duplicate items within a collection.

| Tool | Category | Input | Output | Data accessed |
| --- | --- | --- | --- | --- |
| `find_duplicates` | Read | `{ collectionType: string, threshold?: number (0.5-1.0), limit?: int (1-50) }` | `{ pairs: [{ itemA: { id, title }, itemB: { id, title }, score: number, reason?: string }] }` | Canonical titles and provider ids only. Never private attributes. |

**Data-minimization rule:** Only `title`, `subtitle`, and `providerIds` are sent to the model for comparison. Private fields are excluded.

#### 2.4 Collection Insights Tool

The insights capability (#310 dashboard) provides aggregate intelligence about a collection.

| Tool | Category | Input | Output | Data accessed |
| --- | --- | --- | --- | --- |
| `collection_insights` | Read | `{ collectionType?: string, timeframe?: string }` | `{ summary: string, stats: object, recommendations?: [{ type: string, message: string }] }` | Aggregated statistics and non-identifying patterns. Never individual item private data. |

**Data-minimization rule:** The model receives only aggregated counts and anonymized patterns. Individual item titles are included only when necessary for specific recommendations (e.g., "You have 3 copies of Sgt. Pepper's"), and even then only the canonical title — never private notes.

#### 2.5 Image Recognition Tool

The image recognition capability identifies items from user-submitted images (covers, barcodes).

| Tool | Category | Input | Output | Data accessed |
| --- | --- | --- | --- | --- |
| `identify_from_image` | Read | `{ imageUrl: string (signed, temporary), hints?: { collectionType?: string } }` | `{ candidates: [{ title, confidence, providerId?, source }] }` | The image URL (signed, time-bounded) and public reference data only. |

**Security constraints:**
- Image URLs are server-signed, time-bounded (5 min TTL), and scoped to the authenticated user.
- The image is never stored or cached by the AI provider.
- The model receives only the image data and public reference metadata — never private collection context.

### 3. Data-minimization policy

Every AI tool invocation must follow these rules:

#### 3.1 Minimum necessary context

1. **Only the fields required for the specific capability are included in the prompt.** The capability's input schema (defined in `capabilities.js` from #303) is the authoritative allowlist.
2. **Private owned attributes are never sent to the model** unless the capability explicitly requires them (and even then, only after explicit user consent and a documented privacy review).
3. **Collection-level context is scoped to the authenticated user's own collection.** The model never receives cross-tenant data.
4. **Provider credentials are never in the prompt.** The adapter injects credentials at the HTTP layer, not in the message content.
5. **Audit identifiers, session tokens, and internal IDs** (beyond the stable domain `uuid`) are never included in prompt context.

#### 3.2 Prompt construction rules

The AI runtime constructs prompts using a strict template:

```
System: [fixed system prompt for the capability — no user data]
User: [JSON-serialized capability input — only the fields declared in inputSchema]
```

- The system prompt is static per capability and contains no user data.
- The user message is the JSON-serialized, schema-validated input — nothing more.
- No raw database rows, API responses, or internal state is ever interpolated into the prompt.

#### 3.3 Sensitive content exclusion

- Items flagged with sensitive metadata (e.g., user-classified private notes) are excluded from AI context unless the capability explicitly requires them and the user has consented.
- The AI runtime checks a `aiExclude` flag (or equivalent) on collection items before including them in batch operations (completion, dedup, insights).

### 4. Authorization model

**AI suggests; application authorization decides.** This is the invariant from ADR-0006 and epic #331.

#### 4.1 Read tools

- Every read tool re-checks that the authenticated user owns the collection/items being queried.
- Authorization is derived from the authenticated session (server-side), never from client-supplied identifiers.
- `CanonicalItem` reads are open to authenticated users for public metadata; `CollectionItem` reads are `owner_id`-scoped (ADR-0020 §9/§10).

#### 4.2 Mutation drafts

- A mutation draft is a **validated but unexecuted** application command.
- The draft is returned to the caller (assistant UX) for explicit user confirmation.
- Only after user confirmation does the draft execute through normal application authorization (same path as a manual user action).
- The LLM never directly writes to the database, calls internal APIs, or bypasses authorization.

#### 4.3 Draft execution flow

```
User asks assistant to update item
    → Assistant calls propose_mutation
    → AI runtime validates the draft schema
    → Draft returned to UX with draftId
    → User reviews and confirms
    → UX calls confirm_mutation(draftId)
    → Server re-authorizes the mutation
    → Server executes the domain command
    → Result returned to UX
```

### 5. Cost controls

Every AI tool invocation is subject to cost controls enforced by the AI runtime.

#### 5.1 Per-call bounds

| Control | Default | Enforced by |
| --- | --- | --- |
| Max tokens per completion | 2048 (configurable per capability) | `boundedOptions` / `mergeOptions` (#303) |
| Max response bytes | 64 KB | `readBoundedText` / `maxResponseBytes` (#303) |
| Timeout | 15 s | `DEFAULT_TIMEOUT_MS` (#303) |
| Retries | 2 (3 attempts total) | `DEFAULT_RETRIES` (#303) |
| Temperature | 0 (deterministic) | `DEFAULT_REQUEST_OPTIONS` (#303) |

#### 5.2 Per-user quotas

| Quota | Default | Scope | Enforcement |
| --- | --- | --- | --- |
| Daily AI requests | 100 per user | Per authenticated user | Server-side counter, resets daily |
| Daily AI tokens | 50,000 per user | Sum of all completions | Server-side accumulator |
| Monthly cost cap | $0.50 per user | Per authenticated user | Server-side accumulator, resets monthly |
| Concurrent requests | 1 per user | Per authenticated user | Server-side semaphore |

- Quotas are configurable by admin via the #304 admin API.
- When a quota is exceeded, the AI endpoint returns `RATE_LIMITED` (same error code as provider rate limits).
- Quota counters are stored server-side (Netlify Blobs or Postgres) and are never client-authoritative.

#### 5.3 Cost tracking

- Every AI completion records: `userId`, `capabilityId`, `provider`, `model`, `tokensIn`, `tokensOut`, `latencyMs`, `timestamp`.
- Cost records are PII-safe: `userId` is logged for audit but excluded from aggregation/analytics (ADR-0019 §12 carve-out).
- Daily/weekly cost summaries are available to the admin via the #304 admin API.

### 6. Audit requirements

Every AI tool invocation is audited without logging sensitive content.

#### 6.1 Audit record schema

```typescript
{
  id: uuid,
  userId: string,           // for accountability (audit carve-out, ADR-0019 §12)
  capabilityId: string,     // e.g. "classify", "deduplicate", "complete_metadata"
  toolName: string,         // e.g. "search_items", "propose_mutation"
  provider: string,         // e.g. "openai"
  model: string,            // e.g. "gpt-4o-mini"
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
  cost: number,             // estimated cost in USD (cents)
  result: 'success' | 'error' | 'rejected',
  errorCode?: string,       // e.g. "RATE_LIMITED", "INVALID_OUTPUT"
  timestamp: string,        // ISO 8601
  // NEVER logged: prompt content, model output, private item data
}
```

#### 6.2 What is never logged

- The prompt text or system message.
- The model's raw output (only the schema-validated result shape is returned to the caller).
- Private item fields (notes, grading, lending state).
- Provider credentials or session tokens.

### 7. Security requirements

#### 7.1 Prompt injection

- The system prompt is fixed per capability and never contains user data.
- User input that reaches the model is JSON-serialized capability input — never raw user text interpolated into a prompt template.
- The model's output is schema-validated before any field is used; a prompt-injection attempt that produces malformed output is rejected fail-closed.
- **Test requirement:** prompt-injection test suite exists that attempts to:
  - Make the model ignore its system prompt.
  - Make the model output unauthorized commands.
  - Make the model reveal its system prompt.
  - Make the model access data outside its tool scope.

#### 7.2 Privilege escalation

- The LLM cannot call tools directly; the AI runtime dispatches tool calls based on the capability contract.
- Tool authorization is re-checked server-side on every invocation.
- Mutation drafts are never auto-executed; they require explicit user confirmation through normal authorization.
- **Test requirement:** privilege-escalation test suite exists that attempts to:
  - Call a tool with another user's collection ID.
  - Propose a mutation that changes ownership.
  - Propose a mutation that accesses admin-only functionality.

#### 7.3 Data leakage

- Data-minimization rules (§3) ensure only minimum necessary context reaches the model.
- Audit records never log prompt content or model output (§6.2).
- Provider credentials are injected at the HTTP layer, never in the message content.
- **Test requirement:** data-leakage test suite exists that verifies:
  - Private fields are excluded from prompt context.
  - Cross-tenant data is never accessible.
  - Audit records contain no sensitive content.

#### 7.4 Cost abuse

- Per-user quotas (§5.2) prevent runaway spending from a single account.
- Per-call bounds (§5.1) prevent a single oversized completion.
- Concurrent request limits prevent abuse through parallelism.
- **Test requirement:** cost-abuse test suite exists that verifies:
  - Quota enforcement returns `RATE_LIMITED` when exceeded.
  - Concurrent request limit rejects excess requests.
  - Oversized completion requests are rejected before reaching the provider.

#### 7.5 SSRF and provider boundary

- The provider adapter enforces the host allowlist before every fetch (#303/#304).
- `redirect: 'manual'` is always set (SSRF control, mirroring ADR-0017).
- Provider output is size-capped and schema-validated before use (#303/#317).
- Content-type is validated as JSON before parsing (#317 `isJsonContentType`).

### 8. Offline-first compatibility

Per ADR-0019, no AI feature that assumes always-online may break offline launch.

#### 8.1 AI features are online-only

- All AI capabilities require a network connection to the server-side AI endpoint.
- The AI endpoint itself requires connectivity to the configured LLM provider.
- **No AI feature is required for offline operation.** The app shell, browse, scan, and basic collection management all work offline without AI.

#### 8.2 Graceful degradation

- When offline, AI features are unavailable and the UI must communicate this clearly (not crash or show a loading spinner indefinitely).
- The AI endpoint returns a deterministic error code (`PROVIDER_UNAVAILABLE` or equivalent) when the provider is unreachable.
- The assistant UX shows a clear "AI is unavailable offline" message rather than a generic error.

#### 8.3 No offline AI state

- AI tool invocations are never queued for offline replay. They are online-only operations.
- AI suggestions are not stored locally for later review; they are ephemeral responses to online queries.

### 9. Provider switching

Per epic #331 DoD: "Provider can be switched without code/deployment through #302."

- The admin configures the active provider, model, and API key via the #304 admin API.
- The AI runtime reads the active config on each invocation (or caches it with a short TTL).
- No code change or deployment is required to switch from OpenAI to another provider that implements the `Provider` interface (#303).
- The admin can test a new provider configuration via the #304 "test before activate" flow before making it active.

### 10. Testing requirements

#### 10.1 Unit tests

- Every tool contract has unit tests that verify:
  - Input schema validation rejects malformed input.
  - Output schema validation rejects malformed model output.
  - Authorization is re-checked server-side.
  - Data-minimization rules exclude private fields.
- Every capability runner has unit tests that verify:
  - `runCapability` validates input before sending to the provider.
  - `runCapability` validates output after receiving from the provider.
  - `runCapability` throws `ProviderError` on validation failure.

#### 10.2 Integration tests

- AI endpoint integration tests verify:
  - Authenticated requests succeed.
  - Unauthenticated requests return `UNAUTHORIZED`.
  - Quota-exceeded requests return `RATE_LIMITED`.
  - Provider failure returns a deterministic error (not a 500).
  - Mutation drafts are not auto-executed.

#### 10.3 Security tests

- Prompt-injection test suite (§7.1).
- Privilege-escalation test suite (§7.2).
- Data-leakage test suite (§7.3).
- Cost-abuse test suite (§7.4).
- SSRF regression suite (re-use from ADR-0017 / #284).

#### 10.4 Coverage requirement

- All new AI runtime code: ≥ 70% statement/branch/function coverage.
- Tool contract validation: ≥ 90% statement coverage (critical security boundary).
- Security test suites: 100% of defined test scenarios pass.

### 11. Implementation roadmap

The following P1 tickets implement directly from this ADR:

| Ticket | Scope | Tools/capabilities used |
| --- | --- | --- |
| #333 | Collection assistant (conversational UX) | `search_items`, `get_item_detail`, `get_collection_summary`, `propose_mutation` |
| #334 | Metadata completion + duplicate detection | `complete_metadata`, `find_duplicates`, `get_duplicate_suggestions`, `get_completion_suggestions` |
| #306 | Feedback triage (AI classification) | `CLASSIFY` capability (existing from #303) |
| #307 | Smart inbox (AI prioritization) | `PRIORITIZE` capability (existing from #303) |
| #308 | Issue/epic generation from feedback | `GENERATE_ISSUE_EPIC` capability (existing from #303) |
| #310 | Collection insights dashboard | `collection_insights` tool |
| #309 | AI sync/offline compatibility | Graceful degradation (§8), no offline AI state |

### 12. Consequences

**Positive:**

- Clear, typed tool contracts that implementers can build against directly.
- Data-minimization rules are explicit and testable.
- Authorization invariant ("AI suggests; application decides") is enforced at the architecture level.
- Cost controls prevent runaway spending without requiring provider-level rate limiting.
- Provider switching is operational, not developmental.
- Offline-first compatibility is explicit: AI is online-only but never blocks offline launch.

**Negative:**

- Tool-contract layer adds implementation complexity beyond the existing capability runner.
- Per-user quota tracking requires server-side state (counters/accumulators).
- Mutation draft flow adds UX complexity (confirmation step before execution).
- Some AI features (image recognition) may require additional provider-specific integration.

### 13. Rejected alternatives

- **Direct database access from the LLM:** Rejected by ADR-0006 and epic #331 principles. The LLM never receives SQL, API endpoints, or direct data access.
- **Client-side AI calls:** Rejected by ADR-0006 (no provider credentials in the client) and ADR-0013 (all external providers through server-side adapters).
- **Unbounded prompt context:** Rejected by data-minimization policy. Every capability has a fixed input schema; the model receives only what it needs.
- **Auto-execute mutation drafts:** Rejected by the "AI suggests; application decides" invariant. Every mutation requires explicit user confirmation and normal authorization.
- **Offline AI queue:** Rejected by ADR-0019 compatibility. AI features are online-only; queuing AI requests for offline replay would create stale/unexpected results and add sync complexity.
- **Single global quota:** Rejected in favor of per-user quotas to prevent one abusive user from exhausting the entire budget.

### 14. Security / privacy gate

This ADR defines the security boundary for all AI collection tools. Approval requires independent review by:

1. **AI Architect** — verify tool contracts are complete, consistent with #303/#304, and implementable.
2. **Security Auditor** — verify prompt-injection, privilege-escalation, data-leakage, and cost-abuse controls are adequate (ADR-0006 trigger: AI provider/tool security boundary).
3. **Whole Stack Architect** — verify architecture consistency with ADR-0019 (offline-first), ADR-0010 (API contract), and ADR-0020 (domain model).

No P1 implementation (#333/#334/#306/#307/#308/#310/#309) may proceed before this ADR is accepted.

### 15. Follow-up linkage (for implementers)

- **#333 (assistant):** implement the conversational assistant UX. Uses tools from §2.1. Must implement the mutation draft confirmation flow (§4.3).
- **#334 (completion/dedup):** implement `complete_metadata` and `find_duplicates` tools (§2.2/§2.3). Must enforce data-minimization rules (§3).
- **#306 (feedback triage):** uses existing `CLASSIFY` capability from #303. Must add feedback-specific input/output schemas.
- **#307 (smart inbox):** uses existing `PRIORITIZE` capability from #303. Must add inbox-specific input/output schemas.
- **#308 (issue gen):** uses existing `GENERATE_ISSUE_EPIC` capability from #303. Must add feedback-to-issue mapping.
- **#310 (dashboard):** implement `collection_insights` tool (§2.4) and the dashboard UX.
- **#309 (sync):** implement graceful degradation (§8.2) and offline-unavailable UI (§8.1). No offline AI state (§8.3).