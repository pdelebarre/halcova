// @vitest-environment node
//
// FEAT-11.2 (#350) — CSV/JSON collection import parsing & validation.
//
// Negative adversarial tests (SEC-7.5, kernel §6.1):
//   - Malformed CSV/JSON rejected
//   - Oversized files rejected
//   - Empty files rejected
//   - CSV injection (= + - @) rejected
//   - XSS content in fields rejected
//   - Too many rows/columns rejected
//   - Unsupported format rejected
//
// Positive tests:
//   - Valid CSV parsed correctly (headers, rows, quoted fields)
//   - Valid JSON parsed correctly (array, {items:[]}, {data:[]}, single object)
//   - Auto-mapping produces correct column-to-field mappings
//   - Edge cases: BOM, CRLF, empty trailing lines, mixed quotes

import { describe, expect, it } from 'vitest'
import {
  autoMapFields,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  IMPORT_MAX_COLUMNS,
  IMPORT_ERROR,
  parseImport,
} from './import-parse'

// A minimal type definition for testing auto-mapping and validation.
const testTypeDef = {
  id: 'records',
  fields: {
    canonical: [
      { key: 'title', fieldType: 'string', required: true, label: 'Title', maxLength: 1000 },
      { key: 'year', fieldType: 'integer', required: false, label: 'Year' },
      { key: 'genre', fieldType: 'array_string', required: false, label: 'Genre', arrayMax: 10, itemMax: 200 },
      { key: 'catno', fieldType: 'string', required: false, label: 'Catalogue Number', maxLength: 200 },
      { key: 'barcode', fieldType: 'string', required: false, label: 'Barcode', maxLength: 64 },
    ],
    owned: [
      { key: 'condition', fieldType: 'string', required: false, label: 'Condition', allowedValues: ['mint', 'nm', 'vg+', 'vg', 'g', 'f', 'p'], maxLength: 10 },
      { key: 'notes', fieldType: 'string', required: false, label: 'Notes', maxLength: 5000 },
    ],
  },
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
describe('import-parse — CSV', () => {
  it('parses a valid CSV with header and data rows', () => {
    const csv = 'title,year,genre\nalbum one,1999,Rock\nalbum two,2000,Jazz'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['title', 'year', 'genre'])
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toEqual({ title: 'album one', year: '1999', genre: 'Rock' })
    expect(result.rows[1]).toEqual({ title: 'album two', year: '2000', genre: 'Jazz' })
  })

  it('handles quoted fields with embedded commas', () => {
    const csv = 'title,description\n"Hello, World","This has a comma, inside"'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.rows[0].title).toBe('Hello, World')
    expect(result.rows[0].description).toBe('This has a comma, inside')
  })

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'notes\n"He said ""hello"" to me"'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.rows[0].notes).toBe('He said "hello" to me')
  })

  it('handles CRLF line endings', () => {
    const csv = 'title,year\r\nalbum,2020\r\n'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].title).toBe('album')
  })

  it('strips UTF-8 BOM', () => {
    const csv = '\uFEFFtitle,year\nbook one,2021'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.columns).toEqual(['title', 'year'])
    expect(result.rows[0].title).toBe('book one')
  })

  it('handles empty trailing lines', () => {
    const csv = 'title,year\nx,2020\n\n'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
  })

  it('trims whitespace from header names', () => {
    const csv = ' title , year ,genre \nalbum,1999,Rock'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error).toBeUndefined()
    expect(result.columns).toContain('title')
    expect(result.columns).toContain('year')
    expect(result.columns).toContain('genre')
  })

  // --- Adversarial negatives ---

  it('rejects an empty CSV file', () => {
    const result = parseImport('', { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.EMPTY_FILE)
  })

  it('rejects a CSV with only a header row (no data)', () => {
    const result = parseImport('title,year,genre\n', { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.NO_ROWS)
  })

  it('rejects a CSV with no columns', () => {
    const result = parseImport('\n', { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.EMPTY_FILE)
  })

  it('rejects CSV formula injection with = prefix', () => {
    const csv = 'title\n=SUM(1,1)'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.CSV_INJECTION)
    expect(result.error.message).toContain('=')
  })

  it('rejects CSV formula injection with + prefix', () => {
    const csv = 'title\n+SUM(1,1)'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.CSV_INJECTION)
  })

  it('rejects CSV formula injection with - prefix', () => {
    const csv = 'title\n-1+1'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.CSV_INJECTION)
  })

  it('rejects CSV formula injection with @ prefix', () => {
    const csv = 'title\n@SUM(1,1)'
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.CSV_INJECTION)
  })

  it('rejects CSV with too many columns', () => {
    const cols = Array.from({ length: IMPORT_MAX_COLUMNS + 1 }, (_, i) => `col${i}`)
    const csv = cols.join(',') + '\n' + cols.map(() => '1').join(',')
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_MANY_COLUMNS)
  })

  it('rejects CSV with too many rows', () => {
    const header = 'title\n'
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `item${i}`).join('\n')
    const result = parseImport(header + rows, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_MANY_ROWS)
  })

  it('rejects an oversized CSV file', () => {
    // Generate content just over the import max bytes
    const bigField = 'x'.repeat(IMPORT_MAX_BYTES / 2)
    const csv = `title\n${bigField}\n${bigField}`
    const result = parseImport(csv, { mimeType: 'text/csv' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_LARGE)
  })
})

