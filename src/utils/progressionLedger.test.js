import { describe, expect, it, beforeEach } from 'vitest'
import { addQuizXp, readLedger, recordQuizResult, writeLedger } from './progressionLedger'

describe('progressionLedger', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads an empty ledger as zeroed state', () => {
    expect(readLedger('records')).toEqual({ quizXp: 0, perfectDays: [], quizDays: [] })
  })

  it('adds quiz XP and persists it per kind', () => {
    expect(addQuizXp('records', 30)).toBe(30)
    expect(readLedger('records').quizXp).toBe(30)
    // Books are isolated from records.
    expect(readLedger('books').quizXp).toBe(0)
  })

  it('records a quiz round: +10 per correct, tracks the day and a perfect day', () => {
    const partial = recordQuizResult('records', { day: '2026-06-15', correct: 3, total: 4 })
    expect(partial.quizXp).toBe(30)
    expect(partial.quizDays).toEqual(['2026-06-15'])
    expect(partial.perfectDays).toEqual([])

    const perfect = recordQuizResult('records', { day: '2026-06-16', correct: 4, total: 4 })
    expect(perfect.quizXp).toBe(70)
    expect(perfect.perfectDays).toEqual(['2026-06-16'])
  })

  it('ignores negative/NaN amounts instead of corrupting the ledger', () => {
    addQuizXp('records', -50)
    addQuizXp('records', 'not-a-number')
    expect(readLedger('records').quizXp).toBe(0)
  })

  it('writeLedger merges a patch', () => {
    writeLedger('records', { quizXp: 10 })
    writeLedger('records', { perfectDays: ['2026-06-15'] })
    const l = readLedger('records')
    expect(l.quizXp).toBe(10)
    expect(l.perfectDays).toEqual(['2026-06-15'])
  })

  it('never throws on corrupt storage', () => {
    localStorage.setItem('runout.gamif.ledger.records', 'not-json{{')
    expect(() => readLedger('records')).not.toThrow()
    expect(readLedger('records').quizXp).toBe(0)
    expect(() => writeLedger('records', { quizXp: 5 })).not.toThrow()
    expect(readLedger('records').quizXp).toBe(5)
  })
})
