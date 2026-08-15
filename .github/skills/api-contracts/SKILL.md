# API contracts

Use for endpoint design and compatibility.

## Conventions

- Version public endpoints under `/api/v1`.
- Use stable machine-readable error codes.
- Include request or correlation IDs.
- Validate input at the boundary.
- Define pagination and filtering explicitly.
- Require idempotency keys for retryable mutations.
- Document authentication, tenant context and authorization.
- Keep provider-specific payloads behind adapters.

## Required output

- Endpoint and method.
- Request and response schema.
- Error cases.
- Authorization requirements.
- Idempotency behaviour.
- Compatibility and migration notes.
