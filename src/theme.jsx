import { createContext, useContext, useMemo } from 'react'

// ---------------------------------------------------------------------------
// Per-kind "room" theming (epic #95 — "One home, two rooms", T2 #110).
//
// The active catalog's `theme` object (src/catalog.js) describes that room:
//   { accent, accentText, ambient }  — CSS custom-property *references* into
//   the T1 token layer (src/index.css).
//
// <ThemeProvider> is provided once by App.jsx around the collection shell and
// carries the active catalog's theme down to shared components. CollectionView
// reads it back with useTheme() and applies the values as CSS variables on its
// own container (`--theme-accent`, `--theme-accent-text`, `--theme-ambient`),
// so switching the Records|Books tab swaps the accent scope for everything
// under that container.
//
// Records = gold (`--kind-records-accent` — exactly today's look, a visual
// no-op). Books = neutral placeholder (`--kind-books-accent`) until T3 (#104)
// picks the Phase 0 color. This file must NOT invent a books color.
//
// DEFENSIVE CODING: there is no error boundary above the data paths in this
// app — an uncaught render error unmounts React to a dark screen. Every read
// here is optional-chained / shape-checked so a missing theme or a missing
// field can NEVER throw. A component rendered without a provider simply gets
// an empty theme and no CSS variables.
// ---------------------------------------------------------------------------

// Maps a catalog theme field → CSS custom property applied on the container.
const THEME_TO_CSS_VARS = {
  accent: '--theme-accent',
  accentText: '--theme-accent-text',
  ambient: '--theme-ambient',
}

/**
 * Turn a (possibly absent / partial) theme object into an inline-style object
 * of CSS variables, e.g. `{ accent: 'var(--kind-records-accent)' }` →
 * `{ '--theme-accent': 'var(--kind-records-accent)' }`.
 * Missing or non-string fields are skipped — never throws.
 */
export function themeToCssVars(theme) {
  const vars = {}
  if (!theme || typeof theme !== 'object') return vars
  for (const [field, cssVar] of Object.entries(THEME_TO_CSS_VARS)) {
    const value = theme?.[field]
    if (typeof value === 'string' && value.trim()) vars[cssVar] = value
  }
  return vars
}

export const ThemeContext = createContext(null)

/**
 * Provides the active catalog's theme to the subtree. `theme` is optional —
 * a provider without one (or none at all) degrades to an empty object, so
 * consumers can safely read `.accent` etc. without a guard of their own.
 */
export function ThemeProvider({ theme, children }) {
  const value = useMemo(() => (theme && typeof theme === 'object' ? theme : {}), [theme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Read the active room theme. Returns `{}` when none is provided. */
export function useTheme() {
  return useContext(ThemeContext) || {}
}
