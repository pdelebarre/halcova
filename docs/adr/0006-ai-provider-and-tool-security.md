# ADR-0006: AI provider abstraction and secure collection tools

- **Status:** Accepted
- **Date:** 2026-08-18
- **Related epic:** #331
- **Related platform:** #302

## Context

Halcova needs AI for metadata completion, duplicate detection, collection questions, recommendations and image identification. The administrator must be able to switch to a cheaper or different LLM provider without application changes or a deployment.

## Decision

All LLM access goes through the existing provider-neutral AI gateway. The application exposes a small set of typed collection tools rather than giving the model direct database/API access.

The gateway controls provider/model selection, quotas, cost limits and audit. Tool arguments are schema validated. Each tool independently authorizes the authenticated user and accesses only the minimum necessary data. Model output and external metadata are untrusted.

Mutating operations are application commands and require normal authorization and explicit user confirmation where the UX warrants it.

## Security requirements

- no provider credentials in the client;
- prompt injection cannot grant permissions;
- tool calls are rate/cost limited;
- sensitive content is excluded from prompts unless necessary;
- audit logs are PII-safe;
- provider failures degrade safely;
- deterministic fallbacks are preferred where practical.

## Consequences

Provider changes are operationally simple and AI capabilities can evolve independently of the domain. The gateway and tool-contract layer add implementation complexity but create a durable security boundary.
