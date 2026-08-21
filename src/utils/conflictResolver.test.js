// M3 #161 — Conflict Resolver tests (ADR-0019 Dec 8).
//
// Covers:
//   - ConflictError: stable error type for stale-update rejections
//   - checkConflict: OCC comparison — returns conflict descriptor or null
//   - applyResolution: resolution strategies (server, local, merge)
//   - buildResolutionPatch: retry-ready patches from resolved conflicts
//   - autoMergeFields: safe-field merge for collection metadata
//   - determineEntityType: entity type detection from item data
//   - registerMergePolicy / getMergePolicy: policy registry
//   - initDefaultPolicies: default merge policies
//   - sanitization: no credentials in conflict payloads

import { beforeEach, describe, expect, it } from 'vitest'
import {
  ConflictError,
  isConflictError,
  checkConflict,
  applyResolution,
  buildResolutionPatch,
  autoMergeFields,
  determineEntityType,
  registerMergePolicy,
  getMergePolicy,
  initDefaultPolicies,
  ENTITY_TYPE,
  RESOLUTION,
  CONFLICT_STATUS,
} from './conflictResolver'

const USER_ID = 'u1'
const SCOPE = `user:${USER_ID}`

const SERVER_ITEM = {
  uuid: 'server:r1',
  id: 'r1',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  notes: 'Original pressing',
  tags: ['jazz', 'cool'],
}

const LOCAL_ITEM = {
  uuid: 'server:r1',
  id: 'r1',
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  year: 1959,
  notes: 'My favorite album',
  tags: ['jazz', 'vinyl'],
}

const LENDING_ITEM = {
  uuid: 'local:l1',
  lentTo: 'Alice',
  lentAt: '2026-08-01T00:00:00Z',
  dueDate: '2026-09-01T00:00:00Z',
}

const REVIEW_ITEM = {
  uuid: 'local:rev1',
  rating: 5,
  reviewText: 'Amazing album',
}

const PAYMENT_ITEM = {
  uuid: 'local:pay1',
  amount: 29.99,
  paymentMethod: 'card',
}

beforeEach(() => {
  // Reset policies to defaults before each test
  initDefaultPolicies()
})

// ---------------------------------------------------------------------------
// ConflictError
// ---------------------------------------------------------------------------

