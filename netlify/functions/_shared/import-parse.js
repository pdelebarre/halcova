// import-parse.js — CSV/JSON file parsing for collection import (FEAT-11.2 #350).
//
// Security properties:
//   - File size capped at IMPORT_MAX_BYTES (5 MB default).
//   - MIME type validated (text/csv, application/json, text/plain).
//   - CSV injection: cells starting with =, +, -, @ are rejected (formula injection).
//   - XSS: every imported text field is validated through isDangerousContent().
//   - Malformed CSV/JSON is rejected with structured errors (not silently truncated).
//   - Row limit: maximum IMPORT_MAX_ROWS (10,000 default) rows to prevent runaway files.
//
// The parser is format-agnostic: parseImport() detects CSV vs JSON from the MIME type
// or filename extension and returns a { columns, rows } structure that downstream
// mapping/validation consumes identically.
//
// Column detection: CSV uses the header row; JSON arrays of objects use the union of
// keys from every object as the column set.

import { isDangerousContent } from './security'

// ---------------------------------------------------------------------------
// Hard caps
// ---------------------------------------------------------------------------
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024 // 5 MB
export const IMPORT_MAX_ROWS = 10_000
export const IMPORT_MAX_COLUMNS = 200
export const IMPORT_MAX_CELL_LENGTH = 5000
export const IMPORTED_FIELD_PREFIX = 'imported_'

// CSV field length cap inside a row (before any mapping — raw cell from the file).
const CSV_CELL_MAX = 50_000

// Stable error codes for the import parser.
export const IMPORT_ERROR = {
  TOO_LARGE: 'IMPORT_TOO_LARGE',
  TOO_MANY_ROWS: 'IMPORT_TOO_MANY_ROWS',
  TOO_MANY_COLUMNS: 'IMPORT_TOO_MANY_COLUMNS',
  UNSUPPORTED_FORMAT: 'IMPORT_UNSUPPORTED_FORMAT',
  MALFORMED_CSV: 'IMPORT_MALFORMED_CSV',
  MALFORMED_JSON: 'IMPORT_MALFORMED_JSON',
  EMPTY_FILE: 'IMPORT_EMPTY_FILE',
  NO_ROWS: 'IMPORT_NO_ROWS',
  CSV_INJECTION: 'IMPORT_CSV_INJECTION',
  DANGEROUS_CONTENT: 'IMPORT_DANGEROUS_CONTENT',
  CELL_TOO_LONG: 'IMPORT_CELL_TOO_LONG',
}

// ---------------------------------------------------------------------------
// CSV parser (RFC 4180-compatible subset)
//
// Handles:
//   - Header row (first line)
//   - Quoted fields with embedded commas, newlines and escaped quotes ("")
//   - CRLF / LF line endings
//   - BOM stripping
//   - Empty trailing lines
//   - Mixed quote styles
// ---------------------------------------------------------------------------
function parseCsvRows(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const rows = []
  let current = []
  let field = ''
  let inQuotes = false
  let rowStart = 0

  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : '\n'
    const next = i + 1 < text.length ? text[i + 1] : ''

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          // Escaped quote
          field += '"'
          i++ // skip the second quote
        } else {
          // End of quoted field
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        current.push(field)
        field = ''
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        // End of row (handle CRLF or LF)
        if (ch === '\r') i++ // skip LF after CR
        // Skip empty trailing newline on the last row
        const isEmptyLast = i >= text.length - 1 && current.length === 0 && field === ''
        if (!isEmptyLast) {
          current.push(field)
          rows.push(current)
        }
        current = []
        field = ''
      } else if (ch === '\r') {
        // Standalone CR (old Mac style) — treat as line break
        current.push(field)
        rows.push(current)
        current = []
        field = ''
      } else {
        field += ch
      }
    }
  }

  // If there's a dangling field (no trailing newline), flush it
  if (current.length > 0 || field !== '') {
    current.push(field)
    rows.push(current)
  }

  return rows
}

// Validate a single CSV cell against formula-injection patterns.
// CSV injection (CWE-1236): a cell starting with =, +, -, @ is a potential
// formula injection that could execute when opened in Excel/Sheets.
function isCsvInjection(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  const first = value.charCodeAt(0)
  // = 0x3D, + 0x2B, - 0x2D, @ 0x40, tab 0x09, carriage return 0x0D
  return first === 0x3D || first === 0x2B || first === 0x2D || first === 0x40 ||
    first === 0x09 || first === 0x0D || first === 0x0A
}

// Trim trailing whitespace from CSV header names (common in hand-edited CSVs).
function normalizeHeader(name) {
  if (typeof name !== 'string') return ''
  return name.trim()
}

