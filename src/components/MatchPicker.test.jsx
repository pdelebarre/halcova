import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import MatchPicker from './MatchPicker'

// T8 (#286): MatchPicker gains an OPTIONAL cover-OCR fallback offer. Existing
// callers (manual-add modals) that never pass `onScanCover` must be unchanged:
// no scan-cover button in the empty or error state, and the loading state must
// never surface it either.

const SCAN_COVER_LABEL = 'Scan the cover — the app can read it'

function baseProps(overrides = {}) {
  return {
    title: 'Is this it?',
    matches: [],
    loading: false,
    errorMsg: '',
    onPick: vi.fn(),
    onManual: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('MatchPicker — T8 cover-OCR fallback offer', () => {
  it('shows the scan-cover offer in the empty state only when onScanCover is provided', () => {
    const onScanCover = vi.fn()
    // Without onScanCover — no affordance (existing callers unchanged).
    render(<MatchPicker {...baseProps()} />)
    expect(screen.queryByRole('button', { name: SCAN_COVER_LABEL })).not.toBeInTheDocument()

    // With onScanCover — the offer renders and hands the tap through.
    render(<MatchPicker {...baseProps({ onScanCover })} />)
    fireEvent.click(screen.getByRole('button', { name: SCAN_COVER_LABEL }))
    expect(onScanCover).toHaveBeenCalled()
  })

  it('shows Retry + Scan the cover in the error state only when onScanCover is provided', () => {
    const onScanCover = vi.fn()
    const errorProps = baseProps({ errorMsg: "Couldn't reach any lookup service — try again in a moment." })

    // Without onScanCover — the error + retry/manual render, no scan-cover.
    render(<MatchPicker {...errorProps} />)
    expect(screen.getByText(errorProps.errorMsg)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SCAN_COVER_LABEL })).not.toBeInTheDocument()

    // With onScanCover — the scan-cover offer joins the error state.
    render(<MatchPicker {...errorProps} onScanCover={onScanCover} />)
    fireEvent.click(screen.getByRole('button', { name: SCAN_COVER_LABEL }))
    expect(onScanCover).toHaveBeenCalled()
  })

  it('never shows the scan-cover offer while loading', () => {
    render(<MatchPicker {...baseProps({ loading: true, matches: null, onScanCover: vi.fn() })} />)
    expect(screen.queryByRole('button', { name: SCAN_COVER_LABEL })).not.toBeInTheDocument()
  })

  it('uses the provided coverScanLabel', () => {
    render(<MatchPicker {...baseProps({ onScanCover: vi.fn(), coverScanLabel: 'Snap the sleeve' })} />)
    expect(screen.getByRole('button', { name: 'Snap the sleeve' })).toBeInTheDocument()
  })
})
