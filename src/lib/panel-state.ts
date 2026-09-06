// Pure state-machine logic for the sidebar panel selector.
//
// Lives next to storage.ts because the contract is shared: storage refuses
// to persist 'settings' across page loads, and the selector relies on that
// contract (a snapshot of the previous panel is always available when the
// user re-clicks settings). Kept dependency-free so it can be unit-tested
// without svelte, jsdom, or any browser shims.

import type { PanelKind } from './storage'

export interface PanelState {
  /** The panel currently visible (null = sidebar collapsed). */
  current: PanelKind
  /** Panel that was visible before settings was opened. */
  prevBeforeSettings: PanelKind | null
}

export const initialPanelState: PanelState = {
  current: 'outline',
  prevBeforeSettings: null,
}

/**
 * Apply a Toolbar / collapse / popup request and produce the next state.
 *
 * Rules:
 *   - Clicking an already-active folder/outline collapses the sidebar (null).
 *   - Clicking settings when settings is active restores the panel that
 *     was visible before settings was opened, and clears the snapshot.
 *   - Clicking settings from folder/outline captures the snapshot.
 *   - Any other transition (folder → outline, collapse, search → outline,
 *     etc.) clears the snapshot so it never leaks across sessions.
 *   - The filter overlay is closed whenever the requested panel is not
 *     outline — callers should apply that signal to their own `filterOpen`.
 *
 * `requested === 'search'` is intentionally NOT a PanelKind; the caller is
 * expected to map the search button to `current === 'outline' && !filterOpen`
 * upstream (Toolbar.svelte keeps the search-vs-panel distinction local).
 */
export function nextPanelState(
  state: PanelState,
  requested: PanelKind,
): { state: PanelState; clearsFilter: boolean } {
  // Second click on settings: restore the prior panel. The snapshot is
  // normally guaranteed to be non-null by the storage contract, but the
  // defensive null branch keeps us safe from future regressions.
  if (requested === 'settings' && state.current === 'settings') {
    const restore = state.prevBeforeSettings
    if (restore == null) {
      return {
        state: { current: 'settings', prevBeforeSettings: null },
        clearsFilter: false,
      }
    }
    return {
      state: { current: restore, prevBeforeSettings: null },
      clearsFilter: restore !== 'outline',
    }
  }

  // Entering settings: capture the snapshot. Leaving settings (or moving
  // between folder/outline, or collapsing) drops the snapshot so it cannot
  // leak into a later session.
  let prevBeforeSettings: PanelKind | null
  if (requested === 'settings') {
    prevBeforeSettings = state.current === 'settings' ? null : state.current
  } else {
    prevBeforeSettings = null
  }

  return {
    state: { current: requested, prevBeforeSettings },
    clearsFilter: requested !== 'outline',
  }
}
