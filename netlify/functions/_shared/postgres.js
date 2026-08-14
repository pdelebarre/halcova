// Lazy Postgres connection module for the Phase 1 data layer (ADR-0002,
// epic #38). node-postgres (`pg`) is only ever loaded/connected when
// DATABASE_URL is configured — otherwise the app stays 100% on Netlify Blobs
// exactly as before.
//
// Safety contract: DB failures must NEVER break the Blobs fallback. The
// repositories wrap every call so a DB error degrades to Blobs (read-through)
// rather than surfacing as a 500. This module just hands out a lazily-created
// Pool; it never touches the network unless isPostgresConfigured() is true.
//
// Local dev default: `postgres://localhost:5432/runout` (no live DB in the
// sandbox — tests drive the same SQL through pg-mem's in-memory emulator).

import pg from 'pg'

const DEFAULT_URL = 'postgres://localhost:5432/runout'

// The switch for the whole repository interface: when a DATABASE_URL is set we
// serve reads DB-first (falling back to Blobs on miss/error); when it is
// absent everything behaves exactly as today (Blobs only).
export function isPostgresConfigured() {
  return !!process.env.DATABASE_URL
}

export function databaseUrl() {
  return process.env.DATABASE_URL || DEFAULT_URL
}

let pool = null

// Lazily create the shared Pool. Only reachable when isPostgresConfigured()
// is true (the repos guard every call). A failed connection surfaces as a
// rejected query, which the repos catch and turn into a Blobs fallback.
export function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl() })
    // node-postgres throws on idle-client errors unless a handler is attached;
    // these are non-fatal here (the read-through fallback absorbs them).
    pool.on('error', () => { /* pooled client errors are handled by the Blobs fallback */ })
  }
  return pool
}

// Run one parameterized statement against the pool. `params` uses $1..$n
// placeholders (node-postgres convention). Returns pg's `{ rows, rowCount }`.
export async function query(text, params) {
  return getPool().query(text, params)
}

// Grab a dedicated client (for transactions: BEGIN/COMMIT/ROLLBACK). Callers
// must release() it. Matches the shape the repositories' `transaction()`
// helpers expect (and pg-mem's adapter provides the same shape in tests).
export async function connect() {
  return getPool().connect()
}

export async function withClient(fn) {
  const client = await connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}

// The `db` interface handed to the repositories: `{ query, connect }`. Tests
// inject a pg-mem-backed equivalent with the same shape.
export const db = { query, connect }
