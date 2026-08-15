# AI development framework

This directory documents how repository agents, skills and prompts work together.

## Operating model

1. One primary agent owns each task.
2. Supporting agents review or provide specialist input; they do not independently redesign the same scope.
3. Agents use repository evidence and distinguish observed facts, inferences, assumptions and unknowns.
4. Agents prefer the smallest coherent change and add tests for changed behaviour.
5. Agents are token-conscious: inspect narrowly, avoid rereading unchanged files and stop when acceptance criteria are evidenced.

## Work stages

```text
discovery -> targeted inspection -> decision -> implementation -> validation
```

## Evidence ledger

Agents should maintain a compact working ledger:

```text
Files inspected:
- path/to/file

Facts:
- observed behaviour

Unknowns:
- unresolved behaviour

Next inspection:
- smallest useful next file or symbol
```

## Required completion report

- Summary.
- Files changed.
- Tests and checks run.
- Coverage impact.
- Risks and assumptions.
- Remaining work.

## Routing

| Task | Primary agent | Supporting agent |
|---|---|---|
| Architecture decision | Whole-stack architect | Data or platform architect |
| React feature | Frontend developer | Frontend architect, tester |
| Netlify Function | Netlify backend | API contract reviewer, security auditor |
| Offline persistence | Sync engineer | Offline architect, tester |
| Tenant authorization | Multi-tenant security | Netlify backend, data architect |
| Database migration | Data architect | Security auditor, tester |
| Docker/Synology | Platform architect | Security auditor |
| API contract | API contract reviewer | Backend agent |
| Release | Release validator | Tester, security auditor |
| Ergonomics | Ergonomics reviewer | UI/UX expert |
| Marketing copy | Marketing manager | Project manager |

## Scope rules

- Do not inspect the whole repository unless the task explicitly requires it.
- Do not invent APIs, schemas or security guarantees.
- Do not modify authentication, payments or tenant isolation without targeted tests.
- Do not introduce microservices or infrastructure without measured justification.
