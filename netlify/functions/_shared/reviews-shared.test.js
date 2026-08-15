// @vitest-environment node
//
// Unit tests for the shared reviews validation + key parsing (M1) used by both
// the Postgres and Blobs reviews paths. The handler-level enforcement (400
// INVALID_SOURCE_ID before any store write) is covered in reviews.test.js and
// reviews-postgres.test.js; this file pins the validator's own contract and
// the robust key splitter.

import { describe, expect, it } from 'vitest'
import { isValidSourceId, parseReleaseKey, sourceIdError, SOURCE_ID_MAX_LENGTH } from './reviews-shared'

describe('sourceId validation (M1)', () => {
  it('accepts a numeric Discogs release id for records', () => {
    expect(isValidSourceId('372469', 'records')).toBe(true)
    expect(sourceIdError('372469', 'records')).toBeNull()
  })

  it('accepts a Google volume id for books', () => {
    expect(isValidSourceId('zyTCAlFPjgYC', 'books')).toBe(true)
    expect(isValidSourceId('O9sxDwAAQBAJ', 'books')).toBe(true)
  })

  it('rejects empty, non-string, colon, control, whitespace and oversize sourceIds', () => {
    expect(isValidSourceId('', 'records')).toBe(false)
    expect(isValidSourceId(123, 'records')).toBe(false)
    expect(isValidSourceId('a:b', 'records')).toBe(false)   // `:` breaks the Blobs key split
    expect(isValidSourceId('a\u0000b', 'records')).toBe(false) // control char
    expect(isValidSourceId('has space', 'books')).toBe(false)   // whitespace
    expect(isValidSourceId('x'.repeat(SOURCE_ID_MAX_LENGTH + 1), 'records')).toBe(false) // oversize
  })

  it('rejects a non-numeric records id but allows the same string for books', () => {
    expect(isValidSourceId('abc', 'records')).toBe(false)
    expect(isValidSourceId('abc', 'books')).toBe(true)
  })

  it('reports INVALID_SOURCE_ID with a message for every bad input', () => {
    const bad = [['a:b', 'records'], ['a\u0000b', 'records'], ['x'.repeat(65), 'records'], ['abc', 'records'], ['has space', 'books']]
    for (const [sourceId, kind] of bad) {
      const err = sourceIdError(sourceId, kind)
      expect(err).not.toBeNull()
      expect(err.code).toBe('INVALID_SOURCE_ID')
      expect(typeof err.message).toBe('string')
      expect(err.message.length).toBeGreaterThan(0)
    }
  })
})

describe('parseReleaseKey — robust key splitting (M1)', () => {
  it('splits a well-formed index entry into kind + sourceId', () => {
    expect(parseReleaseKey('records:372469')).toEqual({ kind: 'records', sourceId: '372469' })
    expect(parseReleaseKey('books:zyTCAlFPjgYC')).toEqual({ kind: 'books', sourceId: 'zyTCAlFPjgYC' })
  })

  it('never mis-splits a sourceId containing a colon (legacy/corrupt data)', () => {
    // A pre-M1 bad write could have produced `records:a:b`. Split on the FIRST
    // `:` only — kind is always a known name with no `:`, so the whole rest is
    // the sourceId, never a truncated one.
    expect(parseReleaseKey('records:a:b')).toEqual({ kind: 'records', sourceId: 'a:b' })
    expect(parseReleaseKey('books:zy:TC')).toEqual({ kind: 'books', sourceId: 'zy:TC' })
  })

  it('returns null when there is no separator', () => {
    expect(parseReleaseKey('nokind')).toBeNull()
    expect(parseReleaseKey('')).toBeNull()
    expect(parseReleaseKey(undefined)).toBeNull()
  })
})
