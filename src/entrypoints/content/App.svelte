<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import Toolbar from '../../panels/Toolbar.svelte'
  import OutlinePanel from '../../panels/OutlinePanel.svelte'
  import FolderPanel from '../../panels/FolderPanel.svelte'
  import SettingsPanel from '../../panels/SettingsPanel.svelte'
  import {
    onSettingsChanged,
    setSettings,
    clampSideWidth,
    readTabPanel,
    writeTabPanel,
    readTabSideWidth,
    writeTabSideWidth,
    SIDE_WIDTH_MIN,
    SIDE_WIDTH_MAX,
    SIDE_WIDTH_DEFAULT,
    type PanelKind,
    type Settings,
  } from '../../lib/storage'
  import { createRenderer } from '../../lib/render'
  import { wirePagePlugins } from '../../lib/page-plugins'
  import { renderMermaid } from '../../lib/mermaid'
  import { send, type BroadcastCommand } from '../../lib/messaging'
  import { t } from '../../lib/i18n'
  import { browser } from 'wxt/browser'

  type Heading = { id: string; level: number; text: string }

  type Props = {
    initialRaw: string
    initialSettings: Settings
  }
  let { initialRaw, initialSettings }: Props = $props()

  let raw = $state.raw(untrack(() => initialRaw))
  let settings = $state.raw(untrack(() => initialSettings))
  // Sidebar mode + width live in sessionStorage, which the browser scopes to
  // the tab for us — no plumbing, no cross-tab writes, no race on activation.
  let panel = $state<PanelKind>(untrack(() => readTabPanel()))
  let sideWidthState = $state<number>(untrack(() => readTabSideWidth(SIDE_WIDTH_DEFAULT)))
  let html = $state('')
  let headings = $state<Heading[]>([])
  let contentRoot: HTMLElement | null = $state(null)
  let rawMode = $state(false)
  // Honour a deep-link #hash only on the first render, not on every rerender.
  let hashHandled = false

  // Live width used while dragging. Decoupled from settings so we can update
  // the DOM many times per second without spamming chrome.storage, and only
  // commit the value to storage on mouseup.
  let draggingWidth = $state<number | null>(null)

  // Derived "live" width: the drag preview while dragging, otherwise the
  // persisted per-tab width. Independent of `settings` so popup-driven changes
  // (which never include sideWidth after the per-tab split) cannot bleed in.
  let sideWidth = $derived(draggingWidth ?? sideWidthState)

  // Filter overlays the outline tree; it is not a separate panel.
  let filterOpen = $state(false)

  // Monospace code glyph for the raw/preview toggle button.
  const RAW_ICON = '</>'
  function toggleRaw() {
    rawMode = !rawMode
  }

  function effectiveTheme(s: Settings): 'light' | 'dark' {
    if (s.theme === 'light') return 'light'
    if (s.theme === 'dark') return 'dark'
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function rerender() {
    const renderer = createRenderer(settings)
    const { html: out } = renderer.render(raw)
    html = out
    // Defer post-render work until DOM updates.
    queueMicrotask(() => {
      if (!contentRoot) return
      // Stable reference: only swap `headings` when the id list actually
      // changed. Without this, every settings tweak rebuilds the headings
      // array and the OutlinePanel's scroll-spy effect tears down + re-
      // creates its IntersectionObserver — which fires onChange(null) on
      // its first compute and resets the user's scroll position in the TOC.
      const next = extractHeadings(contentRoot)
      if (!headingsEqual(lastHeadingsSig, next)) {
        lastHeadingsSig = next
        headings = next
      }
      wirePagePlugins(contentRoot)
      if (settings.mdPlugins.mermaid) {
        void renderMermaid(contentRoot, effectiveTheme(settings) === 'dark')
      }
      // Honour a deep-link #hash once, on first render.
      if (!hashHandled && location.hash) {
        hashHandled = true
        const frag = location.hash.slice(1)
        let id = frag
        try {
          id = decodeURIComponent(frag)
        } catch {
          // Malformed fragment — fall back to the raw value.
        }
        document.getElementById(id)?.scrollIntoView()
      }
    })
  }

  // Signature used to compare heading lists cheaply: id + level. We compare
  // the live DOM-extracted headings against the last set we published so
  // unrelated rerenders (theme toggles, popup patches) keep the same array
  // reference and downstream `$effect`s skip.
  function headingsEqual(a: Heading[], b: Heading[]): boolean {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || a[i].level !== b[i].level) return false
    }
    return true
  }
  // Mutable holder; tracked only inside rerender(), not by `$effect`s.
  let lastHeadingsSig: Heading[] = []

  function extractHeadings(root: HTMLElement): Heading[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'),
    ).map((el) => ({
      id: el.id,
      level: Number(el.tagName.slice(1)),
      text: el.textContent ?? '',
    }))
  }

  $effect(() => {
    // Track ONLY the inputs that should trigger a full HTML rerender.
    // `settings.centered` / `refresh` / `language` don't change rendered HTML,
    // so depending on `settings` as a whole was forcing redundant work on
    // every popup patch.
    if (!settings.enable) return
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    raw; // explicit dep so toggling enable back on re-runs against fresh raw
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    settings.mdPlugins; // explicit dep
    rerender()
  })

  $effect(() => {
    document.documentElement.dataset.mdrTheme = settings.theme
  })

  // ====== Hot reload (poll the SW which fetches the URL) ======
  $effect(() => {
    if (!settings.refresh) return
    // Scope cancellation to this effect run so an in-flight tick can't reschedule
    // itself after cleanup (which would leak the poll past a refresh-off toggle).
    let stopped = false
    let timer: number | undefined
    const tick = async () => {
      if (stopped) return
      try {
        const next = await send<string | undefined>({ type: 'fetch', url: location.href })
        if (!stopped && typeof next === 'string' && next !== raw) {
          raw = next
          const pre = document.body.querySelector('pre')
          if (pre) pre.textContent = next
        }
      } catch {
        // ignore — tab may have gone background
      }
      if (!stopped) timer = window.setTimeout(tick, 500)
    }
    timer = window.setTimeout(tick, 500)
    return () => {
      stopped = true
      if (timer != null) clearTimeout(timer)
    }
  })

  // ====== React to settings changes from popup ======
  onMount(() => {
    const off = onSettingsChanged((next) => (settings = next))
    const onCmd = (msg: unknown) => {
      const m = msg as { type?: string; command?: BroadcastCommand } | null
      if (!m || m.type !== 'pushCommand' || !m.command) return
      applyCommand(m.command)
    }
    browser.runtime.onMessage.addListener(onCmd)
    return () => {
      off()
      browser.runtime.onMessage.removeListener(onCmd)
    }
  })

  function applyCommand(cmd: BroadcastCommand) {
    switch (cmd) {
      case 'toggle-panel':
        selectPanel(panel ? null : 'outline')
        break
      case 'toggle-centered':
        patchSettings({ centered: !settings.centered })
        break
      case 'toggle-refresh':
        patchSettings({ refresh: !settings.refresh })
        break
      case 'toggle-theme': {
        const t = effectiveTheme(settings) === 'dark' ? 'light' : 'dark'
        patchSettings({ theme: t })
        break
      }
      case 'toggle-raw':
        toggleRaw()
        break
    }
  }

  function patchSettings(p: Partial<Settings>) {
    void setSettings(p)
  }

  function selectPanel(next: PanelKind) {
    if (next !== 'outline') filterOpen = false
    panel = next
    writeTabPanel(next)
  }

  function toggleFilter() {
    if (panel !== 'outline') {
      filterOpen = true
      selectPanel('outline')
      return
    }
    filterOpen = !filterOpen
  }

  // ====== Sidebar resize (drag the right edge) ===============================
  // Global state for the (at most one) in-flight drag. Hoisting it out of the
  // per-call closure lets us bail out cleanly from anywhere — including the
  // window blur / pagehide / unmount paths — without relying on pointerup
  // firing. pointerup is unreliable when the OS yanks focus mid-drag (lock
  // screen, native context menu, Alt-Tab on some Linux WMs), and on those
  // failures leaving `draggingWidth !== null` would freeze the sidebar width
  // and leave `cursor: col-resize` / `user-select: none` baked into <body>.
  let activeDragCleanup: (() => void) | null = null

  function cancelActiveDrag() {
    if (!activeDragCleanup) return
    const fn = activeDragCleanup
    activeDragCleanup = null
    fn()
  }

  function onResizeStart(ev: PointerEvent) {
    // Only left-click drags should resize; ignore other buttons / touch context.
    if (ev.button !== 0) return
    ev.preventDefault()

    // If a previous drag somehow never resolved (shouldn't happen given the
    // cleanup paths below, but defensive), tear it down before starting fresh.
    cancelActiveDrag()

    const startX = ev.clientX
    const startWidth = sideWidth
    draggingWidth = startWidth

    const onMove = (e: PointerEvent) => {
      const next = clampSideWidth(startWidth + (e.clientX - startX))
      if (next !== draggingWidth) draggingWidth = next
    }
    const onUp = () => {
      const final = draggingWidth ?? startWidth
      draggingWidth = null
      // Only write to per-tab storage when the value actually changed; keeps
      // storage idle when the user just clicks without moving.
      if (final !== startWidth) {
        sideWidthState = final
        writeTabSideWidth(final)
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onUp)
      window.removeEventListener('visibilitychange', onVisibility)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      activeDragCleanup = null
    }
    // `visibilitychange` fires on tab hide / freeze; treat it like pointerup
    // so the drag state can't outlive the visible tab.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') onUp()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onUp)
    document.addEventListener('visibilitychange', onVisibility)
    // Hint the cursor / suppress text selection across the whole viewport
    // while the drag is in flight, even when the pointer leaves the handle.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    activeDragCleanup = onUp
  }

  // Belt-and-braces: if the App unmounts while a drag is in flight (panel
  // removed, hot-reload, navigation), the window listeners are torn down
  // with the page anyway, but we still want body styles reset promptly.
  onMount(() => () => cancelActiveDrag())
