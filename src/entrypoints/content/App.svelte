<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import Toolbar from '../../panels/Toolbar.svelte'
  import OutlinePanel from '../../panels/OutlinePanel.svelte'
  import FolderPanel from '../../panels/FolderPanel.svelte'
  import SearchPanel from '../../panels/SearchPanel.svelte'
  import SettingsPanel from '../../panels/SettingsPanel.svelte'
  import {
    onSettingsChanged,
    setSettings,
    clampSideWidth,
    SIDE_WIDTH_MIN,
    SIDE_WIDTH_MAX,
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
  // persisted width from settings.
  let sideWidth = $derived(draggingWidth ?? settings.sideWidth)

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
      headings = extractHeadings(contentRoot)
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
    if (settings.enable) rerender()
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
        patchSettings({ panel: settings.panel ? null : 'outline' })
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

  // ====== Sidebar resize (drag the right edge) ======
  function onResizeStart(ev: PointerEvent) {
    // Only left-click drags should resize; ignore other buttons / touch context.
    if (ev.button !== 0) return
    ev.preventDefault()
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
      // Only write to storage when the value actually changed; keeps storage
      // idle when the user just clicks without moving.
      if (final !== settings.sideWidth) {
        void setSettings({ sideWidth: final })
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    // Hint the cursor / suppress text selection across the whole viewport
    // while the drag is in flight, even when the pointer leaves the handle.
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }
</script>

<div
  class="md-app"
  class:is-resizing={draggingWidth !== null}
  data-panel={settings.panel ?? 'none'}
  data-centered={settings.centered ? '1' : '0'}
  style:--mdr-side-width={`${sideWidth}px`}
>
  <aside class="md-side">
    {#if settings.panel}
      <div class="md-side-head">
        <Toolbar
          panel={settings.panel}
          lang={settings.language}
          onSelect={(p: PanelKind) => patchSettings({ panel: p })}
        />
        <button
          type="button"
          class="md-side-close"
          title={t(settings.language, 'panel.collapse')}
          aria-label={t(settings.language, 'panel.collapse')}
          onclick={() => patchSettings({ panel: null })}
        >{t(settings.language, 'panel.collapseSymbol')}</button>
      </div>
      <div class="md-panel" class:md-panel-search={settings.panel === 'search'}>
        {#if settings.panel === 'folder'}
          <FolderPanel lang={settings.language} />
        {:else if settings.panel === 'outline'}
          <OutlinePanel {headings} lang={settings.language} contentRoot={contentRoot} />
        {:else if settings.panel === 'search'}
          <SearchPanel {headings} lang={settings.language} />
        {:else if settings.panel === 'settings'}
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
      aria-pressed={!!settings.panel}
      onclick={() => patchSettings({ panel: settings.panel ? null : 'outline' })}
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
    <article
      class="md-content markdown-body"
      class:is-hidden={rawMode}
      bind:this={contentRoot}
    >{@html html}</article>
    {#if rawMode}
      <pre class="md-raw">{raw}</pre>
    {/if}
  </main>
</div>
