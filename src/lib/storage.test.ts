// Tests for readTabPanel / writeTabPanel — the sessionStorage contract that
// the rest of the app relies on.
//
// Why we mock `wxt/utils/storage` and `wxt/browser`: storage.ts imports those
// only for the chrome.storage.local-backed Settings type, never for the
// per-tab panel. By mocking them out we keep these tests pure: no fake
// browser, no jsdom, no extension API shim — just a stubbed sessionStorage
// and the panel functions under test.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: vi.fn(),
      setValue: vi.fn(),
      watch: vi.fn(() => () => {}),
    }),
  },
}))
vi.mock('wxt/browser', () => ({ browser: {} }))

// Helper: build a minimal sessionStorage stub. Maps strings → strings,
// mirrors only the surface that readTabPanel / writeTabPanel touch.
function makeSessionStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k)
    },
    setItem: (k, v) => {
      map.set(k, String(v))
    },
  }
}

async function importStorageWithSession(initial: Record<string, string> = {}) {
  vi.stubGlobal('sessionStorage', makeSessionStorage(initial))
  // Dynamic import so the module picks up the stubbed sessionStorage on first
  // evaluation. Module-level `try` blocks would otherwise capture the real
  // (undefined in node) sessionStorage at import time.
  const mod = await import('./storage')
  return mod
}

describe('readTabPanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to "outline" when sessionStorage is empty', async () => {
    const { readTabPanel } = await importStorageWithSession()
    expect(readTabPanel()).toBe('outline')
  })

  it('restores "folder" from a prior session', async () => {
    const { readTabPanel } = await importStorageWithSession({ 'mdr:panel': 'folder' })
    expect(readTabPanel()).toBe('folder')
  })

  it('restores "outline" from a prior session', async () => {
    const { readTabPanel } = await importStorageWithSession({ 'mdr:panel': 'outline' })
    expect(readTabPanel()).toBe('outline')
  })

  it('restores null when the prior session stored "none"', async () => {
    const { readTabPanel } = await importStorageWithSession({ 'mdr:panel': 'none' })
    expect(readTabPanel()).toBeNull()
  })

  it('redirects a stale "settings" value to "outline"', async () => {
    // A refresh that finds 'settings' in sessionStorage must NOT reopen the
    // settings panel — otherwise the snapshot is empty and a second click on
    // the settings button would be silently broken. See readTabPanel.
    //
    // Regression test: this branch used to be unreachable because the
    // TAB_PANEL_KINDS whitelist above returned 'settings' before reaching
    // it. The order of the checks is now load-bearing.
    const { readTabPanel } = await importStorageWithSession({ 'mdr:panel': 'settings' })
    expect(readTabPanel()).toBe('outline')
  })

  it('falls back to "outline" for an unknown stored value', async () => {
    const { readTabPanel } = await importStorageWithSession({ 'mdr:panel': 'bogus' })
    expect(readTabPanel()).toBe('outline')
  })

  it('falls back to "outline" when sessionStorage throws', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('locked-down storage')
      },
      setItem: () => {
        throw new Error('locked-down storage')
      },
    } as unknown as Storage)
    const mod = await import('./storage')
    expect(mod.readTabPanel()).toBe('outline')
  })
})

describe('writeTabPanel', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists "folder"', async () => {
    const { writeTabPanel } = await importStorageWithSession()
    writeTabPanel('folder')
    expect(sessionStorage.getItem('mdr:panel')).toBe('folder')
  })

  it('persists "outline"', async () => {
    const { writeTabPanel } = await importStorageWithSession()
    writeTabPanel('outline')
    expect(sessionStorage.getItem('mdr:panel')).toBe('outline')
  })

  it('persists null as "none"', async () => {
    const { writeTabPanel } = await importStorageWithSession()
    writeTabPanel(null)
    expect(sessionStorage.getItem('mdr:panel')).toBe('none')
  })

  it('refuses to persist "settings"', async () => {
    // Mirrors readTabPanel: if we wrote 'settings', a refresh would reopen
    // the settings panel with no snapshot — silently broken. The setter
    // short-circuits before reaching sessionStorage.
    const { writeTabPanel } = await importStorageWithSession()
    writeTabPanel('settings')
    expect(sessionStorage.getItem('mdr:panel')).toBeNull()
  })

  it('overwrites a stale "settings" entry on the next legitimate write', async () => {
    // Realistic upgrade scenario: a user on an older version stored
    // 'settings'. The first legitimate panel change must overwrite it, so
    // the redirect in readTabPanel only ever fires once.
    const { writeTabPanel } = await importStorageWithSession({ 'mdr:panel': 'settings' })
    writeTabPanel('outline')
    expect(sessionStorage.getItem('mdr:panel')).toBe('outline')
  })

  it('swallows sessionStorage quota errors', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    } as unknown as Storage)
    const mod = await import('./storage')
    expect(() => mod.writeTabPanel('folder')).not.toThrow()
  })
})
