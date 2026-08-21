// schema.js — minimal JSON Schema validator for structured LLM output
// (ADMIN-3.1, #303, epic #302).
//
// Provider output is UNTRUSTED (ADR-0006). Every structured completion is
// validated against a capability's output schema before the caller may use it.
// This validator implements the small, deterministic subset of JSON Schema the
// capability contracts need — enough to reject malformed, oversized, or
// unexpected model output fail-closed without pulling in a dependency.
//
// Fail-closed by design: unknown object properties are rejected
// (`additionalProperties: false`), required fields must be present, and every
// value must match its declared type. A value that does not satisfy the schema
// is rejected outright — never coerced, never partially accepted.

// Validate `value` against `schema`. Returns { valid: true } or
// { valid: false, errors: string[] }.
export function validateSchema(value, schema) {
  const errors = []
  walk(value, schema, errors, '$')
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}

function walk(value, schema, errors, path) {
  if (!schema || typeof schema !== 'object') {
    errors.push(`${path}: schema is not an object`)
    return
  }

  const type = schema.type
  if (type && !typeMatches(value, type)) {
    errors.push(`${path}: expected ${type}, got ${jsonType(value)}`)
    return
  }

  switch (type) {
    case 'object':
      walkObject(value, schema, errors, path)
      break
    case 'array':
      walkArray(value, schema, errors, path)
      break
    case 'string':
      walkString(value, schema, errors, path)
      break
    case 'number':
    case 'integer':
      walkNumber(value, schema, errors, path)
      break
    default:
      // null / boolean / untyped leaf — nothing further to check.
      break
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in allowed set`)
  }
}

function walkObject(value, schema, errors, path) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return

  const props = schema.properties || {}
  const required = schema.required || []

  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${path}.${key}: required property missing`)
    }
  }

  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`
    if (!(key in props)) {
      if (schema.additionalProperties === false) {
        errors.push(`${childPath}: unknown property`)
      }
      continue
    }
    walk(value[key], props[key], errors, childPath)
  }
}

function walkArray(value, schema, errors, path) {
  if (!Array.isArray(value)) return
  if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
    errors.push(`${path}: fewer than ${schema.minItems} items`)
  }
  if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
    errors.push(`${path}: more than ${schema.maxItems} items`)
  }
  if (schema.items) {
    value.forEach((item, i) => walk(item, schema.items, errors, `${path}[${i}]`))
  }
}

function walkString(value, schema, errors, path) {
  if (typeof value !== 'string') return
  if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
    errors.push(`${path}: shorter than ${schema.minLength} chars`)
  }
  if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
    errors.push(`${path}: longer than ${schema.maxLength} chars`)
  }
}

function walkNumber(value, schema, errors, path) {
  if (typeof value !== 'number') return
  if (Number.isFinite(schema.minimum) && value < schema.minimum) {
    errors.push(`${path}: below minimum ${schema.minimum}`)
  }
  if (Number.isFinite(schema.maximum) && value > schema.maximum) {
    errors.push(`${path}: above maximum ${schema.maximum}`)
  }
}

function typeMatches(value, type) {
  switch (type) {
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

function jsonType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}