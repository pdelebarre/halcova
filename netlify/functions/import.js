// import.js — CSV/JSON collection import & validation (FEAT-11.2 #350).
//
// Two-phase flow:
//   Phase 1 (preview):  POST /import?collection=X&type=Y
//                        Body: { content: "<raw file text>", mimeType: "text/csv" }
//                        Returns: preview with columns, auto-mapping (if type known),
//                        row validation results, error counts, duplicate candidates.
//   Phase 2 (confirm):  POST /import?collection=X&type=Y&confirm=1
//                        Body: { content: "...", mimeType: "...",
//                                mapping: { fileCol: fieldKey } }
//                        Returns: { imported: N } after batch insert.
//
// Generic mode: when the type registry is unavailable (Blobs-only, no Postgres),
// the function falls back to basic item validation (validateItem + pickItemFields).
// Full schema validation through the type registry requires Postgres to be
// configured and the registry to be seeded (FEAT-6.2, ADR-0020).
//
// Security (ADR-0020 §2/§6):
//   - Session-authenticated via enforce() — user identity is server-resolved.
//   - File content size-limited (5 MB), format-validated, CSV-injection-guarded,
//     and XSS-checked through import-parse.js before any schema validation.
//   - When available, each field is re-validated through the type registry's
//     field schema (validateCollectionAttributes) which includes XSS and type guards.
//   - All imported items are owner-scoped to the authenticated session user.
//   - Plan limit enforced: imported owned items count toward the free-tier cap.
//   - Postgres path uses itemsRepo.transaction for atomic rollback on failure.
//   - Blobs path uses sequential writes (no rollback in Blobs; all IDs are
//     server-assigned UUIDs so partial imports have idempotent retry).

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { enforce } from './_shared/policy'
import { json, readJsonBody, safeError } from './_shared/security'
import { isPostgresConfigured } from './_shared/postgres'
import { getRepository } from './_shared/repository'
import { storeNameFor } from './_shared/users'
import { planLimitFor } from './_shared/plans'
import { readIndex, writeIndex } from './_shared/collection-store'
import { ensureOwnedCount, adjustOwnedCount } from './_shared/counts'
import { invalidateListCache } from './_shared/list-cache'
import { pickItemFields, validateItem } from './_shared/item-fields'
import { createCollectionTypeRepository } from './_shared/collection-type-registry'
import { validateCollectionAttributes, REGISTRY_ERROR } from './_shared/collection-type-registry'
import { parseImport, autoMapFields, IMPORT_ERROR } from './_shared/import-parse'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const IMPORT_API_ERROR = {
  UNKNOWN_COLLECTION: 'UNKNOWN_COLLECTION',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  MISSING_CONTENT: 'MISSING_CONTENT',
  NO_MAPPING: 'NO_MAPPING',
  MAPPING_COLUMN_NOT_FOUND: 'MAPPING_COLUMN_NOT_FOUND',
  MAPPING_FIELD_UNKNOWN: 'MAPPING_FIELD_UNKNOWN',
  ROW_VALIDATION_ERRORS: 'ROW_VALIDATION_ERRORS',
  IMPORT_FAILED: 'IMPORT_FAILED',
  PLAN_LIMIT: 'PLAN_LIMIT',
}

const IMPORTABLE_COLLECTIONS = new Set(['records', 'books', 'games', 'guitars', 'cards', 'coins'])

// ---------------------------------------------------------------------------
// Type-definition loader (lazy, returns null when registry is unavailable)
// ---------------------------------------------------------------------------
let _typeRepoCache = null

