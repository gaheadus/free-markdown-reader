// Settings stored in chrome.storage.local. Sidebar mode + width live in
// sessionStorage so each tab is naturally isolated by the browser itself — no
// tab id plumbing, no popup drift, no SW round-trip. The shared settings
// (theme/language/etc.) still cross tabs via onSettingsChanged.

import { browser } from 'wxt/browser'
import { storage } from 'wxt/utils/storage'
import { detectLanguage, type Lang } from './i18n'

export type ThemeMode = 'auto' | 'light' | 'dark'
export type PanelKind = 'folder' | 'outline' | 'settings' | null

/** Clamp a candidate width into the allowed range for the resizable sidebar. */
export function clampSideWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDE_WIDTH_DEFAULT
  return Math.min(SIDE_WIDTH_MAX, Math.max(SIDE_WIDTH_MIN, Math.round(width)))
}

// ====== Per-tab sidebar UI ================================================ //
// sessionStorage is scoped to the tab by the browser: opening two markdown
// tabs in the same window gives each its own store, switching tabs preserves
// state, closing the tab drops the state. That is exactly the isolation we
// want for the sidebar without any tab id bookkeeping. Popup never reads or
// writes these — sidebar controls live in the content UI, not in popup.
const TAB_PANEL_KEY = 'mdr:panel'
const TAB_SIDE_WIDTH_KEY = 'mdr:sideWidth'
const TAB_PANEL_KINDS = new Set(['folder', 'outline', 'settings'])

export function readTabPanel(): PanelKind {
  try {
    const v = sessionStorage.getItem(TAB_PANEL_KEY)
    if (v === null) return 'outline'
    if (v === 'none') return null
    // 'settings' is intentionally never restored on a fresh page load: the
    // settings panel is a transient tool, not a tab state users expect to
    // come back to. Restoring it would leave the snapshot empty, so a second
    // click on the settings button would be a no-op (silently "broken").
    // A refresh always lands on the outline instead.
    if (v === 'settings') return 'outline'
    if (v && TAB_PANEL_KINDS.has(v)) return v as PanelKind
  } catch {
    /* sessionStorage can throw in locked-down contexts (e.g. file:// with
       strict storage partitioning on some Chrome builds). */
  }
  return 'outline'
}

export function writeTabPanel(panel: PanelKind): void {
  try {
    // Don't persist 'settings' — see readTabPanel. This keeps storage honest
    // so a refresh never lands on settings.
    if (panel === 'settings') return
    sessionStorage.setItem(TAB_PANEL_KEY, panel ?? 'none')
  } catch {
    /* ignore quota / access errors */
  }
}

export function readTabSideWidth(fallback: number): number {
  try {
    const v = sessionStorage.getItem(TAB_SIDE_WIDTH_KEY)
    if (v == null) return fallback
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return clampSideWidth(n)
  } catch {
    return fallback
  }
}

export function writeTabSideWidth(width: number): void {
  try {
    sessionStorage.setItem(TAB_SIDE_WIDTH_KEY, String(clampSideWidth(width)))
  } catch {
    /* ignore quota / access errors */
  }
}

/** All toggleable markdown-it plugins. Keys match render.ts. */
export const MD_PLUGIN_KEYS = [
  'emoji',
  'sub',
  'sup',
  'ins',
  'mark',
  'abbr',
  'deflist',
  'footnote',
  'taskLists',
  'tableOfContents',
  'container',
  'alert',
  'katex',
  'mermaid',
] as const
export type MdPluginKey = (typeof MD_PLUGIN_KEYS)[number]

export interface Settings {
  enable: boolean
  centered: boolean
  refresh: boolean
  theme: ThemeMode
  language: Lang
  mdPlugins: Record<MdPluginKey, boolean>
}

// Bounds for the user-resizable sidebar width.
export const SIDE_WIDTH_MIN = 160
export const SIDE_WIDTH_MAX = 600
export const SIDE_WIDTH_DEFAULT = 280

// Cache detected language so first load is instant
const detected = detectLanguage()

export const DEFAULT_SETTINGS: Settings = {
  enable: true,
  centered: true,
  refresh: false,
  theme: 'auto',
  language: detected,
  mdPlugins: Object.fromEntries(
    MD_PLUGIN_KEYS.map((k) => [k, true]),
  ) as Record<MdPluginKey, boolean>,
}

const STORAGE_KEY = 'local:settings'

const settingsItem = storage.defineItem<Settings>(STORAGE_KEY, {
  fallback: DEFAULT_SETTINGS,
})

export async function getSettings(): Promise<Settings> {
  const raw = await settingsItem.getValue()
  return mergeDefaults(raw)
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next: Settings = {
    ...current,
    ...patch,
    mdPlugins: { ...current.mdPlugins, ...(patch.mdPlugins ?? {}) },
  }
  await settingsItem.setValue(next)
  return next
}

export function onSettingsChanged(
  cb: (next: Settings, prev: Settings) => void,
): () => void {
  return settingsItem.watch((next, prev) => {
    cb(mergeDefaults(next), mergeDefaults(prev))
  })
}

function mergeDefaults(raw: Settings | null): Settings {
  if (!raw) return DEFAULT_SETTINGS
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    mdPlugins: { ...DEFAULT_SETTINGS.mdPlugins, ...(raw.mdPlugins ?? {}) },
  }
}

/** Whether the extension is permitted to access file:// URLs. */
export function isFileAccessAllowed(): Promise<boolean> {
  return new Promise((resolve) => {
    // Chrome only.
    const ext = browser.extension as typeof browser.extension & {
      isAllowedFileSchemeAccess?: (cb: (ok: boolean) => void) => void
    }
    if (typeof ext.isAllowedFileSchemeAccess === 'function') {
      ext.isAllowedFileSchemeAccess((ok) => resolve(!!ok))
    } else {
      resolve(false)
    }
  })
}
