// Test helper for the Phase 1 Postgres repositories: builds a pg-mem
// in-memory Postgres with the REAL migration SQL applied, and exposes a
// node-postgres-shaped `db` ({ query, connect }) that the repos accept.
// Because every repo test boots the schema from db/migrations/*.sql (001 + 002
// in order, exactly like production), the migrations themselves are exercised
// on every test run (no live DB in the sandbox — see the report).
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DataType, newDb } from 'pg-mem'

const MIGRATIONS_DIR = path.join(
  fileURLToPath(new URL('../../../../db/migrations', import.meta.url)),
)

let cachedSql = null
async function migrationSql() {
  if (!cachedSql) {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    const chunks = await Promise.all(files.map((f) => readFile(path.join(MIGRATIONS_DIR, f), 'utf8')))
    cachedSql = chunks.join('\n')
  }
  return cachedSql
}

// Build a fresh in-memory database with the schema applied. Returns the
// node-postgres-shaped db plus the raw pg-mem instance (for schema queries).
export async function createMemDb() {
  const mem = newDb()
  // pg-mem implements very few native functions — register the handful the
  // production SQL uses that real Postgres has natively.
  mem.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s) => String(s ?? '').trim(),
  })
  mem.public.none(await migrationSql())
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  return {
    mem,
    query: (text, params) => pool.query(text, params),
    connect: () => pool.connect(),
  }
}
