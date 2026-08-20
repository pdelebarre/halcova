// collection-type-registry.js — FEAT-6.2 #315: the SERVER-AUTHORITATIVE
// Collection Type Registry (ADR-0020 §2, §6). This module is the single source
// of truth for a collection kind's:
//   * display metadata  — id slug, display_name label, icon token, description
//   * field schema      — the validated extensible-attribute definitions
//   * capabilities      — read-only flags that gate UX/actions
//   * provider mappings — ordered catalogue-lookup providers (primary→fallback)
//
// SECURITY CONTRACT (ADR-0020 §2 dec 6, ADR-0010):
//   * A client can NEVER supply, override or redefine a type/capability/field
//     definition. Definitions are read from the `collection_types` +
//     `collection_type_fields` tables (the registry), which app_rls is granted
//     SELECT-only (db/rls/012_collection_types_rls.sql). This module exposes
//     them READ-ONLY; there is no write/upsert path here.
//   * Unknown types/fields are rejected server-side with STABLE errors
//     (UNKNOWN_TYPE, UNKNOWN_FIELD) and missing required fields with REQUIRED.
//   * All type metadata serialized for a client passes through an explicit
//     allowlist and the dangerous-content guard so it is XSS-safe to render
//     (SEC-7.5 #409 / ADR-0020 #317 controls).
//
// This module is DB-backed so the registry and the data it governs can never
// drift from the authoritative rows; a code-level copy would be a second
// source of truth (rejected). The pure validation/capability helpers take a
// definition object so they are unit-testable without a live DB.

import { intInRange, isDangerousContent, str, arrayOfStrings } from './security'

// Stable, machine-readable error codes for the registry (ADR-0010). Reused by
// the collection-types API and by any future writer that validates attributes
// against a type's field schema.
export const REGISTRY_ERROR = {
  UNKNOWN_TYPE: 'UNKNOWN_TYPE', // no such collection type slug
  UNKNOWN_FIELD: 'UNKNOWN_FIELD', // attribute not in the type's field schema
  REQUIRED: 'REQUIRED', // required attribute missing/empty
  TYPE_ERROR: 'TYPE_ERROR', // attribute value has the wrong type
  TOO_LONG: 'TOO_LONG', // attribute exceeds a length/array cap
  OUT_OF_RANGE: 'OUT_OF_RANGE', // attribute outside min/max bounds
  INVALID_VALUE: 'INVALID_VALUE', // attribute not in the allowed_values enum
  HTML_REJECTED: 'HTML_REJECTED', // dangerous content in a text attribute
}

// The public (allowlisted) shape of a registry definition. Everything a UI
// renders is derived from these fields and nothing else — an attacker cannot
// smuggle a capability/field/label that isn't here.
function publicDefinition(type, fieldsByBucket) {
  return Object.freeze({
    id: type.id,
    displayName: type.display_name,
    icon: type.icon,
    description: type.description,
    schemaVersion: type.schema_version,
    isPublic: type.is_public,
    capabilities: Object.freeze([...(type.capabilities || [])]),
    providerMappings: Object.freeze([...(type.provider_mappings || [])]),
    // Field schema keyed by attribute namespace: { canonical, owned }.
    fields: Object.freeze({
      canonical: Object.freeze(fieldsByBucket.canonical || []),
      owned: Object.freeze(fieldsByBucket.owned || []),
    }),
  })
}

// Assemble a frozen, allowlisted definition from raw DB rows. `type` is a
// collection_types row; `fields` are collection_type_fields rows for that type.
// Pure (no DB). Throws only on a structurally invalid DB row (a corrupted
// registry row should fail loudly rather than silently emit a broken def).
export function buildTypeDefinition(type, fields = []) {
  if (!type) return null
  if (!type.capabilities || !Array.isArray(type.capabilities)) {
    throw new Error(`collection_types.row(${type.id}).capabilities is not an array`)
  }
  if (!type.provider_mappings || !Array.isArray(type.provider_mappings)) {
    throw new Error(`collection_types.row(${type.id}).provider_mappings is not an array`)
  }
  // The registry slug surfaces as the API collectionType and in the URL, so it
  // must be a constrained token (defense-in-depth on top of the DB CHECK).
  if (!/^[a-z][a-z0-9_-]*$/.test(type.id)) {
    throw new Error(`collection_types.row id "${type.id}" is not a valid registry slug`)
  }

  const byBucket = { canonical: [], owned: [] }
  for (const f of fields) {
    const bucket = byBucket[f.bucket] ? f.bucket : 'canonical'
    byBucket[bucket].push(
      Object.freeze({
        key: f.field_key,
        bucket: f.bucket,
        fieldType: f.field_type,
        required: !!f.required,
        label: f.label,
        maxLength: f.max_length ?? null,
        arrayMax: f.array_max ?? null,
        itemMax: f.item_max ?? null,
        allowedValues: Array.isArray(f.allowed_values) ? Object.freeze([...f.allowed_values]) : null,
      }),
    )
  }
  return publicDefinition(type, byBucket)
}

