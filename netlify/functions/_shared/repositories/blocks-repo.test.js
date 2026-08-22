// @vitest-environment node
//
// blocks-repo.test.js — stub test for the Postgres blocks repository
// (FEAT-8.2, #327). The standalone stub currently returns false for all
// queries. When #330 lands, these tests will be updated to test real
// block relationships.

import { describe, it, expect } from 'vitest'
import { createBlocksRepo } from './blocks-repo'

describe('blocks-repo', () => {
  // Passing null as db since the stub never calls db methods.
  const repo = createBlocksRepo(null)

  describe('isBlocked', () => {
    it('returns false (stub) for any pair of users', async () => {
      expect(await repo.isBlocked('user-a', 'user-b')).toBe(false)
    })

    it('returns false (stub) for self-check', async () => {
      expect(await repo.isBlocked('user-a', 'user-a')).toBe(false)
    })

    it('returns false (stub) for null ids', async () => {
      expect(await repo.isBlocked(null, 'user-b')).toBe(false)
      expect(await repo.isBlocked('user-a', null)).toBe(false)
    })
  })
})