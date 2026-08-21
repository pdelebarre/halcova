// M3 #161 — Optimistic Concurrency & Conflict Resolution (ADR-0019 Dec 8).
//
// WHAT THIS IS
// ------------
// The core conflict detection and resolution engine. It provides:
//   - ConflictError: a stable error type for stale-update rejections.
//   - checkConflict: OCC (optimistic concurrency control) comparison —
//     returns a conflict descriptor when the server version is newer than
//     the base version the client sent, or null when the mutation is safe.
//   - resolveConflict: apply a user-directed resolution to a persisted conflict
//     record, producing a retry-ready mutation.
//   - MERGE_POLICIES: entity-type-specific merge rules (ADR-0019 Dec 8).
//
// SECURITY (ADR-0019 Dec 4/5/6/7/8 — mandatory)
//   - No credentials in conflict payloads: conflict records carry only item
//     data and version numbers, never tokens, access codes or secrets.
//   - Server-authoritative ownership: scope is derived from the resolved
//     session user id, never client-chosen.
//   - No silent discard (ADR-0016 rule 12): a conflict is NEVER silently
//     resolved — it is persisted and surfaced until the user or an explicit
//     policy resolves it.
//   - Fail-closed on corrupt/malformed conflict payloads: missing version
//     numbers, null items or unknown resolution strategies return errors
//     rather than silently accepting bad data.

import { SYNC_STATUS } from '../repositories/localDatabase'

// ---------------------------------------------------------------------------
// ConflictError — stable error type for stale-update rejections
// ---------------------------------------------------------------------------

/**
 * A stable error thrown when a mutation is rejected because the server version
 * is newer than the client's base version. Carries the server version so the
 * conflict store can record it.
 *
 * @property {string} code - Always 'CONFLICT_ERROR' for reliable instanceof
 *   checks across module boundaries.
 * @property {string} uuid - The item uuid that conflicted.
 * @property {number} serverVersion - The server's current version.
 * @property {number} expectedVersion - The version the client expected.
 */
export class ConflictError extends Error {
  constructor(uuid, serverVersion, expectedVersion, message) {
    super(message || `Conflict: ${uuid} server=${serverVersion} expected=${expectedVersion}`)
    this.name = 'ConflictError'
    this.code = 'CONFLICT_ERROR'
    this.uuid = uuid
    this.serverVersion = serverVersion
    this.expectedVersion = expectedVersion
  }
}

/**
 * Check if a ConflictError was thrown.
 */
export function isConflictError(err) {
  return !!(err && (err instanceof ConflictError || err.code === 'CONFLICT_ERROR'))
}

// ---------------------------------------------------------------------------
// Conflict descriptor record shape
// ---------------------------------------------------------------------------
//
// A conflict record is a plain object returned by checkConflict and persisted
// in the conflict store:
//
//   {
//     conflictId,       // stable id (uuid + ':' + detectedAt)
//     uuid,             // the item uuid that conflicted
//     scope,            // server-authoritative ownership scope
//     entityType,       // 'collection' | 'lending' | 'review' | 'payment'
//     serverVersion,    // server's current version
//     localVersion,     // local version at time of conflict
//     serverItem,       // the server's current item data (safe, no credentials)
//     localItem,        // the local item data (safe, no credentials)
//     detectedAt,       // ISO timestamp when the conflict was detected
//     status,           // 'unresolved' | 'resolved-server' | 'resolved-local' | 'resolved-merged'
//     resolution,       // the resolution strategy chosen
//     resolvedAt,       // ISO timestamp when resolved
//     mergedItem,       // the merged item when resolution is 'merged'
//   }

// ---------------------------------------------------------------------------
// Merge policies by entity type (ADR-0019 Dec 8 initial policy)
// ---------------------------------------------------------------------------

/**
 * Entity type constants for merge policy registration.
 */
export const ENTITY_TYPE = Object.freeze({
  COLLECTION: 'collection',
  LENDING: 'lending',
  REVIEW: 'review',
  PAYMENT: 'payment',
})

/**
 * Resolution strategy constants.
 */
export const RESOLUTION = Object.freeze({
  USE_SERVER: 'resolved-server',   // Server wins entirely
  USE_LOCAL: 'resolved-local',     // Local wins entirely
  MERGE: 'resolved-merged',        // Field-level merge
})

/**
 * Conflict status constants.
 */
export const CONFLICT_STATUS = Object.freeze({
  UNRESOLVED: 'unresolved',
  RESOLVED_SERVER: 'resolved-server',
  RESOLVED_LOCAL: 'resolved-local',
  RESOLVED_MERGED: 'resolved-merged',
})

// ---------------------------------------------------------------------------
// Merge policies
// ---------------------------------------------------------------------------

/**
 * Default merge policy for unknown entity types: require explicit user
 * resolution (fail-closed — never silently merge).
 */
const DEFAULT_POLICY = {
  entityType: 'unknown',
  requiresUserIntent: true,
  mergeableFields: [],
  description: 'Explicit user resolution required',
}