</script>

<div
  class="md-app"
  class:is-resizing={draggingWidth !== null}
  data-panel={panel ?? 'none'}
  data-centered={settings.centered ? '1' : '0'}
  style:--mdr-side-width={`${sideWidth}px`}
>
  <aside class="md-side">
    {#if panel}
      <div class="md-side-head">
        <Toolbar
          {panel}
          lang={settings.language}
          {filterOpen}
          onSelect={selectPanel}
          onToggleFilter={toggleFilter}
        />
        <button
          type="button"
          class="md-side-close"
          title={t(settings.language, 'panel.collapse')}
          aria-label={t(settings.language, 'panel.collapse')}
          onclick={() => selectPanel(null)}
        >{t(settings.language, 'panel.collapseSymbol')}</button>
      </div>
      <div class="md-panel" class:md-panel-filter={filterOpen && panel === 'outline'}>
        {#if panel === 'folder'}
          <FolderPanel lang={settings.language} />
        {:else if panel === 'outline'}
          <OutlinePanel {headings} lang={settings.language} contentRoot={contentRoot} {filterOpen} />
        {:else if panel === 'settings'}
          <SettingsPanel {settings} onPatch={patchSettings} />
        {/if}
      </div>
      <!-- Draggable right edge: live preview width updates during drag,
           committed to storage only on mouseup. -->
      <div
        class="md-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={settings.language === 'zh_CN' ? '拖动以调整侧栏宽度' : 'Drag to resize side panel'}
        aria-valuenow={sideWidth}
        aria-valuemin={SIDE_WIDTH_MIN}
        aria-valuemax={SIDE_WIDTH_MAX}
        onpointerdown={onResizeStart}
      ></div>
    {/if}
  </aside>

  <main class="md-main">
    <button
      type="button"
      class="md-side-toggle"
      title={t(settings.language, 'panel.expand')}
      aria-label={t(settings.language, 'panel.expand')}
      aria-pressed={!!panel}
      onclick={() => selectPanel(panel ? null : 'outline')}
    >{t(settings.language, 'panel.expandSymbol')}</button>
    <button
      type="button"
      class="md-rawtoggle"
      class:is-active={rawMode}
      title={t(settings.language, rawMode ? 'view.showPreview' : 'view.showRaw')}
      aria-label={t(settings.language, rawMode ? 'view.showPreview' : 'view.showRaw')}
      aria-pressed={rawMode}
      onclick={toggleRaw}
    >
      <span class="md-rawtoggle-icon">{RAW_ICON}</span>
      <span class="md-rawtoggle-label">{t(settings.language, rawMode ? 'view.preview' : 'view.raw')}</span>
    </button>
    {#if settings.enable}
      <article
        class="md-content markdown-body"
        class:is-hidden={rawMode}
        bind:this={contentRoot}
      >{@html html}</article>
      {#if rawMode}
        <pre class="md-raw">{raw}</pre>
      {/if}
    {:else}
      <!-- Extension disabled at runtime via the popup. Render the raw
           markdown source as a plain <pre> instead of the styled article so
           the user still gets something readable, and make it easy to turn
           back on without leaving the page. -->
      <div class="md-disabled">
        <div class="md-disabled-banner">
          {t(settings.language, 'view.disabled')}
          <button
            type="button"
            class="md-disabled-enable"
            onclick={() => patchSettings({ enable: true })}
          >{t(settings.language, 'view.enableNow')}</button>
        </div>
        <pre class="md-raw md-raw-fallback">{raw}</pre>
      </div>
    {/if}
  </main>
</div>