// ---------------------------------------------------------------------------
// Pure capability helpers. Capabilities are READ-ONLY flags read from the
// server registry; a client can only query them, never set them. UI/actions
// gate on these so the domain logic lives in one place (the registry), not
// duplicated per screen (acceptance: "Capabilities control UX/actions without
// duplicating domain logic").
// ---------------------------------------------------------------------------
export function listCapabilities(typeDef) {
  return typeDef ? [...typeDef.capabilities] : []
}

export function hasCapability(typeDef, capability) {
  return !!typeDef && typeDef.capabilities.includes(capability)
}

// allowed_values enum check (when the field declares one). Non-enum values are
// rejected with INVALID_VALUE so a client can't write junk into an enum slot.
function enumCheck(field, ok) {
  if (ok.value === undefined || !Array.isArray(field.allowedValues)) return ok
  const values = Array.isArray(ok.value) ? ok.value : [ok.value]
  for (const v of values) {
    if (!field.allowedValues.includes(v)) {
      return { error: { code: REGISTRY_ERROR.INVALID_VALUE, message: `"${field.key}" must be one of: ${field.allowedValues.join(', ')}.` } }
    }
  }
  return ok
}

// Validate a single field value against its field-schema definition (ADR-0020
// §6). Returns { value } (validated) or { error } (first violation).
function validateField(field, value) {
  const { fieldType, required } = field
  const absent = value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  if (absent) {
    return required
      ? { error: { code: REGISTRY_ERROR.REQUIRED, message: `"${field.key}" is required.` } }
      : { value: undefined }
  }

  switch (fieldType) {
    case 'string':
    case 'date': {
      const r = str(value, { max: field.maxLength ?? 5000, required, rejectHtml: true })
      if (r.error) return { error: r.error }
      // dates must be YYYY or YYYY-MM-DD (loose; further validated by the writer)
      if (fieldType === 'date' && r.value !== undefined && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(r.value)) {
        return { error: { code: REGISTRY_ERROR.TYPE_ERROR, message: `"${field.key}" must be a date.` } }
      }
      return enumCheck(field, r)
    }
    case 'integer': {
      const r = intInRange(value, { required })
      if (r.error) return { error: r.error }
      return enumCheck(field, r)
    }
    case 'boolean': {
      if (typeof value !== 'boolean') return { error: { code: REGISTRY_ERROR.TYPE_ERROR, message: `"${field.key}" must be a boolean.` } }
      return { value }
    }
    case 'array_string': {
      const r = arrayOfStrings(value, {
        max: field.arrayMax ?? 100,
        itemMax: field.itemMax ?? 1000,
        required,
        rejectHtml: true,
      })
      if (r.error) return { error: r.error }
      return enumCheck(field, r)
    }
    case 'string_or_array': {
      if (Array.isArray(value)) {
        const r = arrayOfStrings(value, {
          max: field.arrayMax ?? 100,
          itemMax: field.itemMax ?? 500,
          required,
          rejectHtml: true,
        })
        if (r.error) return { error: r.error }
        return enumCheck(field, r)
      }
      const r = str(value, { max: field.maxLength ?? 5000, required, rejectHtml: true })
      if (r.error) return { error: r.error }
      return enumCheck(field, r)
    }
    default:
      // A registry row with an unsupported field_type is a data-integrity
      // error: reject the whole payload rather than silently allowing it.
      return { error: { code: REGISTRY_ERROR.TYPE_ERROR, message: `Unsupported field type "${fieldType}".` } }
  }
}