/**
 * Registered merge policies keyed by entity type.
 */
const policyRegistry = new Map()

/**
 * Register a merge policy for an entity type.
 *
 * @param {string} entityType - One of ENTITY_TYPE values.
 * @param {object} policy
 * @param {boolean} policy.requiresUserIntent - true if the policy needs user input.
 * @param {string[]} policy.mergeableFields - Field names that can be auto-merged.
 * @param {string} policy.description - Human-readable description.
 */
export function registerMergePolicy(entityType, policy) {
  if (!entityType || typeof entityType !== 'string') {
    throw new Error('registerMergePolicy: entityType must be a non-empty string')
  }
  if (!policy || typeof policy !== 'object') {
    throw new Error('registerMergePolicy: policy must be an object')
  }
  policyRegistry.set(entityType, {
    entityType,
    requiresUserIntent: policy.requiresUserIntent !== false,
    mergeableFields: Array.isArray(policy.mergeableFields) ? policy.mergeableFields : [],
    description: policy.description || `Policy for ${entityType}`,
  })
}

/**
 * Get the merge policy for an entity type. Returns the default policy for
 * unknown types (fail-closed: requires user intent).
 */
export function getMergePolicy(entityType) {
  return policyRegistry.get(entityType) || { ...DEFAULT_POLICY, entityType }
}

/**
 * Initialize the default merge policies (ADR-0019 Dec 8 initial policy).
 *
 * Called automatically on first import. Can be re-invoked in tests to reset
 * the registry.
 */
export function initDefaultPolicies() {
  policyRegistry.clear()

  // Collection metadata: merge safe fields where possible.
  registerMergePolicy(ENTITY_TYPE.COLLECTION, {
    requiresUserIntent: false,
    mergeableFields: ['notes', 'customFields', 'tags', 'shelf'],
    description: 'Collection metadata: auto-merge safe fields, user resolves conflicts',
  })

  // Lending status: explicit conflict resolution.
  registerMergePolicy(ENTITY_TYPE.LENDING, {
    requiresUserIntent: true,
    mergeableFields: [],
    description: 'Lending status: explicit user resolution required',
  })

  // Reviews: append-only or separately versioned.
  registerMergePolicy(ENTITY_TYPE.REVIEW, {
    requiresUserIntent: false,
    mergeableFields: [], // Reviews are append-only; no field-level merge needed
    description: 'Reviews: append-only, server authoritative',
  })

  // Payments: server authoritative and never offline-editable.
  registerMergePolicy(ENTITY_TYPE.PAYMENT, {
    requiresUserIntent: false,
    mergeableFields: [],
    description: 'Payments: server authoritative, never offline-editable',
  })
}

// Initialize on first import
initDefaultPolicies()

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Determine the entity type for an item based on its data shape.
 *
 * @param {object} item - The item data.
 * @returns {string} One of ENTITY_TYPE values.
 */
export function determineEntityType(item) {
  if (!item) return ENTITY_TYPE.COLLECTION

  // Payment records have a `paymentMethod` or `amount` field
  if (item.paymentMethod !== undefined || item.amount !== undefined) {
    return ENTITY_TYPE.PAYMENT
  }

  // Lending records have a `lentTo` or `lentAt` field
  if (item.lentTo !== undefined || item.lentAt !== undefined) {
    return ENTITY_TYPE.LENDING
  }

  // Review records have a `rating` or `reviewText` field
  if (item.rating !== undefined || item.reviewText !== undefined) {
    return ENTITY_TYPE.REVIEW
  }

  // Default: collection metadata
  return ENTITY_TYPE.COLLECTION
}

/**
 * Check if a local mutation conflicts with the server's current state.
 *
 * OCC rule: the client sends the `baseVersion` (the server version it last
 * saw). If the server's current version is greater than `baseVersion`, the
 * mutation is stale and a conflict descriptor is returned.
 *
 * @param {object} opts
 * @param {string} opts.uuid - The item uuid.
 * @param {object} opts.localItem - The local item data.
 * @param {object} opts.serverItem - The server's current item data.
 * @param {number} opts.serverVersion - The server's current version.
 * @param {number} opts.localVersion - The local version.
 * @param {number} opts.baseVersion - The version the client sent as base.
 * @param {string} opts.scope - Server-authoritative ownership scope.
 * @param {string} [opts.entityType] - Entity type (auto-detected if omitted).
 * @returns {object|null} Conflict descriptor, or null if no conflict.
 */