describe('ConflictError', () => {
  it('creates a stable error with code CONFLICT_ERROR', () => {
    const err = new ConflictError('uuid:1', 5, 3, 'custom message')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.code).toBe('CONFLICT_ERROR')
    expect(err.uuid).toBe('uuid:1')
    expect(err.serverVersion).toBe(5)
    expect(err.expectedVersion).toBe(3)
    expect(err.message).toContain('custom message')
  })

  it('isConflictError detects ConflictError instances', () => {
    const err = new ConflictError('uuid:1', 5, 3)
    expect(isConflictError(err)).toBe(true)
    expect(isConflictError(new Error('plain'))).toBe(false)
    expect(isConflictError(null)).toBe(false)
    expect(isConflictError({ code: 'CONFLICT_ERROR' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// determineEntityType
// ---------------------------------------------------------------------------

describe('determineEntityType', () => {
  it('detects collection items', () => {
    expect(determineEntityType({ title: 'A', artist: 'B' })).toBe(ENTITY_TYPE.COLLECTION)
  })

  it('detects lending items', () => {
    expect(determineEntityType(LENDING_ITEM)).toBe(ENTITY_TYPE.LENDING)
    expect(determineEntityType({ lentTo: 'Bob' })).toBe(ENTITY_TYPE.LENDING)
  })

  it('detects review items', () => {
    expect(determineEntityType(REVIEW_ITEM)).toBe(ENTITY_TYPE.REVIEW)
    expect(determineEntityType({ rating: 4 })).toBe(ENTITY_TYPE.REVIEW)
  })

  it('detects payment items', () => {
    expect(determineEntityType(PAYMENT_ITEM)).toBe(ENTITY_TYPE.PAYMENT)
    expect(determineEntityType({ amount: 10 })).toBe(ENTITY_TYPE.PAYMENT)
  })

  it('defaults to collection for unknown data', () => {
    expect(determineEntityType(null)).toBe(ENTITY_TYPE.COLLECTION)
    expect(determineEntityType({})).toBe(ENTITY_TYPE.COLLECTION)
  })
})

// ---------------------------------------------------------------------------
// Merge policy registry
// ---------------------------------------------------------------------------

describe('merge policy registry', () => {
  it('has default policies initialized', () => {
    const colPolicy = getMergePolicy(ENTITY_TYPE.COLLECTION)
    expect(colPolicy.requiresUserIntent).toBe(false)
    expect(colPolicy.mergeableFields).toContain('notes')
    expect(colPolicy.mergeableFields).toContain('tags')

    const lendingPolicy = getMergePolicy(ENTITY_TYPE.LENDING)
    expect(lendingPolicy.requiresUserIntent).toBe(true)

    const reviewPolicy = getMergePolicy(ENTITY_TYPE.REVIEW)
    expect(reviewPolicy.requiresUserIntent).toBe(false)

    const paymentPolicy = getMergePolicy(ENTITY_TYPE.PAYMENT)
    expect(paymentPolicy.requiresUserIntent).toBe(false)
  })

  it('returns default policy for unknown entity types', () => {
    const policy = getMergePolicy('unknown-type')
    expect(policy.requiresUserIntent).toBe(true)
    expect(policy.mergeableFields).toEqual([])
  })

  it('allows registering custom policies', () => {
    registerMergePolicy('custom', {
      requiresUserIntent: true,
      mergeableFields: ['field1'],
      description: 'Custom policy',
    })
    const policy = getMergePolicy('custom')
    expect(policy.requiresUserIntent).toBe(true)
    expect(policy.mergeableFields).toEqual(['field1'])
    expect(policy.description).toBe('Custom policy')
  })

  it('throws on invalid registration', () => {
    expect(() => registerMergePolicy('', {})).toThrow()
    expect(() => registerMergePolicy('test', null)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// checkConflict — OCC detection
// ---------------------------------------------------------------------------

describe('checkConflict — OCC detection', () => {
  it('returns null when server version <= base version', () => {
    const result = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 3,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    expect(result).toBeNull()
  })

  it('returns null when server version is less than base version', () => {
    const result = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 2,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    expect(result).toBeNull()
  })

  it('returns conflict descriptor when server version > base version', () => {
    const result = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    expect(result).not.toBeNull()
    expect(result.uuid).toBe('server:r1')
    expect(result.serverVersion).toBe(5)
    expect(result.localVersion).toBe(2)
    expect(result.status).toBe(CONFLICT_STATUS.UNRESOLVED)
    expect(result.conflictId).toMatch(/^server:r1:/)
  })

  it('detects entity type automatically', () => {
    const result = checkConflict({
      uuid: 'local:l1',
      localItem: LENDING_ITEM,
      serverItem: LENDING_ITEM,
      serverVersion: 3,
      localVersion: 1,
      baseVersion: 1,
      scope: SCOPE,
    })
    expect(result.entityType).toBe(ENTITY_TYPE.LENDING)
  })

  it('includes policy info in conflict descriptor', () => {
    const result = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
      entityType: ENTITY_TYPE.COLLECTION,
    })
    expect(result.policy).toBeDefined()
    expect(result.policy.requiresUserIntent).toBe(false)
    expect(result.policy.mergeableFields).toContain('notes')
  })

  it('throws on missing required fields', () => {
    expect(() => checkConflict({})).toThrow('uuid is required')
    expect(() => checkConflict({ uuid: 'x' })).toThrow('baseVersion is required')
    expect(() => checkConflict({ uuid: 'x', baseVersion: 1 })).toThrow('serverVersion is required')
  })
})

// ---------------------------------------------------------------------------
// applyResolution
// ---------------------------------------------------------------------------

describe('applyResolution', () => {
  it('resolves with USE_SERVER strategy', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    const resolved = applyResolution(conflict, RESOLUTION.USE_SERVER)
    expect(resolved.status).toBe(CONFLICT_STATUS.RESOLVED_SERVER)
    expect(resolved.resolvedAt).toBeTruthy()
    expect(resolved.mergedItem).toBeNull()
  })

  it('resolves with USE_LOCAL strategy', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    const resolved = applyResolution(conflict, RESOLUTION.USE_LOCAL)
    expect(resolved.status).toBe(CONFLICT_STATUS.RESOLVED_LOCAL)
  })

  it('resolves with MERGE strategy and merged item', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    const merged = { ...SERVER_ITEM, notes: 'Merged notes' }
    const resolved = applyResolution(conflict, RESOLUTION.MERGE, merged)
    expect(resolved.status).toBe(CONFLICT_STATUS.RESOLVED_MERGED)
    expect(resolved.mergedItem).toEqual(merged)
  })

  it('throws on already-resolved conflict', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    const resolved = applyResolution(conflict, RESOLUTION.USE_SERVER)
    expect(() => applyResolution(resolved, RESOLUTION.USE_LOCAL)).toThrow('already')
  })

  it('throws on invalid resolution strategy', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    expect(() => applyResolution(conflict, 'invalid')).toThrow('Invalid resolution')
  })

  it('throws on MERGE without mergedItem', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    expect(() => applyResolution(conflict, RESOLUTION.MERGE)).toThrow('mergedItem is required')
  })
})

// ---------------------------------------------------------------------------
// buildResolutionPatch
// ---------------------------------------------------------------------------

describe('buildResolutionPatch', () => {
  it('returns null for USE_SERVER (accept server version)', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    const resolved = applyResolution(conflict, RESOLUTION.USE_SERVER)
    expect(buildResolutionPatch(resolved)).toBeNull()
  })

  it('returns local item for USE_LOCAL', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    const resolved = applyResolution(conflict, RESOLUTION.USE_LOCAL)
    expect(buildResolutionPatch(resolved)).toEqual(LOCAL_ITEM)
  })

  it('returns merged item for MERGE', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    const merged = { ...SERVER_ITEM, notes: 'Merged notes' }
    const resolved = applyResolution(conflict, RESOLUTION.MERGE, merged)
    expect(buildResolutionPatch(resolved)).toEqual(merged)
  })

  it('returns null for unresolved conflict', () => {
    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: LOCAL_ITEM,
      serverItem: SERVER_ITEM,
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })
    expect(buildResolutionPatch(conflict)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// autoMergeFields
// ---------------------------------------------------------------------------

describe('autoMergeFields', () => {
  it('merges safe fields from local over server', () => {
    const merged = autoMergeFields(SERVER_ITEM, LOCAL_ITEM, ENTITY_TYPE.COLLECTION)
    // Mergeable fields (notes, tags) should come from local
    expect(merged.notes).toBe('My favorite album')
    expect(merged.tags).toEqual(['jazz', 'vinyl'])
    // Non-mergeable fields should stay from server
    expect(merged.title).toBe('Kind of Blue')
    expect(merged.year).toBe(1959)
  })

  it('returns server item when no local item', () => {
    const merged = autoMergeFields(SERVER_ITEM, null)
    expect(merged).toEqual(SERVER_ITEM)
  })

  it('returns local item when no server item', () => {
    const merged = autoMergeFields(null, LOCAL_ITEM)
    expect(merged).toEqual(LOCAL_ITEM)
  })

  it('returns null when both items are null', () => {
    expect(autoMergeFields(null, null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Security: no credentials in conflict payloads
// ---------------------------------------------------------------------------

describe('security — no credentials in conflict payloads', () => {
  it('sanitizes sensitive fields from conflict descriptors', () => {
    const maliciousItem = {
      uuid: 'server:r1',
      title: 'Test',
      token: 'secret-token',
      accessCode: 'secret-code',
      password: 'p@ssw0rd',
      secret: 'my-secret',
      authorization: 'Bearer xyz',
    }

    const conflict = checkConflict({
      uuid: 'server:r1',
      localItem: maliciousItem,
      serverItem: { uuid: 'server:r1', title: 'Server' },
      serverVersion: 5,
      localVersion: 2,
      baseVersion: 3,
      scope: SCOPE,
    })

    // Sensitive fields should be stripped
    expect(conflict.localItem.token).toBeUndefined()
    expect(conflict.localItem.accessCode).toBeUndefined()
    expect(conflict.localItem.password).toBeUndefined()
    expect(conflict.localItem.secret).toBeUndefined()
    expect(conflict.localItem.authorization).toBeUndefined()
    // Safe fields should be preserved
    expect(conflict.localItem.title).toBe('Test')
  })
})

// ---------------------------------------------------------------------------
// Adversarial negatives
// ---------------------------------------------------------------------------

describe('adversarial — safety guarantees', () => {
  it('newer server version always detected as conflict', () => {
    expect(checkConflict({
      uuid: 'x',
      serverVersion: 100,
      localVersion: 1,
      baseVersion: 1,
      scope: SCOPE,
    })).not.toBeNull()
  })

  it('same version is not a conflict', () => {
    expect(checkConflict({
      uuid: 'x',
      serverVersion: 5,
      localVersion: 1,
      baseVersion: 5,
      scope: SCOPE,
    })).toBeNull()
  })

  it('older server version is not a conflict', () => {
    expect(checkConflict({
      uuid: 'x',
      serverVersion: 3,
      localVersion: 1,
      baseVersion: 5,
      scope: SCOPE,
    })).toBeNull()
  })
})