// Validate a full attributes object (one namespace) against a type definition.
// NEVER trusts the caller's field/type definitions: the schema comes from
// `typeDef`, and any attribute key outside it is rejected with UNKNOWN_FIELD.
export function validateCollectionAttributes(typeDef, attributes, bucket = 'canonical') {
  if (!typeDef) {
    return { error: { code: REGISTRY_ERROR.UNKNOWN_TYPE, message: 'Unknown collection type.' } }
  }
  const schema = (typeDef.fields && typeDef.fields[bucket]) || []
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return { error: { code: REGISTRY_ERROR.TYPE_ERROR, message: 'Attributes must be an object.' } }
  }

  const schemaByKey = new Map(schema.map((f) => [f.key, f]))
  const out = {}

  // 1) Reject unknown attributes (fail-closed, stable UNKNOWN_FIELD).
  for (const key of Object.keys(attributes)) {
    if (!schemaByKey.has(key)) {
      return { error: { code: REGISTRY_ERROR.UNKNOWN_FIELD, message: `Unknown field: ${key}` } }
    }
  }
  // 2) Validate each schema field against the provided value.
  for (const field of schema) {
    const r = validateField(field, attributes[field.key])
    if (r.error) return { error: r.error }
    if (r.value !== undefined) out[field.key] = r.value
  }
  return { value: out }
}

// ---------------------------------------------------------------------------
// DB-backed repository. Reads the authoritative registry from Postgres.
// `db` is any node-postgres-shaped pool ({ query }). SELECT-only — there is
// deliberately NO write method here.
// ---------------------------------------------------------------------------
export function createCollectionTypeRepository({ db }) {
  async function rowById(id) {
    const { rows } = await db.query('SELECT * FROM collection_types WHERE id = $1', [id])
    return rows[0] || null
  }

  async function fieldsById(id) {
    const { rows } = await db.query(
      'SELECT * FROM collection_type_fields WHERE collection_type_id = $1 ORDER BY id',
      [id],
    )
    return rows
  }

  async function allTypeIds() {
    const { rows } = await db.query('SELECT id FROM collection_types ORDER BY id')
    return rows.map((r) => r.id)
  }

  // Resolve a type slug to its frozen, allowlisted definition. Returns null for
  // an unknown type (callers map to UNKNOWN_TYPE).
  async function getById(id) {
    const type = await rowById(id)
    if (!type) return null
    const fields = await fieldsById(id)
    return buildTypeDefinition(type, fields)
  }

  // List every registered type's public definition (for the read-only API).
  async function list() {
    const ids = await allTypeIds()
    const out = []
    for (const id of ids) {
      const def = await getById(id)
      if (def) out.push(def)
    }
    return out
  }

  return Object.freeze({ getById, list })
}

// A safe, allowlisted public metadata projection for the read-only API. Every
// rendered string is passed through the dangerous-content guard so a registry
// value that somehow carried an XSS payload can never reach the client as raw
// HTML (defense-in-depth; the seed values are trusted, but never assume).
export function toPublicTypeView(typeDef) {
  if (!typeDef) return null
  const safe = (s, max = 2000) => {
    const v = String(s ?? '').slice(0, max)
    return isDangerousContent(v) ? '' : v
  }
  return {
    id: typeDef.id,
    displayName: safe(typeDef.displayName, 200),
    icon: safe(typeDef.icon, 64),
    description: safe(typeDef.description, 500),
    schemaVersion: typeDef.schemaVersion,
    isPublic: !!typeDef.isPublic,
    capabilities: [...typeDef.capabilities],
    providerMappings: [...typeDef.providerMappings],
    // Fields are metadata describing the schema; labels are the only free-text
    // rendered, so they go through the same safe() guard. keys/types are
    // constrained tokens (the registry CHECK + allowlist) and are safe.
    fields: {
      canonical: typeDef.fields.canonical.map((f) => ({
        key: f.key,
        fieldType: f.fieldType,
        required: f.required,
        label: safe(f.label, 200),
      })),
      owned: typeDef.fields.owned.map((f) => ({
        key: f.key,
        fieldType: f.fieldType,
        required: f.required,
        label: safe(f.label, 200),
      })),
    },
  }
}
