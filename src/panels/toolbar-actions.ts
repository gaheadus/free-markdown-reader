// Pure dispatch rules for the toolbar buttons.
//
// Lives outside Toolbar.svelte so the rules can be unit-tested without
// mounting Svelte. The component itself is a thin renderer that calls
// `toolbarAction` and applies its result to onSelect / onToggleFilter.
//
// `search` is a filter overlay on the outline, not a real PanelKind — keep
// it as a string literal here so we can render its button alongside the
// panel tabs without widening the public PanelKind enum.
import type { PanelKind } from '../lib/storage'

export type ToolbarKey = Exclude<PanelKind, null> | 'search'

export type ToolbarAction =
  | { kind: 'select'; next: PanelKind }
  | { kind: 'toggleFilter' }

/**
 * Decide what a toolbar button click should do.
 *
 * Settings is special: a second click on an already-active settings tab
 * should restore the panel that was visible before settings was opened
 * (folder or outline), not collapse the whole sidebar. We forward the
 * raw key so the App-level handler can compare against its own snapshot.
 * All other panels keep the toggle-to-null behaviour.
 */
export function toolbarAction(
  key: ToolbarKey,
  panel: PanelKind,
): ToolbarAction {
  if (key === 'search') {
    return { kind: 'toggleFilter' }
  }
  if (key === 'settings') {
    return { kind: 'select', next: 'settings' }
  }
  return { kind: 'select', next: panel === key ? null : key }
}

/**
 * Whether a toolbar button should render in its "active" state.
 *
 * Search is a filter overlay on the outline, not its own tab, so it never
 * reports active — its pressed state comes from `filterOpen` instead.
 */
export function isToolbarActive(key: ToolbarKey, panel: PanelKind): boolean {
  if (key === 'search') return false
  return panel === key
}