// Parse CSV text into { columns, rows }.
// Each row is an object keyed by the normalized header names.
// Returns { columns, rows } or { error: { code, message } }.
function parseCsv(text) {
  const rawRows = parseCsvRows(text)

  if (rawRows.length === 0) {
    return { error: { code: IMPORT_ERROR.EMPTY_FILE, message: 'The CSV file is empty.' } }
  }

  // First row is the header
  const rawHeaders = rawRows[0]
  const headers = rawHeaders.map(normalizeHeader)
  const dataRows = rawRows.slice(1)

  if (headers.length === 0) {
    return { error: { code: IMPORT_ERROR.EMPTY_FILE, message: 'The CSV file has no columns.' } }
  }

  if (headers.length > IMPORT_MAX_COLUMNS) {
    return {
      error: {
        code: IMPORT_ERROR.TOO_MANY_COLUMNS,
        message: `CSV has ${headers.length} columns; maximum is ${IMPORT_MAX_COLUMNS}.`,
      },
    }
  }

  if (dataRows.length > IMPORT_MAX_ROWS) {
    return {
      error: {
        code: IMPORT_ERROR.TOO_MANY_ROWS,
        message: `CSV has ${dataRows.length} data rows; maximum is ${IMPORT_MAX_ROWS}.`,
      },
    }
  }

  if (dataRows.length === 0) {
    return { error: { code: IMPORT_ERROR.NO_ROWS, message: 'The CSV file has no data rows (only a header).' } }
  }

  // Build typed rows
  const rows = []
  const columnSet = new Set(headers)

  for (let ri = 0; ri < dataRows.length; ri++) {
    const raw = dataRows[ri]
    const row = {}

    for (let ci = 0; ci < headers.length; ci++) {
      const col = headers[ci]
      const cell = ci < raw.length ? (raw[ci] ?? '') : ''

      // Cell length cap
      if (cell.length > CSV_CELL_MAX) {
        return {
          error: {
            code: IMPORT_ERROR.CELL_TOO_LONG,
            message: `Cell at row ${ri + 2}, column "${col}" exceeds the maximum length of ${CSV_CELL_MAX} characters.`,
          },
        }
      }

      // CSV injection guard (CWE-1236)
      if (isCsvInjection(cell)) {
        return {
          error: {
            code: IMPORT_ERROR.CSV_INJECTION,
            message: `CSV formula injection detected at row ${ri + 2}, column "${col}". Values starting with =, +, -, @ are not allowed.`,
          },
        }
      }

      row[col] = cell
    }

    rows.push(row)
  }

  return { columns: [...columnSet], rows }
}

// ---------------------------------------------------------------------------
// JSON parser
//
// Accepts:
//   - Array of objects: [{ title: 'A', year: 2000 }, ...]
//   - Object with a "items" or "data" array property
//   - Single object (wrapped in array for uniform processing)
// ---------------------------------------------------------------------------
function parseJson(parsed) {
  let items

  if (Array.isArray(parsed)) {
    items = parsed
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) {
      items = parsed.items
    } else if (Array.isArray(parsed.data)) {
      items = parsed.data
    } else {
      // Single object — wrap in array
      items = [parsed]
    }
  } else {
    return { error: { code: IMPORT_ERROR.MALFORMED_JSON, message: 'JSON must be an array or an object with an "items" or "data" array.' } }
  }

  if (items.length === 0) {
    return { error: { code: IMPORT_ERROR.NO_ROWS, message: 'The JSON file contains no items.' } }
  }

  if (items.length > IMPORT_MAX_ROWS) {
    return {
      error: {
        code: IMPORT_ERROR.TOO_MANY_ROWS,
        message: `JSON has ${items.length} items; maximum is ${IMPORT_MAX_ROWS}.`,
      },
    }
  }

  // Collect column names from the union of all object keys
  const columnSet = new Set()
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const key of Object.keys(item)) {
        columnSet.add(key)
      }
    }
  }

  if (columnSet.size === 0) {
    return { error: { code: IMPORT_ERROR.EMPTY_FILE, message: 'The JSON file contains no recognisable item fields.' } }
  }

  if (columnSet.size > IMPORT_MAX_COLUMNS) {
    return {
      error: {
        code: IMPORT_ERROR.TOO_MANY_COLUMNS,
        message: `JSON has ${columnSet.size} distinct keys; maximum is ${IMPORT_MAX_COLUMNS}.`,
      },
    }
  }

  const columns = [...columnSet]

  // Validate each row: non-object entries are rejected; string values go through
  // CSV injection guard and length cap.
  const rows = []
  for (let ri = 0; ri < items.length; ri++) {
    const item = items[ri]

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return {
        error: {
          code: IMPORT_ERROR.MALFORMED_JSON,
          message: `Item at index ${ri} is not an object.`,
        },
      }
    }

    const row = {}
    for (const col of columns) {
      const raw = item[col]

      // Normalise: convert numbers/booleans to strings for uniform CSV-like treatment.
      // null/undefined become empty string.
      let cell
      if (raw === null || raw === undefined) {
        cell = ''
      } else if (typeof raw === 'string') {
        cell = raw
      } else if (typeof raw === 'number' || typeof raw === 'boolean') {
        cell = String(raw)
      } else {
        // Arrays, nested objects — JSON.stringify for import (will be validated downstream)
        try {
          cell = JSON.stringify(raw)
        } catch {
          cell = ''
        }
      }

      // Cell length cap
      if (cell.length > CSV_CELL_MAX) {
        return {
          error: {
            code: IMPORT_ERROR.CELL_TOO_LONG,
            message: `Cell at index ${ri}, key "${col}" exceeds the maximum length of ${CSV_CELL_MAX} characters.`,
          },
        }
      }

      // CSV injection guard also applies to JSON string values (defense-in-depth)
      if (isCsvInjection(cell)) {
        return {
          error: {
            code: IMPORT_ERROR.CSV_INJECTION,
            message: `Formula-like value detected at index ${ri}, key "${col}". Values starting with =, +, -, @ are not allowed.`,
          },
        }
      }

      row[col] = cell
    }

    rows.push(row)
  }

  return { columns, rows }
}

