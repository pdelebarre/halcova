// repository.js — the single seam between the two persistence backends
// (ADR-0002 Phase 1). `getRepository()` returns the Blobs-backed impl when
// DATABASE_URL is absent (today's behavior, byte-for-byte) or the Postgres-
// backed impl when it is set (read DB first, fall back to Blobs on miss/error).
//
// The repository object is shaped as:
//   { backend: 'blobs'|'postgres', users, items?, lookupCache? }
// where `users` mirrors the identity functions from _shared/users.js, `items`
// is the Postgres items repository (null on the Blobs backend), and
// `lookupCache` is the Postgres lookup cache (null on Blobs).

import { isPostgresConfigured } from './postgres'
import { createBlobRepository } from './repositories/blob-repository'
import { createPostgresRepository } from './repositories/postgres-repository'

let cached = null

// Lazily build (and cache) the repository for the process. The backend is
// decided once per warm function instance, matching how DATABASE_URL is a
// deployment-time setting — never flipped at runtime.
export function getRepository() {
  if (!cached) cached = isPostgresConfigured() ? createPostgresRepository() : createBlobRepository()
  return cached
}

// Test hook: force the backend choice / reset the cache (only used by tests).
export function __resetRepositoryForTests() {
  cached = null
}
