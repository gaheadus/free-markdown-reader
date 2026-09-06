// Content script entrypoint. Detects markdown pages, takes over the
// document, and mounts the Svelte app.

import { mount } from 'svelte'
import App from './App.svelte'
import { isPlainTextMarkdown, readRaw } from '../../lib/detect'
import { getSettings } from '../../lib/storage'
import { MD_MATCHES } from '../../config/matches'
import katexCss from 'katex/dist/katex.min.css?inline'
import contentCss from '../../styles/content.css?inline'

export default defineContentScript({
  matches: MD_MATCHES,
  cssInjectionMode: 'manual',
  runAt: 'document_start',
  async main(_ctx) {
    // Hide body immediately to prevent plaintext flash.
    // We unhide if this isn't a markdown file, or after rendering completes.
    document.documentElement.style.setProperty('visibility', 'hidden', 'important')

    // Wait for DOM to be ready so we can check contentType and read raw.
    if (document.readyState === 'loading') {
      await new Promise<void>((resolve) => {
        const onReady = () => {
          document.removeEventListener('DOMContentLoaded', onReady)
          resolve()
        }
        document.addEventListener('DOMContentLoaded', onReady)
      })
    }

    if (!isPlainTextMarkdown()) {
      document.documentElement.style.removeProperty('visibility')
      return
    }

    const raw = readRaw()
    if (raw == null) {
      document.documentElement.style.removeProperty('visibility')
      return
    }

    const settings = await getSettings()
    if (!settings.enable) {
      document.documentElement.style.removeProperty('visibility')
      return
    }

    injectStyles()
    const undo = takeover()
    try {
      const host = document.createElement('div')
      host.id = 'mdr-root'
      document.body.append(host)

      mount(App, {
        target: host,
        props: { initialRaw: raw, initialSettings: settings },
      })
    } catch (err) {
      // Rendering failed — undo the takeover so the browser's original plaintext
      // shows again instead of a blank page (mdr-active hides the native <pre>).
      undo()
      console.error('[Markdown Reader] failed to render; showing raw text:', err)
    } finally {
      // Always lift the anti-flash hide so a failure can never leave a blank page.
      document.documentElement.style.removeProperty('visibility')
    }
  },
})

// `takeover` mutates the host document (body class, margin, title, dataset,
// favicon). Every mutation is recorded in the returned `undo` callback so
// failure paths can restore the page to its original state — otherwise a
// crash mid-takeover could leave a blank page or stale title. The undo also
// handles pagehide / document hidden so the original state is recoverable
// when the content script tears down on navigation.
function takeover(): () => void {
  document.body.classList.add('mdr-active')
  document.documentElement.dataset.mdrTheme ??= 'auto'
  // Track every DOM property we touch so undo restores them precisely.
  const prev = {
    bodyMargin: document.body.style.margin,
    htmlDatasetMdrTheme: document.documentElement.dataset.mdrTheme,
    title: document.title,
    faviconId: '',
  }

  document.body.style.margin = '0'
  const path = location.pathname
  const seg = path.slice(path.lastIndexOf('/') + 1)
  let name = seg
  try {
    name = decodeURIComponent(seg)
  } catch {
    // Malformed / non-UTF-8 percent-encoding (e.g. `100%.md`, GBK CJK names) —
    // decodeURIComponent throws URIError; keep the raw segment instead.
  }
  if (name && !document.title) document.title = name
  const injectedFavicon = setFavicon()
  if (injectedFavicon) prev.faviconId = injectedFavicon.id

  return function undo() {
    document.body.classList.remove('mdr-active')
    document.body.style.margin = prev.bodyMargin
    if (prev.htmlDatasetMdrTheme === undefined) {
      delete document.documentElement.dataset.mdrTheme
    } else {
      document.documentElement.dataset.mdrTheme = prev.htmlDatasetMdrTheme
    }
    document.title = prev.title
    // Remove only the favicon we injected. Pre-existing favicons are not
    // touched — undo cannot reliably restore an arbitrary third-party href
    // the page originally declared, and removing it would be worse.
    if (prev.faviconId) {
      document.getElementById(prev.faviconId)?.remove()
    }
    // Remove the injected stylesheet + the App host so the page returns to
    // the browser's plain <pre> rendering if anything goes wrong.
    document.getElementById('mdr-styles')?.remove()
    document.getElementById('mdr-root')?.remove()
  }
}

// Inject our SVG favicon only on file:// — http(s) pages may serve a strict
// CSP (e.g. raw.githubusercontent.com sends `default-src 'none'; … sandbox`)
// that blocks `data:` images and logs a noisy console violation. The favicon
// is a fallback for file:// where Chrome shows no icon at all; on the web the
// page's own favicon (or Chrome's default) is good enough. We can't reliably
// probe the policy first because that very `fetch` is itself subject to the
// same CSP (connect-src falls back to default-src).
//
// Returns the injected <link> so the caller can remove it on undo, or null
// when nothing was injected.
function setFavicon(): HTMLLinkElement | null {
  if (location.protocol !== 'file:') return null
  if (document.querySelector('link[rel~="icon"]')) return null
  const link = document.createElement('link')
  link.id = 'mdr-favicon'
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="%230969da"/><text x="8" y="12" text-anchor="middle" font-size="10" font-family="sans-serif" font-weight="700" fill="white">M</text></svg>',
    )
  document.head.append(link)
  return link
}

function injectStyles() {
  const style = document.createElement('style')
  style.id = 'mdr-styles'
  style.textContent = `${contentCss}\n${katexCss}`
  document.head.append(style)
}
