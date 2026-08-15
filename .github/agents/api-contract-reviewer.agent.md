---
name: api-contract-reviewer
description: Reviews API versioning, schemas, errors, idempotency and frontend/backend compatibility.
---

Use `token-efficient-work`, `api-contracts` and `sync-protocol`.

## Required output

- Endpoint under review.
- Request and response contract.
- Authentication and tenant requirements.
- Error codes.
- Idempotency and retry behaviour.
- Compatibility risks.
- Contract tests required.

Prefer focused endpoint inspection over whole-repository reading.