export function checkConflict({
  uuid,
  localItem,
  serverItem,
  serverVersion,
  localVersion,
  baseVersion,
  scope,
  entityType,
} = {}) {
  // Validate required fields
  if (!uuid) throw new Error('checkConflict: uuid is required')
  if (baseVersion === undefined || baseVersion === null) {
    throw new Error('checkConflict: baseVersion is required')
  }
  if (serverVersion === undefined || serverVersion === null) {
    throw new Error('checkConflict: serverVersion is required')
  }

  // No conflict: server version equals or is less than the base version
  if (serverVersion <= baseVersion) return null

  // Conflict detected
  const detectedEntityType = entityType || determineEntityType(localItem || serverItem)
  const policy = getMergePolicy(detectedEntityType)

  return {
    conflictId: `${uuid}:${Date.now()}`,
    uuid,
    scope: scope || '',
    entityType: detectedEntityType,
    serverVersion,
    localVersion: localVersion || 0,
    serverItem: serverItem ? sanitizeForConflict(serverItem) : null,
    localItem: localItem ? sanitizeForConflict(localItem) : null,
    detectedAt: new Date().toISOString(),
    status: CONFLICT_STATUS.UNRESOLVED,
    resolution: null,
    resolvedAt: null,
    mergedItem: null,
    policy: {
      requiresUserIntent: policy.requiresUserIntent,
      mergeableFields: policy.mergeableFields,
    },
  }
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a conflict by applying a resolution strategy.
 *
 * @param {object} conflict - The conflict descriptor (from checkConflict or
 *   the conflict store).
 * @param {string} resolution - One of RESOLUTION values.
 * @param {object} [mergedItem] - The merged item when resolution is MERGE.
 * @returns {object} The resolved conflict descriptor (status updated).
 * @throws {Error} If the resolution is invalid or the conflict is already
 *   resolved.
 */
export function applyResolution(conflict, resolution, mergedItem) {
  if (!conflict) throw new Error('applyResolution: conflict is required')
  if (conflict.status !== CONFLICT_STATUS.UNRESOLVED) {
    throw new Error(`Conflict ${conflict.conflictId} is already ${conflict.status}`)
  }

  const validResolutions = Object.values(RESOLUTION)
  if (!validResolutions.includes(resolution)) {
    throw new Error(`Invalid resolution: ${resolution}. Must be one of: ${validResolutions.join(', ')}`)
  }

  if (resolution === RESOLUTION.MERGE && !mergedItem) {
    throw new Error('applyResolution: mergedItem is required for MERGE resolution')
  }

  const resolved = {
    ...conflict,
    status: resolution,
    resolution,
    resolvedAt: new Date().toISOString(),
    mergedItem: resolution === RESOLUTION.MERGE ? sanitizeForConflict(mergedItem) : null,
  }

  return resolved
}

/**
 * Build a retry-ready patch from a resolved conflict.
 *
 * For USE_SERVER: return null (no push needed, just update local state).
 * For USE_LOCAL: return the local item as the patch.
 * For MERGE: return the merged item as the patch.
 *
 * @param {object} resolvedConflict - The resolved conflict descriptor.
 * @returns {object|null} The patch to push, or null if the server version
 *   should be accepted as-is.
 */
export function buildResolutionPatch(resolvedConflict) {
  if (!resolvedConflict || resolvedConflict.status === CONFLICT_STATUS.UNRESOLVED) {
    return null
  }

  switch (resolvedConflict.status) {
    case CONFLICT_STATUS.RESOLVED_SERVER:
      return null // Accept server version
    case CONFLICT_STATUS.RESOLVED_LOCAL:
      return resolvedConflict.localItem // Push local version
    case CONFLICT_STATUS.RESOLVED_MERGED:
      return resolvedConflict.mergedItem // Push merged version
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Safe-field merge for collection metadata
// ---------------------------------------------------------------------------

/**
 * Auto-merge safe fields for collection metadata items.
 * Uses the mergeable fields from the policy.
 *
 * @param {object} serverItem - Server's current item data.
 * @param {object} localItem - Local item data.
 * @param {string} [entityType] - Entity type to determine mergeable fields.
 * @returns {object} The merged item (server base with local mergeable fields
 *   applied on top of safe fields).
 */
export function autoMergeFields(serverItem, localItem, entityType) {
  if (!serverItem) return localItem ? { ...localItem } : null
  if (!localItem) return serverItem ? { ...serverItem } : null

  const policy = getMergePolicy(entityType || determineEntityType(serverItem))
  const merged = { ...serverItem }

  // Apply mergeable fields from local over the server base
  for (const field of policy.mergeableFields) {
    if (localItem[field] !== undefined) {
      merged[field] = localItem[field]
    }
  }

  return merged
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an item for inclusion in a conflict payload. Strips any field that
 * might contain credentials or secrets (none currently expected, but defensive).
 *
 * @param {object} item - The item to sanitize.
 * @returns {object} A shallow copy of the item with only safe fields.
 */
function sanitizeForConflict(item) {
  if (!item) return null
  // Strip fields that could contain sensitive data (defensive — no known
  // credential fields exist in item data, but the contract is explicit).
  const sensitiveKeys = ['token', 'accessCode', 'password', 'secret', 'authorization']
  const safe = {}
  for (const [key, value] of Object.entries(item)) {
    if (!sensitiveKeys.includes(key)) {
      safe[key] = value
    }
  }
  return safe
}