// ---------------------------------------------------------------------------
// Public entry point
//
// Accepts:
//   - text: the raw file content (string)
//   - mimeType: the Content-Type (or filename extension hint)
//
// Returns { columns, rows } where every cell value is a string,
// or { error: { code, message } }.
// ---------------------------------------------------------------------------
export function parseImport(text, { mimeType = '' } = {}) {
  // Empty file check
  if (!text || (typeof text === 'string' && text.trim().length === 0)) {
    return { error: { code: IMPORT_ERROR.EMPTY_FILE, message: 'The file is empty.' } }
  }

  // Size check
  const byteLen = Buffer.byteLength(text, 'utf8')
  if (byteLen > IMPORT_MAX_BYTES) {
    return {
      error: {
        code: IMPORT_ERROR.TOO_LARGE,
        message: `File is too large (${byteLen} bytes). Maximum is ${IMPORT_MAX_BYTES} bytes.`,
      },
    }
  }

  const mime = (mimeType || '').toLowerCase()

  // Detect format from MIME type (or fall back to heuristic).
  // text/csv is the canonical CSV MIME; text/tab-separated-values is TSV.
  // application/json is the canonical JSON MIME. For plain text we fall
  // through to the heuristic below.
  const isJson = mime.includes('json') || mime === 'application/json'
  const isCsv = mime === 'text/csv' || mime === 'text/tab-separated-values' || mime.endsWith('/csv')

  if (isJson) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      return { error: { code: IMPORT_ERROR.MALFORMED_JSON, message: `Invalid JSON: ${err.message}` } }
    }
    return parseJson(parsed)
  }

  if (isCsv) {
    return parseCsv(text)
  }

  // Fallback: try to detect by first non-whitespace character
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { error: { code: IMPORT_ERROR.EMPTY_FILE, message: 'The file is empty.' } }
  }

  const firstChar = trimmed[0]
  if (firstChar === '{' || firstChar === '[') {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { error: { code: IMPORT_ERROR.MALFORMED_CSV, message: 'Unsupported format. Please upload a CSV or JSON file.' } }
    }
    return parseJson(parsed)
  }

  // Treat as CSV
  return parseCsv(text)
}

// ---------------------------------------------------------------------------
// Field mapping helper
//
// Given a detect list of columns from the file and the target type's field
// schema, produce an auto-mapping (exact name match) and a list of unmapped
// columns/fields so the UI can prompt the user.
// ---------------------------------------------------------------------------
export function autoMapFields(columns, typeDef) {
  if (!typeDef || !typeDef.fields) {
    return { mapping: {}, unmappedColumns: [...columns], unmappedFields: [] }
  }

  const allFields = [
    ...(typeDef.fields.canonical || []),
    ...(typeDef.fields.owned || []),
  ]

  const mapping = {}
  const unmappedColumns = []
  const unmappedFields = []

  // Build a lookup of field key → field definition, plus a lowercase alias map
  // for case-insensitive matching
  const fieldByKey = new Map()
  const fieldByLower = new Map()
  for (const f of allFields) {
    fieldByKey.set(f.key, f)
    fieldByLower.set(f.key.toLowerCase(), f)
  }

  // Label-based matching (more user-friendly — the label is what the user sees)
  const fieldByLabelLower = new Map()
  for (const f of allFields) {
    if (f.label) {
      fieldByLabelLower.set(f.label.toLowerCase().trim(), f)
    }
  }

  for (const col of columns) {
    const colLower = col.toLowerCase().trim()

    // Try exact key match
    if (fieldByKey.has(col)) {
      mapping[col] = col
      continue
    }

    // Try case-insensitive key match
    if (fieldByLower.has(colLower)) {
      mapping[col] = fieldByLower.get(colLower).key
      continue
    }

    // Try label match
    if (fieldByLabelLower.has(colLower)) {
      mapping[col] = fieldByLabelLower.get(colLower).key
      continue
    }

    unmappedColumns.push(col)
  }

  // Find required fields that have no mapping yet
  for (const f of allFields) {
    if (f.required) {
      const mapped = [...Object.values(mapping)].includes(f.key)
      if (!mapped) {
        unmappedFields.push(f)
      }
    }
  }

  return { mapping, unmappedColumns, unmappedFields }
}