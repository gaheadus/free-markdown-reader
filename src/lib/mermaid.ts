// Runtime mermaid renderer. We render at content-script time (not at
// markdown-parse time) so we can resolve to SVG, defer the heavy import
// behind a dynamic chunk, and re-render on theme change.
//
// Concurrency contract:
//   renderMermaid() can be invoked again before the previous call's awaits
//   resolve (e.g. the popup toggling the mermaid plugin on/off quickly, or
//   the hot-reload effect firing twice). mermaid.render() is stateful and
//   two interleaved calls will corrupt each other's output. To make the
//   last call "win" without losing earlier blocks mid-flight, we mint a
//   monotonically increasing token at the start of each call and bail out
//   of every later await step if the token has been superseded.
//
// Error persistence:
//   A failing mermaid block previously hid its diagnostic in a child <div>
//   appended to the <pre>. On the next rerender the <pre> is regenerated
//   from markdown and the note vanishes — looking like an empty block with
//   no clue why. We now keep the error note as a SIBLING of the <pre>
//   (so the source code stays inspectable) and skip re-rendering any block
//   whose source text we've already seen fail — keyed by source content
//   in a module-level cache so the diagnostic survives unrelated rerenders
//   (theme toggles, popup-driven settings changes, etc.) without the user
//   having to edit the file to make the error message come back.

interface Bag {
  initialized: boolean
  theme: 'light' | 'dark'
  /** Monotonic token so concurrent calls can't trample each other. */
  generation: number
  /** Source texts that have already failed to render — keyed by exact text
   *  so theme toggles and settings patches don't make the error note
   *  disappear. Cleared only when the user changes the source. */
  failedSrc: Set<string>
}

const state: Bag = {
  initialized: false,
  theme: 'light',
  generation: 0,
  failedSrc: new Set(),
}

/** Marker CSS class on a <pre> whose block has been replaced by SVG. */
const REPLACED = 'md-mermaid-replaced'
/** Marker CSS class on a <pre> whose mermaid.render() failed. */
const ERRORED_PRE = 'md-mermaid-errored'
/** Class on the sibling <div> that holds the error message. */
const ERROR_NOTE = 'md-mermaid-error-note'

export async function renderMermaid(root: HTMLElement, dark: boolean): Promise<void> {
  const myToken = ++state.generation

  const blocks = root.querySelectorAll<HTMLElement>(
    'pre.md-code code.language-mermaid, pre code.language-mermaid',
  )
  if (blocks.length === 0) return

  // Late blocks within this call must also respect newer generations.
  // (We re-check after every await below.)

  const { default: mermaid } = await import('mermaid')
  if (myToken !== state.generation) return

  const wantTheme = dark ? 'dark' : 'default'
  if (!state.initialized || (dark ? 'dark' : 'light') !== state.theme) {
    mermaid.initialize({
      startOnLoad: false,
      theme: wantTheme,
      securityLevel: 'strict',
    })
    state.initialized = true
    state.theme = dark ? 'dark' : 'light'
  }

  let counter = 0
  for (const code of Array.from(blocks)) {
    if (myToken !== state.generation) return
    const pre = code.closest('pre')
    if (!pre) continue
    if (pre.classList.contains(REPLACED) || pre.classList.contains(ERRORED_PRE)) continue
    const src = code.textContent ?? ''
    // Skip blocks we've already failed on — re-trying them produces the same
    // error, which would (a) spam the console and (b) burn CPU on every
    // theme toggle. The error note + red border we already attached survive
    // the next rerender because the <pre> is regenerated but still gets the
    // `md-mermaid-errored` marker applied via the early `continue` below.
    if (state.failedSrc.has(src)) {
      pre.classList.add(ERRORED_PRE)
      // Only attach the note if it isn't already there (e.g. from a previous
      // successful rerender).
      if (!pre.nextElementSibling?.classList.contains(ERROR_NOTE)) {
        const note = document.createElement('div')
        note.className = ERROR_NOTE
        note.textContent = 'Mermaid error: see browser console for details'
        pre.insertAdjacentElement('afterend', note)
      }
      continue
    }
    const id = `mmd-${Date.now()}-${counter++}-${myToken}`
    let svg: string
    try {
      ;({ svg } = await mermaid.render(id, src))
    } catch (err) {
      if (myToken !== state.generation) return
      state.failedSrc.add(src)
      pre.classList.add(ERRORED_PRE)
      // Place the diagnostic alongside the source so the original code stays
      // visible — a syntax error message is useless without the code it
      // complained about. Sibling, not child, so the <pre>'s height stays
      // driven by its own content.
      const note = document.createElement('div')
      note.className = ERROR_NOTE
      note.textContent = `Mermaid error: ${(err as Error).message}`
      pre.insertAdjacentElement('afterend', note)
      continue
    }
    if (myToken !== state.generation) return
    const host = document.createElement('div')
    host.className = 'md-mermaid'
    host.innerHTML = svg
    pre.classList.add(REPLACED)
    pre.replaceWith(host)
  }
}
