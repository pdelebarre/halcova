// M2 #158 — Mirror Repository tests.
//
// The mirror repository is a thin wrapper around offlineMirror.js. These tests
// verify the delegation works correctly.
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  saveMirror,
  readMirror,
  findDuplicatesInMirror,
  clearMirrorForUser,
  clearAllMirror,
} from './mirrorRepository'
import { establishOfflineTrust, sessionFingerprint } from '../utils/offlineTrust'

const USER_A = { id: 'u1', name: 'Ada', role: 'member' }
const TOKEN_A = 'tok-a'
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

const ITEM = {
  id: 'r1',
  serverId: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
}

function trustUser(user, token, now = NOW) {
  establishOfflineTrust(user, { now, sessionFp: sessionFingerprint(token) })
}

beforeEach(async () => {
  localStorage.clear()
  await clearAllMirror()
})

describe('mirrorRepository — delegation to offlineMirror', () => {
  it('saveMirror and readMirror round-trip', async () => {
    trustUser(USER_A, TOKEN_A)
    const ok = await saveMirror(USER_A.id, [ITEM], { now: NOW })
    expect(ok).toBe(true)

    const mirror = await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A })
    expect(mirror).not.toBeNull()
    expect(mirror.items).toHaveLength(1)
    expect(mirror.items[0].title).toBe('Miles Davis - Kind of Blue')
  })

  it('findDuplicatesInMirror delegates correctly', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [ITEM], { now: NOW })

    const result = await findDuplicatesInMirror(
      USER_A.id,
      { title: 'Miles Davis - Kind of Blue', discogsId: 111 },
      { now: NOW + 1000, token: TOKEN_A },
    )
    expect(result).not.toBeNull()
  })

  it('clearMirrorForUser clears only that user', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [ITEM], { now: NOW })
    await clearMirrorForUser(USER_A.id)

    trustUser(USER_A, TOKEN_A)
    const mirror = await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A })
    expect(mirror).toBeNull()
  })

  it('clearAllMirror clears everything', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [ITEM], { now: NOW })
    await clearAllMirror()

    trustUser(USER_A, TOKEN_A)
    const mirror = await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A })
    expect(mirror).toBeNull()
  })
})