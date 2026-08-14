// @vitest-environment node
//
// Repository-selection tests: getRepository() must return the Blobs backend
// when DATABASE_URL is absent (today's behavior) and the Postgres backend when
// it is set — the transparent switch that keeps every existing function working
// unchanged. No connection is made (the repo is lazy).

import { afterEach, describe, expect, it } from 'vitest'
import { __resetRepositoryForTests, getRepository } from './repository'

const original = process.env.DATABASE_URL

afterEach(() => {
  process.env.DATABASE_URL = original
  __resetRepositoryForTests()
})

describe('getRepository() — backend selection by DATABASE_URL', () => {
  it('returns the Blobs backend when DATABASE_URL is absent', () => {
    delete process.env.DATABASE_URL
    __resetRepositoryForTests()
    const repo = getRepository()
    expect(repo.backend).toBe('blobs')
    expect(repo.items).toBeNull()
    expect(repo.lookupCache).toBeNull()
    // The users repo delegates to the Blobs identity implementation.
    expect(typeof repo.users.findUserByCode).toBe('function')
  })

  it('returns the Postgres backend when DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://localhost:5432/runout'
    __resetRepositoryForTests()
    const repo = getRepository()
    expect(repo.backend).toBe('postgres')
    expect(repo.items).toBeTruthy()
    expect(repo.lookupCache).toBeTruthy()
    expect(typeof repo.users.findUserByCode).toBe('function')
  })
})
