// collection-types.js — FEAT-6.2 #315: READ-ONLY Collection Type Registry API.
//
// Serves the server-authoritative registry metadata (labels, icons,
// capabilities, provider mappings, field schema) for the client to render.
// SECURITY CONTRACT (ADR-0020 §2 dec 6, ADR-0010):
//   * The client can only READ type definitions — it can never supply, override
//     or redefine a type/capability/field definition. This function reads from
//     the `collection_types`/`collection_type_fields` tables (which app_rls is
//     granted SELECT-only) and never reads a type definition from the request.
//   * Only GET is allowed; any request body is ignored (there is no write path).
//   * Unknown types are rejected with a stable 404 UNKNOWN_TYPE.
//   * Output is an explicit allowlist projection (toPublicTypeView) that is
//     XSS-safe to render.
//
//   GET /.netlify/functions/collection-types                 -> all types
//   GET /.netlify/functions/collection-types?type=records    -> one type
//   Any non-GET method -> 405 (no write path exists).

import { enforce } from './_shared/policy'
import { json } from './_shared/security'
import { isPostgresConfigured, getPool } from './_shared/postgres'
import { createCollectionTypeRepository, toPublicTypeView, REGISTRY_ERROR } from './_shared/collection-type-registry'

export default async (req) => {
  const url = new URL(req.url)
  const type = url.searchParams.get('type')

  // Read-only: any authenticated caller may read the registry. Demo is not
  // denied (it reads labels/icons/capabilities like everyone else).
  const { error } = await enforce(req, 'collection:type:read')
  if (error) return error

  // Only GET. The registry is read-only; there is no POST/PUT/DELETE path and
  // no type definition is ever accepted from the request body.
  if (req.method !== 'GET') {
    return json(405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' })
  }

  if (!isPostgresConfigured()) {
    return json(503, { error: 'The collection registry is temporarily unavailable.', code: 'DATA_SOURCE_UNAVAILABLE' })
  }

  let repo
  try {
    repo = createCollectionTypeRepository({ db: getPool() })
    if (type) {
      const def = await repo.getById(type)
      if (!def) {
        return json(404, { error: `Unknown collection type: ${type}`, code: REGISTRY_ERROR.UNKNOWN_TYPE })
      }
      return json(200, { collectionType: toPublicTypeView(def) })
    }
    const types = await repo.list()
    return json(200, { collectionTypes: types.map(toPublicTypeView) })
  } catch (err) {
    // Operational alert (message only — never a code/token/key/secret).
    console.error('collection-types: registry unavailable (503):', err?.message || err)
    return json(503, { error: 'The collection registry is temporarily unavailable.', code: 'DATA_SOURCE_UNAVAILABLE' })
  }
}
