// @vitest-environment node
//
// Unit suite for the minimal JSON Schema validator
// (netlify/functions/_shared/ai/schema.js, ADMIN-3.1 #303). Verifies the
// fail-closed subset the capability contracts rely on: type checks, required
// fields, unknown-property rejection, enum, and length/range bounds.
import { describe, expect, it } from 'vitest'
import { validateSchema } from './schema'

describe('validateSchema', () => {
  it('accepts a valid object', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'confidence'],
      properties: {
        category: { type: 'string', minLength: 1, maxLength: 100 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    }
    expect(validateSchema({ category: 'books', confidence: 0.9 }, schema)).toEqual({ valid: true })
  })

  it('rejects a missing required property', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['category'],
      properties: { category: { type: 'string' } },
    }
    const r = validateSchema({}, schema)
    expect(r.valid).toBe(false)
    expect(r.errors.join('; ')).toContain('required property missing')
  })

  it('rejects an unknown property when additionalProperties is false', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: { category: { type: 'string' } },
    }
    const r = validateSchema({ category: 'x', evil: 'y' }, schema)
    expect(r.valid).toBe(false)
    expect(r.errors.join('; ')).toContain('unknown property')
  })

  it('rejects a wrong-typed value', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['confidence'],
      properties: { confidence: { type: 'number' } },
    }
    const r = validateSchema({ confidence: 'high' }, schema)
    expect(r.valid).toBe(false)
    expect(r.errors.join('; ')).toContain('expected number')
  })

  it('rejects a value outside an enum', () => {
    const schema = { type: 'string', enum: ['issue', 'epic'] }
    expect(validateSchema('issue', schema).valid).toBe(true)
    expect(validateSchema('task', schema).valid).toBe(false)
  })

  it('enforces string length bounds', () => {
    const schema = { type: 'string', minLength: 2, maxLength: 4 }
    expect(validateSchema('ab', schema).valid).toBe(true)
    expect(validateSchema('a', schema).valid).toBe(false)
    expect(validateSchema('abcde', schema).valid).toBe(false)
  })

  it('enforces array item count and item schemas', () => {
    const schema = {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', maxLength: 5 },
    }
    expect(validateSchema(['a', 'b'], schema).valid).toBe(true)
    expect(validateSchema([], schema).valid).toBe(false)
    expect(validateSchema(['a', 'b', 'c', 'd'], schema).valid).toBe(false)
    expect(validateSchema(['a', 42], schema).valid).toBe(false)
  })

  it('enforces numeric range bounds', () => {
    const schema = { type: 'number', minimum: 0, maximum: 1 }
    expect(validateSchema(0.5, schema).valid).toBe(true)
    expect(validateSchema(1.5, schema).valid).toBe(false)
    expect(validateSchema(-0.1, schema).valid).toBe(false)
  })

  it('rejects NaN / Infinity as numbers', () => {
    const schema = { type: 'number' }
    expect(validateSchema(NaN, schema).valid).toBe(false)
    expect(validateSchema(Infinity, schema).valid).toBe(false)
  })

  it('accepts booleans and null', () => {
    expect(validateSchema(true, { type: 'boolean' }).valid).toBe(true)
    expect(validateSchema(null, { type: 'null' }).valid).toBe(true)
    expect(validateSchema(null, { type: 'boolean' }).valid).toBe(false)
  })

  it('rejects a non-object schema', () => {
    expect(validateSchema({}, null).valid).toBe(false)
  })

  it('allows unknown properties when additionalProperties is not false', () => {
    const schema = {
      type: 'object',
      required: [],
      properties: { category: { type: 'string' } },
    }
    expect(validateSchema({ category: 'x', extra: 1 }, schema).valid).toBe(true)
  })

  it('rejects an object value that is actually an array', () => {
    const schema = { type: 'object', additionalProperties: false, required: [], properties: {} }
    expect(validateSchema([], schema).valid).toBe(false)
  })

  it('validates nested objects and arrays of objects', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['matches'],
      properties: {
        matches: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['index'],
            properties: { index: { type: 'integer', minimum: 0 } },
          },
        },
      },
    }
    expect(validateSchema({ matches: [{ index: 0 }] }, schema).valid).toBe(true)
    expect(validateSchema({ matches: [{ index: -1 }] }, schema).valid).toBe(false)
    expect(validateSchema({ matches: [{ index: 0, evil: 1 }] }, schema).valid).toBe(false)
  })

  it('accepts an untyped leaf value', () => {
    expect(validateSchema(42, {}).valid).toBe(true)
  })

  it('accepts an array with no item schema', () => {
    expect(validateSchema([1, 2, 3], { type: 'array' }).valid).toBe(true)
  })

  it('accepts a string with no length bounds', () => {
    expect(validateSchema('anything', { type: 'string' }).valid).toBe(true)
  })
})