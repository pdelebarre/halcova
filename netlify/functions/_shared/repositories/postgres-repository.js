// postgres-repository.js — the Postgres-backed repository (ADR-0002 Phase 1).
//
// Read-through fallback: every READ is served DB-first and falls back to the
// Blobs implementation on a miss (null / empty list) OR on any DB error, so a
// Postgres outage or a not-yet-backfilled store never breaks a request — the
// app behaves exactly like today.
//
// Reversible writes (dual-write): every WRITE goes to Postgres (the new system
// of record) AND is mirrored to the Blobs store best-effort, so the legacy
// Blob stores stay complete and the migration can be walked back at any time
// (nothing orphans; legacy stores are never renamed/deleted). If Postgres is
// unreachable a write degrades to Blobs so it never fails.
//
// See the report for the backfill-timing caveat: DB-first reads assume a store
// has been backfilled (Part B) before it serves live traffic.

import { db as postgresDb } from '../postgres'
import { createUsersRepo } from './users-repo'
import { createItemsRepo } from './items-repo'
import { createLookupCacheRepo } from './lookup-cache-repo'
import * as blobUsers from './blob-users'

// Wrap a read so a Postgres miss or error falls back to the Blobs impl.
function readThrough(fn, fallback) {
  return async (...args) => {
    try {
      const result = await fn(...args)
      // A null (not found) or empty list (nothing backfilled yet) is a "miss".
      if (result == null || (Array.isArray(result) && result.length === 0)) {
        return fallback(...args)
      }
      return result
    } catch {
      // DB unreachable/errored — degrade to Blobs, never fail the request.
      return fallback(...args)
    }
  }
}

// Wrap a write: Postgres first, mirrored to Blobs best-effort; on a Postgres
// failure, fall back to a Blobs-only write so the operation still succeeds.
function writeThrough(postgresFn, blobFn) {
  return async (...args) => {
    try {
      const result = await postgresFn(...args)
      try { await blobFn(...args) } catch { /* mirror is best-effort */ }
      return result
    } catch {
      return blobFn(...args)
    }
  }
}

export function createPostgresRepository({ db = postgresDb } = {}) {
  const usersPg = createUsersRepo(db)
  const items = createItemsRepo(db)
  const lookupCache = createLookupCacheRepo(db)

  const users = {
    // Reads — DB first, Blobs fallback on miss/error.
    findUserByCode: readThrough(usersPg.findUserByCode, blobUsers.findUserByCode),
    getUser: readThrough(usersPg.getUser, blobUsers.getUser),
    listUsers: readThrough(usersPg.listUsers, blobUsers.listUsers),
    listRequests: readThrough(usersPg.listRequests, blobUsers.listRequests),
    getRequest: readThrough(usersPg.getRequest, blobUsers.getRequest),
    findPendingRequestByEmail: readThrough(usersPg.findPendingRequestByEmail, blobUsers.findPendingRequestByEmail),
    // Writes — Postgres primary + Blobs mirror (reversible).
    saveUser: writeThrough(usersPg.saveUser, blobUsers.saveUser),
    saveRequest: writeThrough(usersPg.saveRequest, blobUsers.saveRequest),
    removeUserRecord: writeThrough(usersPg.removeUserRecord, blobUsers.removeUserRecord),
    removeRequest: writeThrough(usersPg.removeRequest, blobUsers.removeRequest),
  }

  return {
    backend: 'postgres',
    users,
    items,
    lookupCache,
  }
}
