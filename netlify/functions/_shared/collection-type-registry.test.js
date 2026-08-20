// @vitest-environment node
//
// FEAT-6.2 #315 — Collection Type Registry & Capabilities (ADR-0020 §2/§6).
//
// Proves the SERVER-AUTHORITATIVE registry:
//   * Books and Records are registered through the SAME mechanism (the
//     collection_types / collection_type_fields tables seeded by migration 011,
//     read via createCollectionTypeRepository).
//   * Type definitions carry validated fields (with labels), icons,
//     capabilities and provider mappings.
//   * Unknown types/fields are rejected server-side with STABLE errors
//     (UNKNOWN_TYPE, UNKNOWN_FIELD); missing required fields -> REQUIRED.
//   * Capabilities are READ-ONLY (client can query but never supply/override).
//   * Public metadata is allowlisted + XSS-safe to render.

import { beforeEach, describe, expect, it } from 'vitest'
import { createMemDb } from './repositories/test-helpers'
import {
  buildTypeDefinition,
  createCollectionTypeRepository,
  hasCapability,
  listCapabilities,
  REGISTRY_ERROR,
  toPublicTypeView,
  validateCollectionAttributes,
} from './collection-type-registry'

let db
let repo

beforeEach(async () => {
  db = await createMemDb()
  repo = createCollectionTypeRepository({ db })
})

describe('registry — records and books registered through the same mechanism (migration 011)', () => {
  it('seeds both records and books via the shared registry tables', async () => {
    const types = await repo.list()
    expect(types.map((t) => t.id).sort()).toEqual(['books', 'records'])
    for (const t of types) {
      // Every type carries the full definition surface (ADR-0020 §2).
      expect(t.displayName).toBeTruthy()
      expect(typeof t.icon).toBe('string')
      expect(Array.isArray(t.capabilities)).toBe(true)
      expect(Array.isArray(t.providerMappings)).toBe(true)
      expect(Array.isArray(t.fields.canonical)).toBe(true)
      expect(Array.isArray(t.fields.owned)).toBe(true)
      expect(t.fields.canonical.length).toBeGreaterThan(0)
      expect(t.fields.owned.length).toBeGreaterThan(0)
    }
  })

  it('records carry record-specific fields, capabilities and provider mappings', async () => {
    const records = await repo.getById('records')
    expect(records.displayName).toBe('Records')
    expect(records.icon).toBe('disc')
    expect(hasCapability(records, 'lookup.discogs')).toBe(true)
    expect(hasCapability(records, 'lookup.musicbrainz')).toBe(true)
    expect(hasCapability(records, 'ocr_cover')).toBe(true)
    expect(records.providerMappings).toEqual([
      { provider: 'discogs', role: 'primary' },
      { provider: 'musicbrainz', role: 'fallback' },
    ])
    // A record-only canonical field.
    const canonicalKeys = records.fields.canonical.map((f) => f.key)
    expect(canonicalKeys).toContain('catno')
    expect(canonicalKeys).toContain('mbid')
    // owned attributes include condition with an enum.
    const condition = records.fields.owned.find((f) => f.key === 'condition')
    expect(condition).toBeTruthy()
    expect(condition.allowedValues).toEqual(['mint', 'nm', 'vg+', 'vg', 'g', 'f', 'p'])
  })

  it('books carry book-specific fields, capabilities and provider mappings', async () => {
    const books = await repo.getById('books')
    expect(books.displayName).toBe('Books')
    expect(hasCapability(books, 'lookup.googleBooks')).toBe(true)
    expect(hasCapability(books, 'lookup.openlibrary')).toBe(true)
    expect(books.providerMappings).toEqual([
      { provider: 'googleBooks', role: 'primary' },
      { provider: 'openlibrary', role: 'fallback' },
    ])
    const canonicalKeys = books.fields.canonical.map((f) => f.key)
    expect(canonicalKeys).toContain('isbn')
    expect(canonicalKeys).toContain('pageCount')
    expect(books.fields.canonical.find((f) => f.key === 'title').required).toBe(true)
  })

  it('unknown type resolves to null (callers map to UNKNOWN_TYPE)', async () => {
    expect(await repo.getById('nope')).toBeNull()
    expect(await repo.getById('games')).toBeNull()
  })

  it('definitions are frozen (read-only — client cannot mutate a served def)', async () => {
    const records = await repo.getById('records')
    expect(Object.isFrozen(records)).toBe(true)
    expect(Object.isFrozen(records.capabilities)).toBe(true)
    expect(() => {
      records.capabilities.push('x')
    }).toThrow()
  })
})

