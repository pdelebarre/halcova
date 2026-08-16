import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ThemeProvider, themeToCssVars, useTheme } from './theme'

// T2 (issue #110) — the per-kind "room" theme provider. These tests pin the
// CSS-variable mapping and, above all, the DEFENSIVE contract: a missing or
// partial theme must NEVER throw (no error boundary → an uncaught render
// error is a dark screen).

describe('themeToCssVars (T2 #110)', () => {
  it('maps a catalog theme to CSS custom properties', () => {
    expect(themeToCssVars({
      accent: 'var(--kind-records-accent)',
      accentText: 'var(--color-bg)',
      ambient: 'var(--color-surface-1)',
    })).toEqual({
      '--theme-accent': 'var(--kind-records-accent)',
      '--theme-accent-text': 'var(--color-bg)',
      '--theme-ambient': 'var(--color-surface-1)',
    })
  })

  it('skips a missing theme entirely instead of throwing', () => {
    expect(themeToCssVars()).toEqual({})
    expect(themeToCssVars(null)).toEqual({})
    expect(themeToCssVars(undefined)).toEqual({})
    expect(themeToCssVars('not-a-theme')).toEqual({})
  })

  it('maps a partial theme and drops missing/non-string fields', () => {
    // Only the present string field maps.
    expect(themeToCssVars({ accent: 'var(--kind-books-accent)' })).toEqual({
      '--theme-accent': 'var(--kind-books-accent)',
    })
    // Whitespace-only, non-string and missing values are all dropped.
    expect(themeToCssVars({ accent: '   ', accentText: 42, ambient: undefined })).toEqual({})
  })
})

describe('ThemeProvider / useTheme', () => {
  function probeTheme() {
    let seen
    function Probe() { seen = useTheme(); return null }
    return { Probe, read: () => seen }
  }

  it('provides the active catalog theme to consumers', () => {
    const theme = { accent: 'var(--kind-records-accent)' }
    const { Probe, read } = probeTheme()
    render(
      <ThemeProvider theme={theme}>
        <Probe />
      </ThemeProvider>,
    )
    expect(read()).toBe(theme)
  })

  it('degrades to an empty object when the provider has no theme (no throw)', () => {
    const { Probe, read } = probeTheme()
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(read()).toEqual({})
  })

  it('degrades to an empty object outside any provider (no throw)', () => {
    const { Probe, read } = probeTheme()
    render(<Probe />)
    expect(read()).toEqual({})
  })
})
