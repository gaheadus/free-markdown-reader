// Tests for the pure toolbar dispatch rules. These rules are the input side
// of the panel-state state machine: each toolbar button click decides which
// downstream action the App should take. Pinning them down protects the
// "settings second-click restores the previous panel" UX contract — if a
// future refactor accidentally makes settings toggle-to-null like the other
// tabs, the App-level restoration will silently no-op.
import { describe, it, expect } from 'vitest'
import { toolbarAction, isToolbarActive } from './toolbar-actions'

describe('toolbarAction', () => {
  describe('search', () => {
    it('always returns toggleFilter regardless of current panel', () => {
      for (const panel of [null, 'folder', 'outline', 'settings'] as const) {
        expect(toolbarAction('search', panel)).toEqual({ kind: 'toggleFilter' })
      }
    })
  })

  describe('settings', () => {
    it('forwards "settings" when the sidebar is collapsed', () => {
      // First click after a fresh tab: settings opens fresh (no snapshot yet).
      expect(toolbarAction('settings', null)).toEqual({ kind: 'select', next: 'settings' })
    })

    it('forwards "settings" when another panel is active (App decides restore)', () => {
      // The App's panel-state machine is the source of truth for restoring
      // the previous panel — Toolbar just signals "settings was clicked".
      expect(toolbarAction('settings', 'folder')).toEqual({ kind: 'select', next: 'settings' })
      expect(toolbarAction('settings', 'outline')).toEqual({ kind: 'select', next: 'settings' })
    })

    it('forwards "settings" when settings is already active (App decides restore)', () => {
      // Critical branch: a second click on settings must NOT collapse the
      // sidebar. The toolbar must forward the literal key so the App can
      // restore the snapshot.
      expect(toolbarAction('settings', 'settings')).toEqual({ kind: 'select', next: 'settings' })
    })
  })

  describe('folder / outline toggle-to-null', () => {
    it('opens folder when collapsed', () => {
      expect(toolbarAction('folder', null)).toEqual({ kind: 'select', next: 'folder' })
    })

    it('opens outline when collapsed', () => {
      expect(toolbarAction('outline', null)).toEqual({ kind: 'select', next: 'outline' })
    })

    it('collapses folder when already on folder (toggle-to-null)', () => {
      expect(toolbarAction('folder', 'folder')).toEqual({ kind: 'select', next: null })
    })

    it('collapses outline when already on outline (toggle-to-null)', () => {
      expect(toolbarAction('outline', 'outline')).toEqual({ kind: 'select', next: null })
    })

    it('switches folder → outline via toggle-to-open', () => {
      expect(toolbarAction('outline', 'folder')).toEqual({ kind: 'select', next: 'outline' })
    })

    it('switches outline → folder via toggle-to-open', () => {
      expect(toolbarAction('folder', 'outline')).toEqual({ kind: 'select', next: 'folder' })
    })

    it('leaves settings for folder (forwarded, not toggled)', () => {
      // folder/outline do not toggle-to-null when the current panel is a
      // different non-null value — they switch forward.
      expect(toolbarAction('folder', 'settings')).toEqual({ kind: 'select', next: 'folder' })
      expect(toolbarAction('outline', 'settings')).toEqual({ kind: 'select', next: 'outline' })
    })
  })
})

describe('isToolbarActive', () => {
  it('returns true only when the key matches the current panel', () => {
    expect(isToolbarActive('folder', 'folder')).toBe(true)
    expect(isToolbarActive('outline', 'outline')).toBe(true)
    expect(isToolbarActive('settings', 'settings')).toBe(true)
  })

  it('returns false for a non-matching panel', () => {
    expect(isToolbarActive('folder', 'outline')).toBe(false)
    expect(isToolbarActive('outline', 'settings')).toBe(false)
    expect(isToolbarActive('settings', 'folder')).toBe(false)
  })

  it('returns false for any panel when the sidebar is collapsed', () => {
    expect(isToolbarActive('folder', null)).toBe(false)
    expect(isToolbarActive('outline', null)).toBe(false)
    expect(isToolbarActive('settings', null)).toBe(false)
  })

  it('always returns false for the search overlay', () => {
    // Search has no "active tab" — its pressed state comes from filterOpen.
    for (const panel of [null, 'folder', 'outline', 'settings'] as const) {
      expect(isToolbarActive('search', panel)).toBe(false)
    }
  })
})
