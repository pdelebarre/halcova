// SettingsModal "Clear offline data" — FAIL-CLOSED privacy-reset UI (#159).
//
// SECURITY (ADR-0019 Dec 5/12): clearing local data empties BOTH the offline
// mirror and the durable #292 outbox for the signed-in user. If either IndexedDB
// delete transaction fails (abort/quota/cursor error) while reads still succeed,
// the UI must NOT report "Offline data cleared" — a raw queued op could survive
// and auto-flush on reconnect. The modal must surface a SAFE, generic error (no
// secrets/raw content) and keep the clear trigger available for a retry.
//
// This file mocks the three user-scoped clear repository functions so the
// failure path is deterministic; the real-repo fail-closed behaviour (clear
// returns false + the op/records stay durable) is covered in outbox.test.js,
// offlineMirror.test.js, and localDatabase.test.js.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider } from '../i18n'
import SettingsModal from '../components/SettingsModal'
import { clearOutboxForUser, clearAllOutbox } from '../utils/outbox'
import { clearMirrorForUser, clearAllMirror } from '../utils/offlineMirror'
import { clearLocalDataForUser, clearAllLocalData } from '../repositories/localDatabase'

vi.mock('../utils/outbox', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, clearOutboxForUser: vi.fn() }
})
vi.mock('../utils/offlineMirror', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, clearMirrorForUser: vi.fn() }
})
vi.mock('../repositories/localDatabase', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, clearLocalDataForUser: vi.fn() }
})

beforeEach(async () => {
  localStorage.clear()
  clearOutboxForUser.mockReset()
  clearMirrorForUser.mockReset()
  clearLocalDataForUser.mockReset()
  // Real clears still reset any shared IndexedDB between tests.
  await clearAllOutbox()
  await clearAllMirror()
  await clearAllLocalData()
})

async function confirmClear() {
  render(
    <LocaleProvider>
      <SettingsModal onClose={vi.fn()} userId="u1" />
    </LocaleProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /Clear offline data/i }))
  const confirm = screen
    .getAllByRole('button', { name: /Clear offline data/i })
    .at(-1)
  fireEvent.click(confirm)
}

describe('SettingsModal — fail-closed clear (#159)', () => {
  it('shows a SAFE error (never "cleared") when the outbox clear fails', async () => {
    clearOutboxForUser.mockResolvedValue(false)
    clearMirrorForUser.mockResolvedValue(true)
    clearLocalDataForUser.mockResolvedValue(true)

    await confirmClear()

    expect(await screen.findByText(/could not be cleared/i)).toBeInTheDocument()
    expect(screen.queryByText('Offline data cleared')).toBeNull()
  })

  it('shows a SAFE error (never "cleared") when the mirror clear fails', async () => {
    clearOutboxForUser.mockResolvedValue(true)
    clearMirrorForUser.mockResolvedValue(false)
    clearLocalDataForUser.mockResolvedValue(true)

    await confirmClear()

    expect(await screen.findByText(/could not be cleared/i)).toBeInTheDocument()
    expect(screen.queryByText('Offline data cleared')).toBeNull()
  })

  it('shows a SAFE error (never "cleared") when the local data clear fails', async () => {
    clearOutboxForUser.mockResolvedValue(true)
    clearMirrorForUser.mockResolvedValue(true)
    clearLocalDataForUser.mockResolvedValue(false)

    await confirmClear()

    expect(await screen.findByText(/could not be cleared/i)).toBeInTheDocument()
    expect(screen.queryByText('Offline data cleared')).toBeNull()
  })

  it('reports "cleared" only when ALL three clears succeed', async () => {
    clearOutboxForUser.mockResolvedValue(true)
    clearMirrorForUser.mockResolvedValue(true)
    clearLocalDataForUser.mockResolvedValue(true)

    await confirmClear()

    expect(await screen.findByText('Offline data cleared')).toBeInTheDocument()
    expect(screen.queryByText(/could not be cleared/i)).toBeNull()
  })

  it('surfaces a safe, generic failure message (no secrets / no raw content, ADR-0019 Dec 12)', async () => {
    clearOutboxForUser.mockResolvedValue(false)
    clearMirrorForUser.mockResolvedValue(false)
    clearLocalDataForUser.mockResolvedValue(false)

    await confirmClear()

    const error = await screen.findByRole('alert')
    expect(error.textContent).toMatch(/could not be cleared/i)
    expect(error.textContent).not.toMatch(
      /token|secret|access code|bearer|barcode|ocr|pendingItem|pending/i,
    )
  })

  it('keeps a retry trigger available after a failed clear', async () => {
    clearOutboxForUser.mockResolvedValue(false)
    clearMirrorForUser.mockResolvedValue(true)
    clearLocalDataForUser.mockResolvedValue(true)

    await confirmClear()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // A fresh "Clear offline data" trigger lets the user retry the reset.
    expect(
      screen.getByRole('button', { name: /Clear offline data/i }),
    ).toBeInTheDocument()
  })
})
