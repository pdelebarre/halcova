# Scalability & Cloud Review Checklist

For each probe, ground the answer in the real code (`src/`, `netlify/functions/`)
and, where relevant, the Netlify topology. Record findings by severity; propose
incremental steps.

## 1. API contracts
- **Surface**: are the endpoints (`collection`, `auth`, `admin`, `discogs`)
  consistent in shape, error model (`{ error }`), and HTTP status codes?
- **Versioning**: does the SPA depend on exact response shapes in ways that
  would break if the contract evolves? Where would a v2 live?
- **Ownership**: is each contract owned by the client (`src/api/*`) or the
  function? Would a Spring Boot service be able to serve the same shapes?

## 2. Auth & tenant isolation
- Every function authorizes the request (Bearer code / admin key) before work.
- Per-user stores stay isolated; plan enforcement returns 403.
- Admin key is env-only (`RUNOUT_ADMIN_KEY`), no dev fallback in prod; the
  Discogs token is server-side only.
- Secrets never appear in logs, the client bundle, or commits.

## 3. Storage (Netlify Blobs)
- Key layout is intentional (`index` + `item:<id>`); index writes are
  read-modify-write — note any consistency risk under concurrent writes.
- Growth: how many items/users before list+fetch-per-item becomes slow? Where
  would pagination/querying live if this moves to a real datastore?
- Migration risk: renaming keys orphans collections — any rename needs a
  migration path.

## 4. Caching & rate limits
- Discogs proxy cache (Blobs): hit rate, eviction, TTL; is the rate limit
  still a risk as users grow?
- PWA runtime caching: correct strategies (NetworkFirst for APIs, CacheFirst
  for images); the collection API is never cached.
- The next bottleneck if users or traffic multiply.

## 5. Reliability
- No error boundary client-side → dark-screen failure mode; how are new data
  paths guarded?
- Optimistic updates roll back on failure and surface the error.
- What happens to a partially-written Blob write (index vs item) on failure?

## 6. Deployment & cloud topology
- Current: Netlify Functions + Blobs + static SPA. What are the scaling
  ceilings (function limits, Blob store, cold starts, regional latency)?
- Target options: keep serverless vs add a managed API service (e.g. Spring
  Boot on App Service/ACA/AKS), managed datastore, CDN/caching.
- A clear, incremental migration path with reversible steps and a "preserve"
  list (stores, auth model, PWA behavior).

## Verdict
One line: is the current architecture fine for the expected scale, and what is
the single highest-leverage change if it isn't?
