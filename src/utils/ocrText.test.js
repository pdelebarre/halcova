import { describe, expect, it } from 'vitest'
import { extractSearchQuery } from './ocrText'

// Helpers to build a fake Tesseract line quickly.
function line(text, { confidence = 80, area = 1000 } = {}) {
  // bbox area is driven by width × height so tests read naturally.
  const side = Math.sqrt(area)
  return {
    text,
    confidence,
    bbox: { x0: 0, y0: 0, x1: side, y1: side, width: side, height: side },
  }
}

describe('extractSearchQuery', () => {
  it('combines the two largest readable lines into a records query', () => {
    const lines = [
      line('Miles Davis', { area: 5000 }),
      line('Kind of Blue', { area: 3000 }),
      line('Columbia', { area: 800 }), // label small print
    ]
    const { query, barcode } = extractSearchQuery(lines, 'records')
    expect(query).toBe('Miles Davis Kind of Blue')
    expect(barcode).toBe('')
  })

  it('puts the title first for books (largest line = title, second = author)', () => {
    const lines = [
      line('The Great Gatsby', { area: 4000 }),
      line('F. Scott Fitzgerald', { area: 2000 }),
    ]
    const { query } = extractSearchQuery(lines, 'books')
    expect(query).toBe('The Great Gatsby F. Scott Fitzgerald')
  })

  it('uses a single usable line as the whole query', () => {
    const lines = [line('Pet Sounds', { area: 3000 })]
    const { query } = extractSearchQuery(lines, 'records')
    expect(query).toBe('Pet Sounds')
  })

  it('drops low-confidence lines', () => {
    const lines = [
      line('Miles Davis', { area: 5000 }),
      line('Kind of Blue', { area: 3000, confidence: 30 }),
    ]
    const { query } = extractSearchQuery(lines, 'records')
    expect(query).toBe('Miles Davis')
  })

  it('drops copyright / rights / production small print', () => {
    const lines = [
      line('The Wall', { area: 4000 }),
      line('© 1979 Pink Floyd Music Ltd. All Rights Reserved', { area: 900 }),
      line('Produced by Bob Ezrin, David Gilmour and Roger Waters', { area: 700 }),
      line('1979', { area: 500 }),
    ]
    const { query } = extractSearchQuery(lines, 'records')
    expect(query).toBe('The Wall')
  })

  it('extracts a visible EAN-13 barcode and strips it to digits', () => {
    const lines = [
      line('Kind of Blue', { area: 3000 }),
      line('0 76732-57341-2 9', { area: 1200 }),
    ]
    const { query, barcode } = extractSearchQuery(lines, 'records')
    expect(barcode).toBe('0767325734129')
    expect(query).toBe('Kind of Blue')
  })

  it('extracts a barcode even when the text lines are too noisy to use', () => {
    const lines = [
      line('© 1982 All Rights Reserved', { confidence: 40 }),
      line('0 76732-57341-2 9', { confidence: 45 }),
    ]
    const { query, barcode } = extractSearchQuery(lines, 'records')
    expect(query).toBe('')
    expect(barcode).toBe('0767325734129')
  })

  it('returns empty query and barcode when nothing readable survives', () => {
    const lines = [
      line('© 2020 All Rights Reserved', { area: 4000 }),
      line('Printed in Canada', { area: 900 }),
    ]
    expect(extractSearchQuery(lines, 'records')).toEqual({ query: '', barcode: '' })
  })

  it('tolerates missing confidence and bbox (never crashes)', () => {
    const lines = [{ text: 'Abbey Road' }, { text: 'The Beatles' }]
    const { query } = extractSearchQuery(lines, 'records')
    expect(query).toBe('The Beatles Abbey Road')
  })

  it('returns empty for empty or non-array input', () => {
    expect(extractSearchQuery([], 'records')).toEqual({ query: '', barcode: '' })
    expect(extractSearchQuery(null, 'records')).toEqual({ query: '', barcode: '' })
    expect(extractSearchQuery(undefined, 'books')).toEqual({ query: '', barcode: '' })
  })

  // An X check digit on a 10+ digit code still extracts (spaces/hyphens
  // stripped) — the ISBN-10/13 form with a digit-or-X check digit.
  it('extracts a code with an X check digit, stripping spaces/hyphens', () => {
    const lines = [
      line("The Handmaid's Tale", { area: 4000 }),
      line('1 23456 78901 X', { area: 900 }),
    ]
    const { query, barcode } = extractSearchQuery(lines, 'books')
    expect(barcode).toBe('12345678901X')
    expect(query).toBe("The Handmaid's Tale")
  })

  // A standard ISBN-10 whose check digit is X is 9 digits + X ("0 14 028333 X").
  // The 9-digit form is only treated as a barcode when it carries the X check
  // digit, so it now extracts instead of leaking into the search query.
  it('extracts an ISBN-10 with an X check digit (9 digits + X)', () => {
    const lines = [
      line("The Handmaid's Tale", { area: 4000 }),
      line('0 14 028333 X', { area: 900 }),
    ]
    const { query, barcode } = extractSearchQuery(lines, 'books')
    expect(barcode).toBe('014028333X')
    expect(query).toBe("The Handmaid's Tale")
  })

  // Regression: a bare 9-digit run (no X) is ambiguous with a truncated UPC /
  // EAN-8 and must NOT be flagged as a barcode — it stays plain text.
  it('does not treat a bare 9-digit number as a barcode', () => {
    const { query, barcode } = extractSearchQuery(
      [line('123456789', { confidence: 95, area: 5000 })],
      'records'
    )
    expect(barcode).toBe('')
    expect(query).toBe('123456789')
  })

  it('returns just the barcode when the cover shows only a code and no readable text', () => {
    const lines = [line('0 76732-57341-2 9', { confidence: 90, area: 5000 })]
    expect(extractSearchQuery(lines, 'records')).toEqual({ query: '', barcode: '0767325734129' })
  })

  it('never fabricates a query from lone years or catalog numbers', () => {
    const lines = [
      line('1978', { confidence: 95, area: 6000 }),
      line('ST-61234', { confidence: 95, area: 5000 }),
    ]
    expect(extractSearchQuery(lines, 'records')).toEqual({ query: '', barcode: '' })
  })

  it('does not mistake a copyright-year line for a barcode', () => {
    const { barcode } = extractSearchQuery([line('© 2024 Sony Music', { confidence: 90 })], 'records')
    expect(barcode).toBe('')
  })

  it('tolerates empty and malformed line shapes without crashing', () => {
    const lines = [{ text: '' }, { text: '   ' }, null, undefined, 'junk', 42]
    expect(extractSearchQuery(lines, 'records')).toEqual({ query: '', barcode: '' })
  })

  it('ranks by x-span when a line has bbox coordinates but no width/height', () => {
    const lines = [
      { text: 'Miles Davis', confidence: 80, bbox: { x0: 0, x1: 500 } },
      { text: 'Kind of Blue', confidence: 80, bbox: { x0: 0, x1: 300 } },
    ]
    const { query } = extractSearchQuery(lines, 'records')
    expect(query).toBe('Miles Davis Kind of Blue')
  })
})