describe('registry — server-authoritative (client cannot supply a type/capability/field definition)', () => {
  it('has no write/upsert path in the repository', async () => {
    expect(Object.keys(repo)).toEqual(['getById', 'list'])
    expect(typeof repo.getById).toBe('function')
    expect(typeof repo.list).toBe('function')
    expect(repo.insert).toBeUndefined()
    expect(repo.update).toBeUndefined()
  })

  it('validateCollectionAttributes rejects an unknown type with UNKNOWN_TYPE', () => {
    const r = validateCollectionAttributes(null, { title: 'x' }, 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.UNKNOWN_TYPE)
  })

  it('capability helpers are read-only views', async () => {
    const records = await repo.getById('records')
    expect(listCapabilities(records)).toEqual(records.capabilities)
    expect(hasCapability(records, 'lookup.discogs')).toBe(true)
    expect(hasCapability(records, 'doesNotExist')).toBe(false)
    expect(hasCapability(null, 'lookup.discogs')).toBe(false)
    expect(listCapabilities(null)).toEqual([])
  })
})

describe('registry — attribute validation (valid / invalid / missing / unknown / XSS / enum)', () => {
  let records
  beforeEach(async () => {
    records = await repo.getById('records')
  })

  it('accepts a valid canonical attribute set', () => {
    const r = validateCollectionAttributes(records, { title: 'The Album', year: 1987, genre: ['Rock', 'Jazz'] }, 'canonical')
    expect(r.error).toBeUndefined()
    expect(r.value.title).toBe('The Album')
    expect(r.value.year).toBe(1987)
    expect(r.value.genre).toEqual(['Rock', 'Jazz'])
  })

  it('rejects a missing required field with REQUIRED', () => {
    const r = validateCollectionAttributes(records, { year: 1987 }, 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.REQUIRED)
    expect(r.error.message).toContain('title')
  })

  it('rejects an unknown field with UNKNOWN_FIELD (stable)', () => {
    const r = validateCollectionAttributes(records, { title: 'A', hackerField: 'x' }, 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.UNKNOWN_FIELD)
    expect(r.error.message).toContain('hackerField')
  })

  it('rejects a wrong-type value with TYPE_ERROR', () => {
    const r = validateCollectionAttributes(records, { title: 'A', year: 'not-a-number' }, 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.TYPE_ERROR)
  })

  it('rejects a string over the field max_length with TOO_LONG', () => {
    const r = validateCollectionAttributes(records, { title: 'x'.repeat(501) }, 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.TOO_LONG)
  })

  it('rejects an attribute outside an allowed_values enum with INVALID_VALUE', () => {
    const r = validateCollectionAttributes(records, { condition: 'minty-fresh' }, 'owned')
    expect(r.error.code).toBe(REGISTRY_ERROR.INVALID_VALUE)
  })

  it('accepts a value inside the allowed_values enum', () => {
    const r = validateCollectionAttributes(records, { condition: 'vg+' }, 'owned')
    expect(r.error).toBeUndefined()
    expect(r.value.condition).toBe('vg+')
  })

  it('rejects dangerous/XSS content in a text attribute with HTML_REJECTED (SEC-7.5 #409)', () => {
    const r = validateCollectionAttributes(records, { notes: '<img src=x onerror=alert(1)>' }, 'owned')
    expect(r.error.code).toBe(REGISTRY_ERROR.HTML_REJECTED)
  })

  it('rejects a non-object attributes payload with TYPE_ERROR', () => {
    const r = validateCollectionAttributes(records, 'title', 'canonical')
    expect(r.error.code).toBe(REGISTRY_ERROR.TYPE_ERROR)
  })

  it('validates the owned namespace independently of canonical', async () => {
    // condition/notes are owned; title is canonical.
    const owned = validateCollectionAttributes(records, { condition: 'nm', notes: 'mint' }, 'owned')
    expect(owned.error).toBeUndefined()
    expect(owned.value.condition).toBe('nm')
  })
})

describe('registry — public metadata is allowlisted + XSS-safe (toPublicTypeView)', () => {
  it('strips dangerous content from rendered labels/descriptions', async () => {
    const type = await repo.getById('books')
    // Corrupt the definition to simulate a hostile registry value that somehow
    // carried an XSS payload (defense-in-depth; the seed is trusted, never assume).
    const hostileDef = buildTypeDefinition({
      id: 'books',
      display_name: '<script>alert(1)</script>Bad',
      icon: type.icon,
      description: '<img src=x onerror=alert(2)>',
      schema_version: type.schemaVersion,
      is_public: type.isPublic,
      capabilities: [...type.capabilities],
      provider_mappings: [...type.providerMappings],
    })
    const view = toPublicTypeView(hostileDef)
    expect(view.displayName).toBe('')
    expect(view.description).toBe('')
  })

  it('exposes only the allowlisted public projection (no raw internals)', async () => {
    const books = await repo.getById('books')
    const view = toPublicTypeView(books)
    expect(view).toMatchObject({
      id: 'books',
      displayName: 'Books',
      icon: 'book',
    })
    expect(Array.isArray(view.capabilities)).toBe(true)
    expect(Array.isArray(view.providerMappings)).toBe(true)
    expect(view.fields.canonical.length).toBeGreaterThan(0)
    // The projection never leaks non-public fields (e.g. no created_at/updated_at).
    expect(view.created_at).toBeUndefined()
    expect(view.updated_at).toBeUndefined()
  })

  it('returns null for an unknown type view', () => {
    expect(toPublicTypeView(null)).toBeNull()
  })
})
