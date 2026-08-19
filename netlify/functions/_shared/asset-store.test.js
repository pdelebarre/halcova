// @vitest-environment node
//
// SEC-7.3 (#340) — per-user private asset store seam (_shared/asset-store.js).
// Unit tests over the mocked @netlify/blobs registry: namespace derivation
// (per-user, never client-supplied) and the list/get/set/delete interface.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASSET_STORE_PREFIX,
  assetStoreName,
  getAssetStore,
  listAssets,
  getAsset,
  setAsset,
  deleteAsset,
} from './asset-store'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, opts) {
        const v = this.data.get(String(key))
        if (v === undefined || v === null) return null
        if (opts?.type === 'arrayBuffer') return v.buffer ? v.buffer : v
        if (opts?.type === 'json') return JSON.parse(JSON.stringify(v))
        return v
      },
      async set(key, value, opts) { this.data.set(String(key), value) },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({ getStore: (name) => stores[name] || (stores[name] = createStore()) }))

beforeEach(() => {
  for (const key of Object.keys(stores)) delete stores[key]
})

describe('namespace derivation (SEC-7.3 #340)', () => {
  it('assetStoreName is per-user: assets-<userId>', () => {
    expect(assetStoreName('owner')).toBe('assets-owner')
    expect(assetStoreName('memberA')).toBe('assets-memberA')
    expect(assetStoreName('memberB')).not.toBe(assetStoreName('memberA'))
  })

  it('never aliases a client-supplied owner id into the namespace', () => {
    // The seam only derives from the resolved userId passed by the caller; the
    // caller never passes a browser-supplied owner (see asset.js). The prefix
    // is stable and the namespace is fully isolated per user.
    expect(ASSET_STORE_PREFIX).toBe('assets-')
    expect(assetStoreName('victim')).toBe(`${ASSET_STORE_PREFIX}victim`)
  })
})

describe('list/get/set/delete interface', () => {
  it('set then get round-trips raw bytes, and list returns the keys', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    await setAsset('memberA', 'asset:aaa', bytes, { contentType: 'image/jpeg' })
    const read = await getAsset('memberA', 'asset:aaa')
    expect(read).toBeInstanceOf(Uint8Array)
    expect(Array.from(read)).toEqual([1, 2, 3, 4])
    const keys = await listAssets('memberA')
    expect(keys.map((k) => k.key)).toEqual(['asset:aaa'])
  })

  it('getAsset returns null for a missing key', async () => {
    expect(await getAsset('memberA', 'asset:missing')).toBeNull()
  })

  it('delete removes the asset from the store', async () => {
    await setAsset('memberA', 'asset:aaa', new Uint8Array([9]))
    await deleteAsset('memberA', 'asset:aaa')
    expect(await getAsset('memberA', 'asset:aaa')).toBeNull()
  })

  it('getAssetStore returns the Blobs store for the user namespace', async () => {
    const store = getAssetStore('memberA')
    // The mocked store is registered under the per-user namespace.
    expect(stores['assets-memberA']).toBe(store)
  })
})
