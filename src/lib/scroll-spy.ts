// Scroll-spy: report which heading id is currently in view.
//
// Uses an IntersectionObserver rooted at the viewport with a top-band
// `rootMargin` so the "active" heading is the one closest to (but above) the
// top of the visible content area. Watching visibility transitions directly
// is more reliable than comparing cumulative scroll offsets, especially when
// content is rendered inside an internal scroll container or when host
// stylesheet quirks zero out `window.scrollY`.

export interface ScrollSpyOptions {
  /** Pixel band at the top of the viewport that's considered "the current
      heading zone". Defaults to 80 to roughly match a sticky header height. */
  topOffset?: number
  /** Extra space kept clear at the bottom of the rootMargin so a heading
      that just barely poked above the top doesn't count if it's still
      almost off-screen. */
  bottomShrink?: number
  onChange: (activeId: string | null) => void
}

export function createScrollSpy(
  headings: HTMLElement[],
  {
    topOffset = 80,
    bottomShrink = 0,
    onChange,
  }: ScrollSpyOptions,
): () => void {
  if (headings.length === 0) {
    onChange(null)
    return () => {}
  }

  // Map of heading element → id for fast lookup in the IO callback.
  const idOf = new WeakMap<Element, string>()
  for (const h of headings) idOf.set(h, h.id)

  // Visibility state per heading. We pick the *topmost* heading whose top has
  // already crossed the topOffset line, i.e. the highest one still considered
  // "above" the active band. If none qualify, we fall back to the highest
  // visible heading to avoid a gap right at the top of the document.
  const intersecting = new Set<Element>()
  let lastActive: string | null = null
  let raf = 0

  function recompute() {
    raf = 0
    let activeEl: Element | null = null

    // First pass: highest heading whose rect.top is <= topOffset.
    for (const h of headings) {
      const top = h.getBoundingClientRect().top
      if (top <= topOffset) {
        activeEl = h
      } else {
        break
      }
    }

    // If nothing qualifies (we're above the first heading), prefer the first
    // heading if it's currently intersecting the viewport at all, otherwise
    // report null so nothing is highlighted.
    if (!activeEl) {
      for (const h of headings) {
        if (intersecting.has(h)) {
          activeEl = h
          break
        }
      }
    }

    const next = activeEl ? (idOf.get(activeEl) ?? null) : null
    if (next !== lastActive) {
      lastActive = next
      onChange(next)
    }
  }

  function scheduleRecompute() {
    if (raf) return
    raf = requestAnimationFrame(recompute)
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) intersecting.add(entry.target)
        else intersecting.delete(entry.target)
      }
      scheduleRecompute()
    },
    {
      // Trim a band off the top so headings only "enter" once they cross
      // below the topOffset, and optionally trim the bottom for the
      // `isIntersecting` fallback.
      rootMargin: `-${topOffset}px 0px -${bottomShrink}px 0px`,
      threshold: [0, 1],
    },
  )
  for (const h of headings) io.observe(h)

  // Scroll + resize can move headings without changing their intersection
  // state (e.g. scrolling within the already-visible band), so re-evaluate.
  window.addEventListener('scroll', scheduleRecompute, { passive: true })
  window.addEventListener('resize', scheduleRecompute, { passive: true })

  // Prime once.
  scheduleRecompute()

  return () => {
    io.disconnect()
    window.removeEventListener('scroll', scheduleRecompute)
    window.removeEventListener('resize', scheduleRecompute)
    if (raf) cancelAnimationFrame(raf)
    intersecting.clear()
  }
}
