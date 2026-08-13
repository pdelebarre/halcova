// Pure helpers for the "Aisles" browse layer (§ Phase 2) — browse axes,
// bin counting and bin filtering. Kept side-effect-free so they're trivially
// unit-testable (see testing skill: pure logic lives in src/utils).

/** Bucket a year into a decade label, e.g. 1963 → "1960s". Unknown → "Other". */
export function decadeOf(year) {
  const y = Number(year)
  if (!Number.isFinite(y) || y <= 0) return 'Other'
  return `${Math.floor(y / 10) * 10}s`
}

/**
 * Distinct bin values across items for an axis, each with a count, A–Z sorted.
 * An axis exposes `value(item) -> string[]` (an item can sit in several bins,
 * e.g. multiple genres). Empty/blank values are skipped.
 */
export function binCounts(items, axis) {
  const counts = new Map()
  for (const item of items) {
    for (const v of axis.value(item)) {
      if (v == null || String(v).trim() === '') continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value)))
}

/** Does an item fall into a given bin for an axis? */
export function itemInBin(item, axis, value) {
  return axis.value(item).includes(value)
}

/**
 * Count the values returned by `getValues(item)` across items, sorted by
 * count descending (ties broken alphabetically). Used by the stats dashboard
 * (§ Phase 5).
 */
export function countBy(items, getValues) {
  const counts = new Map()
  for (const item of items) {
    for (const v of getValues(item)) {
      if (v == null || String(v).trim() === '') continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
}