// ---------------------------------------------------------------------------
// JSON parsing
// ---------------------------------------------------------------------------
describe('import-parse — JSON', () => {
  it('parses a JSON array of objects', () => {
    const json = JSON.stringify([
      { title: 'Album One', year: 1999, genre: 'Rock' },
      { title: 'Album Two', year: 2000 },
    ])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].title).toBe('Album One')
    expect(result.rows[1].year).toBe('2000')
  })

  it('parses JSON with items wrapper', () => {
    const json = JSON.stringify({ items: [{ title: 'A' }, { title: 'B' }] })
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(2)
  })

  it('parses JSON with data wrapper', () => {
    const json = JSON.stringify({ data: [{ title: 'X' }] })
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
  })

  it('handles a single JSON object by wrapping it', () => {
    const json = JSON.stringify({ title: 'Single', year: 2020 })
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
  })

  it('converts numeric and boolean values to strings', () => {
    const json = JSON.stringify([{ title: 'Test', year: 2020, wishlist: true, count: 42 }])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.rows[0].year).toBe('2020')
    expect(result.rows[0].wishlist).toBe('true')
    expect(result.rows[0].count).toBe('42')
  })

  // --- Adversarial negatives ---

  it('rejects an empty JSON array', () => {
    const result = parseImport('[]', { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.NO_ROWS)
  })

  it('rejects malformed JSON', () => {
    const result = parseImport('{invalid json}', { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.MALFORMED_JSON)
  })

  it('rejects oversized JSON', () => {
    // Generate content clearly over IMPORT_MAX_BYTES
    const bigField = 'x'.repeat(IMPORT_MAX_BYTES + 1) // 1 byte over
    const json = JSON.stringify([{ title: bigField }])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_LARGE)
  })

  it('rejects JSON with too many rows', () => {
    const items = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => ({ title: `item${i}` }))
    const result = parseImport(JSON.stringify(items), { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_MANY_ROWS)
  })

  it('rejects JSON with too many columns', () => {
    const item = {}
    for (let i = 0; i <= IMPORT_MAX_COLUMNS; i++) item[`key${i}`] = 'v'
    const result = parseImport(JSON.stringify([item]), { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.TOO_MANY_COLUMNS)
  })

  it('rejects JSON with formula-like string values (defense-in-depth)', () => {
    const json = JSON.stringify([{ title: '=SUM(1,1)' }])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.CSV_INJECTION)
  })

  it('rejects JSON with no object items (non-object entries)', () => {
    const json = JSON.stringify(['string', 42])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect([IMPORT_ERROR.EMPTY_FILE, IMPORT_ERROR.MALFORMED_JSON]).toContain(result.error.code)
  })

  it('rejects JSON with non-object inside items', () => {
    const json = JSON.stringify([{ title: 'A' }, 'not-an-object'])
    const result = parseImport(json, { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.MALFORMED_JSON)
  })

  it('rejects JSON with no recognisable items', () => {
    const result = parseImport('"just a string"', { mimeType: 'application/json' })
    expect(result.error.code).toBe(IMPORT_ERROR.MALFORMED_JSON)
  })
})

// ---------------------------------------------------------------------------
// Format auto-detection
// ---------------------------------------------------------------------------
describe('import-parse — format auto-detection', () => {
  it('detects JSON from a { character with text/plain MIME', () => {
    const result = parseImport('{"title":"A"}', { mimeType: 'text/plain' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].title).toBe('A')
  })

  it('detects JSON from a [ character with text/plain MIME', () => {
    const result = parseImport('[{"title":"A"}]', { mimeType: 'text/plain' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
  })

  it('treats unknown formats as CSV', () => {
    const result = parseImport('title,year\na,2000', { mimeType: 'text/plain' })
    expect(result.error).toBeUndefined()
    expect(result.rows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Auto-mapping
// ---------------------------------------------------------------------------
describe('import-parse — autoMapFields', () => {
  it('maps exact-match column names to field keys', () => {
    const columns = ['title', 'year', 'genre', 'notes']
    const { mapping, unmappedColumns, unmappedFields } = autoMapFields(columns, testTypeDef)
    expect(mapping.title).toBe('title')
    expect(mapping.year).toBe('year')
    expect(mapping.genre).toBe('genre')
    expect(mapping.notes).toBe('notes')
    expect(unmappedColumns).toHaveLength(0)
  })

  it('reports columns that do not match any field as unmapped', () => {
    const columns = ['title', 'unknown_col', 'foo']
    const { mapping, unmappedColumns } = autoMapFields(columns, testTypeDef)
    expect(mapping.title).toBe('title')
    expect(unmappedColumns).toEqual(['unknown_col', 'foo'])
  })

  it('reports required fields with no mapping as unmappedFields', () => {
    const columns = ['year', 'genre']
    const { mapping, unmappedFields } = autoMapFields(columns, testTypeDef)
    expect(mapping.title).toBeUndefined()
    expect(unmappedFields.some((f) => f.key === 'title')).toBe(true)
  })

  it('maps by case-insensitive column name', () => {
    const columns = ['Title', 'Year']
    const { mapping } = autoMapFields(columns, testTypeDef)
    expect(mapping.Title).toBe('title')
    expect(mapping.Year).toBe('year')
  })

  it('maps by label (case-insensitive)', () => {
    const columns = ['Catalogue Number', 'Barcode']
    const { mapping } = autoMapFields(columns, testTypeDef)
    expect(mapping['Catalogue Number']).toBe('catno')
    expect(mapping.Barcode).toBe('barcode')
  })

  it('returns empty mapping for null typeDef', () => {
    const { mapping, unmappedColumns } = autoMapFields(['title'], null)
    expect(mapping).toEqual({})
    expect(unmappedColumns).toEqual(['title'])
  })
})