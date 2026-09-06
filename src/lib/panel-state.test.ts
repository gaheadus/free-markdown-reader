// Tests for the panel-selector state machine in panel-state.ts.
//
// The state machine is the single source of truth for the rules documented
// in the file. These tests pin down each transition so a future refactor of
// App.svelte's selectPanel cannot quietly break the UX guarantees:
//   - second click on settings restores the prior panel
//   - snapshot never leaks across non-settings transitions
//   - filter overlay is closed whenever the active panel is not outline
//   - folder/outline still toggle to null (sidebar collapse)

import { describe, it, expect } from 'vitest'
import { nextPanelState, initialPanelState, type PanelState } from './panel-state'

function from(current: PanelState['current'], prev: PanelState['prevBeforeSettings'] = null): PanelState {
  return { current, prevBeforeSettings: prev }
}

// ---------------------------------------------------------------------------
// Folder / outline: classic toggle-to-null behaviour
// ---------------------------------------------------------------------------

describe('folder/outline toggling', () => {
  it('opens folder from a collapsed sidebar', () => {
    const result = nextPanelState(from(null), 'folder')
    expect(result.state).toEqual(from('folder'))
    expect(result.clearsFilter).toBe(true)
  })

  it('opens outline from a collapsed sidebar', () => {
    const result = nextPanelState(from(null), 'outline')
    expect(result.state).toEqual(from('outline'))
    expect(result.clearsFilter).toBe(false)
  })

  // Note: "click folder/outline while already active" is handled in
  // Toolbar.svelte (the click handler maps an already-active tab to
  // onSelect(null)). The state machine only sees `requested=null` for the
  // collapse transition, so we cover that case via the dedicated collapse
  // tests below.

  it('switches directly from folder to outline and keeps filter closed', () => {
    const result = nextPanelState(from('folder'), 'outline')
    expect(result.state.current).toBe('outline')
    expect(result.state.prevBeforeSettings).toBeNull()
    expect(result.clearsFilter).toBe(false)
  })

  it('switches directly from outline to folder and clears the filter', () => {
    const result = nextPanelState(from('outline'), 'folder')
    expect(result.state.current).toBe('folder')
    expect(result.state.prevBeforeSettings).toBeNull()
    expect(result.clearsFilter).toBe(true)
  })

  it('collapses from folder via the collapse button (null request)', () => {
    const result = nextPanelState(from('folder'), null)
    expect(result.state.current).toBeNull()
    expect(result.clearsFilter).toBe(true)
  })

  it('collapses from outline via the collapse button (null request)', () => {
    const result = nextPanelState(from('outline'), null)
    expect(result.state.current).toBeNull()
    expect(result.clearsFilter).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Settings: snapshot capture + restore on second click
// ---------------------------------------------------------------------------

describe('settings: snapshot capture', () => {
  it('captures folder as the snapshot when entering settings from folder', () => {
    const result = nextPanelState(from('folder'), 'settings')
    expect(result.state.current).toBe('settings')
    expect(result.state.prevBeforeSettings).toBe('folder')
    expect(result.clearsFilter).toBe(true)
  })

  it('captures outline as the snapshot when entering settings from outline', () => {
    const result = nextPanelState(from('outline'), 'settings')
    expect(result.state.current).toBe('settings')
    expect(result.state.prevBeforeSettings).toBe('outline')
    // Entering settings from outline signals clear-filter because the next
    // panel rendered is not the outline panel — callers apply the signal to
    // their filterOpen state. This mirrors the original selectPanel rule
    // (`if (next !== 'outline') filterOpen = false`) — it ran on every
    // transition and this refactor preserves it.
    expect(result.clearsFilter).toBe(true)
  })
})

describe('settings: restore on second click', () => {
  it('restores folder on a second click when settings was opened from folder', () => {
    const result = nextPanelState(from('settings', 'folder'), 'settings')
    expect(result.state.current).toBe('folder')
    expect(result.state.prevBeforeSettings).toBeNull()
    // Restoring to a non-outline panel signals clear-filter — same rule as
    // a direct click on folder. Consistent with the rest of the machine.
    expect(result.clearsFilter).toBe(true)
  })

  it('restores outline on a second click when settings was opened from outline', () => {
    const result = nextPanelState(from('settings', 'outline'), 'settings')
    expect(result.state.current).toBe('outline')
    expect(result.state.prevBeforeSettings).toBeNull()
    // Restoring to outline keeps the filter state intact — same as a direct
    // click on outline from any other panel.
    expect(result.clearsFilter).toBe(false)
  })

  it('is a no-op when the snapshot is missing (defensive branch)', () => {
    // Hypothetical stale state: panel=settings but snapshot is null. The
    // state machine must NOT throw or fall through to an undefined panel.
    const result = nextPanelState(from('settings', null), 'settings')
    expect(result.state.current).toBe('settings')
    expect(result.state.prevBeforeSettings).toBeNull()
    expect(result.clearsFilter).toBe(false)
  })
})

describe('settings: leaving via another tab clears the snapshot', () => {
  it('clicking folder from settings drops the snapshot', () => {
    const result = nextPanelState(from('settings', 'outline'), 'folder')
    expect(result.state.current).toBe('folder')
    expect(result.state.prevBeforeSettings).toBeNull()
  })

  it('clicking outline from settings drops the snapshot', () => {
    const result = nextPanelState(from('settings', 'folder'), 'outline')
    expect(result.state.current).toBe('outline')
    expect(result.state.prevBeforeSettings).toBeNull()
  })

  it('collapsing from settings drops the snapshot', () => {
    const result = nextPanelState(from('settings', 'folder'), null)
    expect(result.state.current).toBeNull()
    expect(result.state.prevBeforeSettings).toBeNull()
  })

  it('a settings → settings → settings sequence ends on the restored panel', () => {
    // Simulates: open folder, click settings, click settings again, click
    // settings a third time. The third click must NOT restore folder a
    // second time — it must open settings fresh because the snapshot was
    // cleared by the restore.
    let state = from('folder')
    let step = nextPanelState(state, 'settings')
    state = step.state
    expect(state.prevBeforeSettings).toBe('folder')

    step = nextPanelState(state, 'settings')
    state = step.state
    expect(state.current).toBe('folder')
    expect(state.prevBeforeSettings).toBeNull()

    step = nextPanelState(state, 'settings')
    state = step.state
    expect(state.current).toBe('settings')
    // New snapshot was captured from the *current* panel (folder), so
    // re-clicking settings now would restore folder. This is the expected
    // behaviour: the user is back where they started, so the memory is too.
    expect(state.prevBeforeSettings).toBe('folder')
  })
})

// ---------------------------------------------------------------------------
// Filter-overlay contract
// ---------------------------------------------------------------------------

describe('filter-overlay clearing', () => {
  it('does not signal clear-filter when staying on outline', () => {
    const result = nextPanelState(from('outline'), 'outline')
    expect(result.clearsFilter).toBe(false)
  })

  it('signals clear-filter when leaving outline for folder', () => {
    const result = nextPanelState(from('outline'), 'folder')
    expect(result.clearsFilter).toBe(true)
  })

  it('signals clear-filter when collapsing', () => {
    const result = nextPanelState(from('outline'), null)
    expect(result.clearsFilter).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sanity: initialPanelState is a valid input
// ---------------------------------------------------------------------------

describe('initialPanelState', () => {
  it('defaults current to "outline" with no snapshot', () => {
    // The state machine and the storage layer share an opinion that
    // 'outline' is the natural landing panel — readTabPanel() returns it
    // when sessionStorage is empty, and that value feeds straight into the
    // state machine on first render.
    expect(initialPanelState).toEqual({ current: 'outline', prevBeforeSettings: null })
  })

  it('is a valid input to nextPanelState (no throw, sensible defaults)', () => {
    const result = nextPanelState(initialPanelState, 'settings')
    expect(result.state.current).toBe('settings')
    expect(result.state.prevBeforeSettings).toBe('outline')
  })
})
