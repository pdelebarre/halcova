import { describe, expect, it, beforeEach } from 'vitest'
import { isTrackingEnabled, setTrackingEnabled, track, flushEvents, clearEvents } from './track'

const EVENTS_KEY = 'runout.events'
const ENABLED_KEY = 'runout.events.enabled'

function readQueue() {
  return JSON.parse(localStorage.getItem(EVENTS_KEY) || '[]')
}

describe('track instrumentation (default-OFF, first-party)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    document.body.innerHTML = ''
  })

  it('is disabled by default and only turns on via setTrackingEnabled(true)', () => {
    expect(isTrackingEnabled()).toBe(false)
    expect(localStorage.getItem(ENABLED_KEY)).toBeNull()
    setTrackingEnabled(true)
    expect(isTrackingEnabled()).toBe(true)
    expect(localStorage.getItem(ENABLED_KEY)).toBe('1')
    setTrackingEnabled(false)
    expect(isTrackingEnabled()).toBe(false)
  })

  it('is a no-op while tracking is off — nothing is queued', () => {
    track('gamif_persona_generated', { kind: 'records' })
    expect(localStorage.getItem(EVENTS_KEY)).toBeNull()
  })

  it('queues an event with a timestamp once enabled', () => {
    setTrackingEnabled(true)
    track('gamif_persona_generated', { kind: 'records', shared: false })
    const queue = readQueue()
    expect(queue).toHaveLength(1)
    expect(queue[0].event).toBe('gamif_persona_generated')
    expect(queue[0].props).toEqual({ kind: 'records', shared: false })
    expect(typeof queue[0].ts).toBe('string')
    expect(Number.isNaN(Date.parse(queue[0].ts))).toBe(false)
  })

  it('records activation after the first successful owned-item add', () => {
    setTrackingEnabled(true)
    track('gamif_item_added', { kind: 'records', source: 'scan' })
    const queue = readQueue()
    expect(queue).toHaveLength(2)
    expect(queue[0].event).toBe('gamif_item_added')
    expect(queue[1].event).toBe('activation')
    expect(queue[1].props).toEqual({ kind: 'records', source: 'scan' })
  })

  it('records activation only once per browser session', () => {
    setTrackingEnabled(true)
    track('gamif_item_added', { kind: 'records', source: 'manual' })
    track('gamif_item_added', { kind: 'records', source: 'scan' })
    const queue = readQueue()
    expect(queue.filter((entry) => entry.event === 'activation')).toHaveLength(1)
  })

  it('does not leak identifying add data into the activation event', () => {
    setTrackingEnabled(true)
    track('gamif_item_added', {
      kind: 'books',
      source: 'scan',
      title: 'A private title',
      artist: 'A private artist',
      barcode: '1234567890128',
      isbn: '9783161484100',
      token: 'secret-token',
    })
    const activation = readQueue().find((entry) => entry.event === 'activation')
    expect(activation.props).toEqual({ kind: 'books', source: 'scan' })
  })

  it('queues one browse event per collection kind when tracking is enabled', async () => {
    setTrackingEnabled(true)
    const root = document.createElement('div')
    root.className = 'collection-view'
    root.dataset.kind = 'records'
    document.body.appendChild(root)
    await new Promise((resolve) => queueMicrotask(resolve))
    await new Promise((resolve) => queueMicrotask(resolve))

    expect(readQueue().filter((entry) => entry.event === 'browse')).toEqual([
      expect.objectContaining({ props: { kind: 'records' } }),
    ])

    const remount = document.createElement('div')
    remount.className = 'collection-view'
    remount.dataset.kind = 'records'
    document.body.appendChild(remount)
    await new Promise((resolve) => queueMicrotask(resolve))
    expect(readQueue().filter((entry) => entry.event === 'browse')).toHaveLength(1)
  })

  it('does not queue browse events when tracking is disabled', async () => {
    const root = document.createElement('div')
    root.className = 'collection-view'
    root.dataset.kind = 'books'
    document.body.appendChild(root)
    await new Promise((resolve) => queueMicrotask(resolve))
    expect(localStorage.getItem(EVENTS_KEY)).toBeNull()
  })

  it('does not leak identifying browse data', () => {
    setTrackingEnabled(true)
    track('browse', {
      kind: 'records',
      title: 'A private title',
      artist: 'A private artist',
      barcode: '1234567890128',
      isbn: '9783161484100',
      token: 'secret-token',
    })
    expect(readQueue()[0].props).toEqual({ kind: 'records' })
  })

  it('sanitizes props — drops code/token/key/secret/barcode/isbn/pin/cipher/credential keys and nested objects', () => {
    setTrackingEnabled(true)
    track('gamif_share_exported', {
      kind: 'records',
      code: 'RU-1234-5678-9012',
      accessCode: 'secret',
      token: 'abc',
      apiKey: 'key',
      secret: 's3cr3t',
      barcode: '1234567890128',
      isbn: '9783161484100',
      pin: '1234',
      cipher: 'abc123',
      authToken: 'tok',
      nested: { deep: true },
      items: [1, 2, 3],
    })
    const props = readQueue()[0].props
    expect(props).toEqual({ kind: 'records' })
  })

  it('caps the queue at 500 events, dropping the oldest', () => {
    setTrackingEnabled(true)
    for (let i = 0; i < 505; i += 1) track('e', { i })
    const queue = readQueue()
    expect(queue).toHaveLength(500)
    expect(queue[0].props.i).toBe(5)
    expect(queue[queue.length - 1].props.i).toBe(504)
  })

  it('never throws on corrupt stored JSON and recovers with a fresh queue', () => {
    setTrackingEnabled(true)
    localStorage.setItem(EVENTS_KEY, '{not valid json')
    expect(() => track('e', { a: 1 })).not.toThrow()
    expect(readQueue()).toHaveLength(1)
  })

  it('treats a non-array stored queue as empty', () => {
    setTrackingEnabled(true)
    localStorage.setItem(EVENTS_KEY, '"a string"')
    expect(() => track('e', { a: 1 })).not.toThrow()
  })

  it('ignores a missing or non-string event name', () => {
    setTrackingEnabled(true)
    track()
    track(42)
    expect(readQueue()).toHaveLength(0)
  })

  it('flushEvents is a safe no-op placeholder and clearEvents empties the queue', () => {
    setTrackingEnabled(true)
    track('a', { x: 1 })
    expect(() => flushEvents()).not.toThrow()
    expect(readQueue()).toHaveLength(1)
    clearEvents()
    expect(localStorage.getItem(EVENTS_KEY)).toBeNull()
    expect(sessionStorage.getItem('runout.events.activation')).toBeNull()
    expect(sessionStorage.getItem('runout.events.browse.records')).toBeNull()
    expect(sessionStorage.getItem('runout.events.browse.books')).toBeNull()
  })
})