async function getTypeDef(typeSlug) {
  if (!isPostgresConfigured()) return null
  if (!_typeRepoCache) {
    // When Postgres is configured, create a registry reader.
    try {
      const { createPool } = await import('./_shared/postgres')
      _typeRepoCache = createCollectionTypeRepository({ db: createPool() })
    } catch {
      return null
    }
  }
  try {
    return await _typeRepoCache.getById(typeSlug)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------
function validateRow(row, typeDef, mapping) {
  if (!typeDef) {
    // Generic mode: use the basic item validator on the mapped values.
    // CSV/JSON values are strings; coerce numeric-looking values to numbers
    // so validateItem's intInRange, boolean etc. accept them.
    const partial = {}
    for (const [fileCol, fieldKey] of Object.entries(mapping)) {
      let v = row[fileCol]
      // String-to-number/boolean coercion for CSV values
      if (typeof v === 'string' && v.trim() !== '') {
        const trimmed = v.trim()
        const lower = trimmed.toLowerCase()
        // Boolean strings
        if (lower === 'true' || lower === '1' || lower === 'yes') {
          v = true
        } else if (lower === 'false' || lower === '0' || lower === 'no') {
          v = false
        } else {
          // Numeric strings
          const num = Number(trimmed)
          if (Number.isFinite(num)) {
            v = num
          }
        }
      }
      partial[fieldKey] = v
    }
    const v = validateItem(partial, { partial: false })
    if (v.error) return { error: v.error, row }
    return { value: v.item }
  }

  // Full type-schema validation
  const attributes = {}
  for (const [fileCol, fieldKey] of Object.entries(mapping)) {
    const rawValue = row[fileCol]
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      attributes[fieldKey] = undefined
      continue
    }
    const fieldDef = findFieldDef(typeDef, fieldKey)
    if (fieldDef && fieldDef.fieldType === 'integer') {
      const num = Number(rawValue)
      attributes[fieldKey] = Number.isFinite(num) ? Math.trunc(num) : rawValue
    } else if (fieldDef && fieldDef.fieldType === 'boolean') {
      const lower = String(rawValue).toLowerCase().trim()
      if (lower === 'true' || lower === '1' || lower === 'yes') {
        attributes[fieldKey] = true
      } else if (lower === 'false' || lower === '0' || lower === 'no') {
        attributes[fieldKey] = false
      } else {
        attributes[fieldKey] = rawValue
      }
    } else {
      attributes[fieldKey] = rawValue
    }
  }

  const canonical = validateCollectionAttributes(typeDef, attributes, 'canonical')
  if (canonical.error) return { error: canonical.error, row }
  const owned = validateCollectionAttributes(typeDef, attributes, 'owned')
  if (owned.error) return { error: owned.error, row }
  return { value: { ...(canonical.value || {}), ...(owned.value || {}) } }
}

function findFieldDef(typeDef, key) {
  const fields = [
    ...(typeDef.fields.canonical || []),
    ...(typeDef.fields.owned || []),
  ]
  return fields.find((f) => f.key === key) || null
}

// ---------------------------------------------------------------------------
// Duplicate detection (title-based, case-insensitive)
// ---------------------------------------------------------------------------
async function detectDuplicates(user, collection, rows, mapping) {
  const titleCol = Object.entries(mapping || {}).find(([, v]) => v === 'title')?.[0]
  if (!titleCol) return []

  const importedTitles = new Set()
  for (const row of rows) {
    const t = row[titleCol]
    if (t && typeof t === 'string' && t.trim()) {
      importedTitles.add(t.toLowerCase().trim())
    }
  }
  if (importedTitles.size === 0) return []

  const repo = getRepository()
  let existingItems = []
  if (repo && repo.items) {
    try { existingItems = await repo.items.listItems(user.id, collection, { limit: 10000 }) } catch { /* best-effort */ }
  } else {
    try {
      const store = getStore(storeNameFor(user.id, collection))
      const ids = await readIndex(store)
      existingItems = (await Promise.all(ids.map((id) => store.get(`item:${id}`, { type: 'json' })))).filter(Boolean)
    } catch { /* best-effort */ }
  }

  return existingItems
    .filter((item) => item.title && importedTitles.has(item.title.toLowerCase().trim()))
    .map((item) => ({ id: item.id, title: item.title }))
}

// ---------------------------------------------------------------------------
// Validate mapping keys against file columns
// ---------------------------------------------------------------------------
function validateMapping(mapping, columns) {
  for (const fileCol of Object.keys(mapping)) {
    if (!columns.includes(fileCol)) {
      return { error: `Column "${fileCol}" not found. Available: ${columns.join(', ')}`, code: IMPORT_API_ERROR.MAPPING_COLUMN_NOT_FOUND }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Persist items (Postgres transactional or Blobs sequential)
// ---------------------------------------------------------------------------
async function persistItems(user, collection, items) {
  const repo = getRepository()
  if (repo && repo.items) {
    // Postgres — transactional
    try {
      await repo.items.transaction(async (tx) => {
        for (const item of items) {
          await tx.insertItem(user.id, collection, item)
        }
      })
    } catch {
      return json(500, { error: 'Database error during import. No items imported.', code: IMPORT_API_ERROR.IMPORT_FAILED })
    }
    // Best-effort mirror to Blobs
    try {
      const store = getStore(storeNameFor(user.id, collection))
      for (const item of items) {
        await store.setJSON(`item:${item.id}`, item)
        const ids = await readIndex(store)
        if (!ids.includes(item.id)) {
          ids.unshift(item.id)
          await writeIndex(store, ids)
        }
        if (!item.wishlist) await adjustOwnedCount(store, +1)
        await invalidateListCache(store)
      }
    } catch { /* best-effort */ }
  } else {
    // Blobs-only — sequential writes
    const store = getStore(storeNameFor(user.id, collection))
    try {
      for (const item of items) {
        await store.setJSON(`item:${item.id}`, item)
        const ids = await readIndex(store)
        ids.unshift(item.id)
        await writeIndex(store, ids)
        if (!item.wishlist) await adjustOwnedCount(store, +1)
        await invalidateListCache(store)
      }
    } catch {
      return json(500, { error: 'Storage error during import. Some items may not have been imported.', code: IMPORT_API_ERROR.IMPORT_FAILED })
    }
  }
  return null // success
}

// ---------------------------------------------------------------------------
// Phase 1 — Preview
// ---------------------------------------------------------------------------
async function handlePreview(req, { user, collection, collectionType }) {
  const body = await readJsonBody(req)
  if (body.error) return body.error
  const { content, mimeType } = body.value || {}

  if (!content || typeof content !== 'string') {
    return json(400, { error: 'Missing file content.', code: IMPORT_API_ERROR.MISSING_CONTENT })
  }

  const parsed = parseImport(content, { mimeType: mimeType || 'text/csv' })
  if (parsed.error) return json(400, { error: parsed.error.message, code: parsed.error.code })

  const { columns, rows } = parsed

  // Auto-map when type is known
  const typeDef = collectionType ? await getTypeDef(collectionType) : null
  let mapping = {}
  let unmappedColumns = [...columns]
  let unmappedFields = []
  if (typeDef) {
    const auto = autoMapFields(columns, typeDef)
    mapping = auto.mapping
    unmappedColumns = auto.unmappedColumns
    unmappedFields = auto.unmappedFields
  } else {
    // Generic mode: auto-map by exact column names (skip per-field schema check)
    // but still report known item-field matches
    const knownFields = [
      'title', 'year', 'label', 'genre', 'style', 'country', 'formatType',
      'coverImage', 'barcode', 'discogsId', 'googleBooksId', 'dateAdded',
      'notes', 'wishlist', 'pageCount', 'description', 'catno', 'formatRaw', 'isbn',
      'artists', 'masterId', 'tracklist', 'released', 'mbid',
      'authorsList', 'subtitle', 'series', 'mainCategory', 'snippet', 'openLibraryId',
    ]
    for (const col of columns) {
      const colLower = col.toLowerCase().trim()
      const match = knownFields.find((kf) => kf.toLowerCase() === colLower)
      if (match) mapping[col] = match
      else unmappedColumns = unmappedColumns.filter((c) => c !== col)
    }
    unmappedColumns = columns.filter((c) => !mapping[c])
  }

  // Validate each row
  const rowResults = []
  let validCount = 0
  let errorCount = 0

  for (const row of rows) {
    const result = validateRow(row, typeDef, mapping)
    rowResults.push(result)
    if (result.error) errorCount++
    else validCount++
  }

  const duplicates = await detectDuplicates(user, collection, rows, mapping)

  return json(200, {
    phase: 'preview',
    columns,
    totalRows: rows.length,
    validCount,
    errorCount,
    mapping,
    isGeneric: !typeDef,
    unmappedColumns,
    unmappedFields,
    duplicates,
    duplicateCount: duplicates.length,
    sampleRows: rows.slice(0, 5),
    rowErrors: rowResults.filter((r) => r.error).slice(0, 20).map((r) => ({
      row: rowResults.indexOf(r) + 1,
      error: r.error.message,
      code: r.error.code,
    })),
  })
}

// ---------------------------------------------------------------------------
// Phase 2 — Confirm & Import
// ---------------------------------------------------------------------------
async function handleImport(req, { user, collection, collectionType }) {
  const body = await readJsonBody(req)
  if (body.error) return body.error
  const { content, mimeType, mapping } = body.value || {}

  if (!content || typeof content !== 'string') {
    return json(400, { error: 'Missing file content.', code: IMPORT_API_ERROR.MISSING_CONTENT })
  }
  if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).length === 0) {
    return json(400, { error: 'Field mapping is required.', code: IMPORT_API_ERROR.NO_MAPPING })
  }

  const parsed = parseImport(content, { mimeType: mimeType || 'text/csv' })
  if (parsed.error) return json(400, { error: parsed.error.message, code: parsed.error.code })
  const { columns, rows } = parsed

  // Validate mapping keys exist in file columns
  const mappingErr = validateMapping(mapping, columns)
  if (mappingErr) return json(400, { error: mappingErr.error, code: mappingErr.code })

  // Load type definition (null = generic mode)
  const typeDef = collectionType ? await getTypeDef(collectionType) : null
  if (collectionType && !typeDef && isPostgresConfigured()) {
    // Type is explicitly requested but registry is available and type not found
    return json(400, { error: `Unknown collection type: "${collectionType}".`, code: IMPORT_API_ERROR.UNKNOWN_TYPE })
  }

  // Validate rows in memory (all-or-nothing — fail fast)
  const validItems = []
  const rowErrors = []

  for (let i = 0; i < rows.length; i++) {
    const result = validateRow(rows[i], typeDef, mapping)
    if (result.error) {
      rowErrors.push({ row: i + 1, error: result.error.message, code: result.error.code })
    } else if (!result.value.title || !String(result.value.title).trim()) {
      rowErrors.push({ row: i + 1, error: 'Title is required.', code: 'REQUIRED' })
    } else {
      validItems.push(result.value)
    }
  }

  if (rowErrors.length > 0) {
    return json(400, {
      error: `${rowErrors.length} row(s) failed validation. No items imported.`,
      code: IMPORT_API_ERROR.ROW_VALIDATION_ERRORS,
      rowErrors: rowErrors.slice(0, 50),
    })
  }

  // Plan limit check
  const ownedInImport = validItems.filter((i) => !i.wishlist).length
  const limit = planLimitFor(user)
  if (limit != null && ownedInImport > 0) {
    let currentOwned = 0
    const repo = getRepository()
    if (repo && repo.items) {
      try { currentOwned = await repo.items.countOwned(user.id, collection) } catch { /* 0 */ }
    } else {
      try {
        const store = getStore(storeNameFor(user.id, collection))
        currentOwned = await ensureOwnedCount(store, readIndex)
      } catch { /* 0 */ }
    }
    if (currentOwned + ownedInImport > limit) {
      return json(403, {
        error: `Import exceeds your limit of ${limit} owned items (current: ${currentOwned}).`,
        code: IMPORT_API_ERROR.PLAN_LIMIT,
      })
    }
  }

  // Allocate server-assigned UUIDs
  const items = validItems.map((data) => {
    const picked = pickItemFields(data)
    return { ...picked, id: randomUUID(), dateAdded: new Date().toISOString() }
  })

  // Persist
  const persistErr = await persistItems(user, collection, items)
  if (persistErr) return persistErr

  return json(201, {
    phase: 'complete',
    imported: items.length,
    collection,
    collectionType,
  })
}

// ---------------------------------------------------------------------------
// SEC-7.1 action mapping
// ---------------------------------------------------------------------------
function actionFor() {
  return 'collection:item:create'
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export default async (req) => {
  try {
    const url = new URL(req.url)
    const collection = url.searchParams.get('collection') || 'records'
    const collectionType = url.searchParams.get('type') || collection
    const confirm = url.searchParams.has('confirm')

    if (!IMPORTABLE_COLLECTIONS.has(collection)) {
      return json(400, { error: `Unknown collection: "${collection}".`, code: IMPORT_API_ERROR.UNKNOWN_COLLECTION })
    }

    const { user, error } = await enforce(req, actionFor(req.method), {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo is read-only. Sign in to import your own items.',
    })
    if (error) return error

    if (!user.collections?.[collection]) {
      return json(403, { error: `Your plan does not include "${collection}".` })
    }

    return confirm
      ? handleImport(req, { user, collection, collectionType })
      : handlePreview(req, { user, collection, collectionType })
  } catch (err) {
    return safeError(err, req)
  }
}