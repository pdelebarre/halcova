// ai-insights.js — Collection insights generation (FEAT-9.4, #335).
//
// Generates AI-powered collection insights: completion suggestions,
// "you might like" recommendations, and gap analysis. Uses the capability
// layer (capabilities.js) and the active provider.
//
// Security:
//   - Data-minimization: only canonical metadata (title, artist, genre,
//     year, format) is sent to the model — never private owned attributes
//     (notes, grading, lending, wishlist).
//   - "AI suggests; app decides": output is advisory only — no auto-execution.
//   - XSS-safe: all output text is schema-validated and bounded.
//   - Expensive AI generation is cached server-side with a TTL.
//   - Provider output is untrusted and schema-validated via runCapability.
//
// Cache:
//   - Insights are cached per collection type for CACHE_TTL_MS.
//   - Cache key: `insights:<collectionType>`.
//   - Cache is in-memory (no Blobs dependency for this lightweight use).

import { runCapability, COLLECTION_INSIGHTS } from './capabilities'
import { getActiveProvider } from './ai-fallback'

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const cache = new Map()

function cacheKey(collectionType) {
  return `insights:${collectionType}`
}

function getCached(collectionType) {
  const key = cacheKey(collectionType)
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCached(collectionType, data) {
  const key = cacheKey(collectionType)
  cache.set(key, { data, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate collection insights for the given collection type and items.
 *
 * @param {string} collectionType - e.g. 'records', 'books'
 * @param {Array} items - Array of item objects with canonical fields
 * @param {object} [options] - Optional bounded request overrides
 * @returns {Promise<object>} { insights, cached, error? }
 */
export async function generateCollectionInsights(collectionType, items, options = {}) {
  // Validate inputs
  if (!collectionType || typeof collectionType !== 'string') {
    return { error: { message: 'collectionType is required', code: 'INVALID_INPUT' } }
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { error: { message: 'items array is required and must not be empty', code: 'INVALID_INPUT' } }
  }

  // Check cache first
  const cached = getCached(collectionType)
  if (cached) {
    return { insights: cached, cached: true }
  }

  // Get the active provider
  let provider
  try {
    provider = await getActiveProvider()
  } catch (err) {
    return { error: { message: 'No active AI provider available', code: 'NO_ACTIVE_PROVIDER' } }
  }

  if (!provider) {
    return { error: { message: 'No active AI provider available', code: 'NO_ACTIVE_PROVIDER' } }
  }

  // Data-minimization: extract only canonical fields
  const minimizedItems = items.map((item) => ({
    id: item.id,
    title: item.title || '',
    subtitle: item.subtitle || '',
    artist: item.artist || '',
    genre: item.genre || '',
    year: item.year || '',
    format: item.format || '',
    label: item.label || '',
  }))

  // Run the capability
  try {
    const result = await runCapability(
      provider,
      COLLECTION_INSIGHTS.id,
      { collectionType, items: minimizedItems },
      { ...options, temperature: 0.3 }, // slight creativity for recommendations
    )

    // Cache the result
    setCached(collectionType, result.insights)

    return { insights: result.insights, cached: false }
  } catch (err) {
    return {
      error: {
        message: err.message || 'Failed to generate insights',
        code: err.code || 'INSIGHTS_FAILURE',
      },
    }
  }
}

/**
 * Clear the insights cache for a specific collection type, or all if not specified.
 */
export function clearInsightsCache(collectionType) {
  if (collectionType) {
    cache.delete(cacheKey(collectionType))
  } else {
    cache.clear()
  }
}

/**
 * Get cache stats (for admin dashboard).
 */
export function getInsightsCacheStats() {
  const now = Date.now()
  let entries = 0
  let expired = 0
  for (const [key, entry] of cache.entries()) {
    entries++
    if (now - entry.timestamp > CACHE_TTL_MS) {
      expired++
    }
  }
  return { entries, expired, ttlMs: CACHE_TTL_MS }
}