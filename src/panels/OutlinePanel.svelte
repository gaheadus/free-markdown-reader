<script lang="ts">
  import { createScrollSpy } from '../lib/scroll-spy'
  import { t, type Lang } from '../lib/i18n'

  type Heading = { id: string; level: number; text: string }
  type OutlineNode = Heading & { children: OutlineNode[]; parentId: string | null }
  type HighlightPart = { text: string; hit: boolean }

  type Props = {
    headings: Heading[]
    lang: Lang
    /** Container element holding the rendered headings, for scroll-spy. */
    contentRoot?: HTMLElement | null
    /** When true, show the Filter input above the same TOC tree. */
    filterOpen?: boolean
  }
  let { headings, lang, contentRoot = null, filterOpen = false }: Props = $props()

  let activeId = $state<string | null>(null)
  let listEl: HTMLUListElement | null = $state(null)
  let inputEl: HTMLInputElement | null = $state(null)
  let q = $state('')
  let collapsedIds = $state<Set<string>>(new Set())
  let tree = $derived(buildTree(headings))
  let query = $derived(q.trim())
  let displayTree = $derived(filterTree(tree, query))
  let expandableIds = $derived(collectExpandableIds(tree))
  let allCollapsed = $derived(
    expandableIds.length > 0 && expandableIds.every((id) => collapsedIds.has(id)),
  )
  // Suppress ancestor expansion while a user-initiated jump is settling. The
  // scroll-spy would otherwise fire onChange as the browser scrolls, and a
  // naive `expandAncestors` would re-open the section the user just clicked.
  let suppressExpandUntil = 0

  $effect(() => {
    if (!contentRoot || headings.length === 0) return
    // Scope the lookup to the content and escape ids because slugs may contain
    // CJK, punctuation, or start with a digit.
    const els = headings
      .map((h) => contentRoot!.querySelector<HTMLElement>('#' + CSS.escape(h.id)))
      .filter((el): el is HTMLElement => !!el)
    return createScrollSpy(els, {
      onChange: (id) => {
        activeId = id
        if (!id) return
        if (Date.now() < suppressExpandUntil) return
        expandAncestors(id, tree)
      },
    })
  })

  // Keep the active outline item visible and expand its ancestors as the
  // document scrolls through nested sections.
  $effect(() => {
    if (!activeId || !listEl) return
    const item = listEl.querySelector<HTMLLIElement>(`li[data-id="${CSS.escape(activeId)}"]`)
    if (!item) return
    const panel = listEl.closest<HTMLElement>('.md-panel')
    if (!panel) return
    const isPanelFocused = panel.matches(':hover') || panel.contains(document.activeElement)
    item.scrollIntoView({
      block: 'nearest',
      behavior: isPanelFocused ? 'auto' : 'smooth',
    })
  })

  $effect(() => {
    if (!filterOpen) {
      q = ''
      return
    }
    // Toolbar click leaves focus on the search button; defer past that event.
    const id = window.setTimeout(() => inputEl?.focus(), 0)
    return () => clearTimeout(id)
  })

  function jump(ev: MouseEvent, id: string) {
    ev.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    activeId = id
    suppressExpandUntil = Date.now() + 800
    el.scrollIntoView({ block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  function toggle(id: string) {
    const next = new Set(collapsedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    collapsedIds = next
  }

  function expandAll() {
    collapsedIds = new Set()
  }

  function collapseAll() {
    collapsedIds = new Set(expandableIds)
  }

  function collectExpandableIds(nodes: OutlineNode[]): string[] {
    const ids: string[] = []
    for (const node of nodes) {
      if (node.children.length > 0) {
        ids.push(node.id)
        ids.push(...collectExpandableIds(node.children))
      }
    }
    return ids
  }

  function expandAncestors(id: string, nodes: OutlineNode[]): void {
    for (const node of nodes) {
      if (node.id === id) return
      if (node.children.some((child) => child.id === id || hasActiveDescendantById(child, id))) {
        const next = new Set(collapsedIds)
        next.delete(node.id)
        collapsedIds = next
        expandAncestors(id, node.children)
        return
      }
    }
  }

  function hasActiveDescendantById(node: OutlineNode, id: string): boolean {
    return node.id === id || node.children.some((child) => hasActiveDescendantById(child, id))
  }

  function buildTree(items: Heading[]): OutlineNode[] {
    const roots: OutlineNode[] = []
    const stack: OutlineNode[] = []
    for (const heading of items) {
      const node: OutlineNode = { ...heading, children: [], parentId: null }
      while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop()
      const parent = stack[stack.length - 1]
      if (parent) {
        node.parentId = parent.id
        parent.children.push(node)
      } else {
        roots.push(node)
      }
      stack.push(node)
    }
    return roots
  }

  /** Keep matching headings and their ancestors so the TOC tree stays intact. */
  function filterTree(nodes: OutlineNode[], needle: string): OutlineNode[] {
    if (!needle) return nodes
    const lower = needle.toLowerCase()
    const keep = (node: OutlineNode): OutlineNode | null => {
      const children = node.children.map(keep).filter((n): n is OutlineNode => n !== null)
      if (node.text.toLowerCase().includes(lower) || children.length > 0) {
        return { ...node, children }
      }
      return null
    }
    return nodes.map(keep).filter((n): n is OutlineNode => n !== null)
  }

  function splitHighlight(text: string, needle: string): HighlightPart[] {
    if (!needle) return [{ text, hit: false }]
    const hay = text.toLowerCase()
    const find = needle.toLowerCase()
    const parts: HighlightPart[] = []
    let i = 0
    while (i < text.length) {
      const at = hay.indexOf(find, i)
      if (at === -1) {
        parts.push({ text: text.slice(i), hit: false })
        break
      }
      if (at > i) parts.push({ text: text.slice(i, at), hit: false })
      parts.push({ text: text.slice(at, at + needle.length), hit: true })
      i = at + needle.length
    }
    return parts
  }
</script>

{#if filterOpen}
  <div class="md-search-bar">
    <input
      bind:this={inputEl}
      type="search"
      bind:value={q}
      placeholder={t(lang, 'search.placeholder')}
      autocomplete="off"
      aria-label={t(lang, 'search.placeholder')}
    />
  </div>
{:else}
  <div class="md-outline-head">
    <h2>{t(lang, 'panel.outline')}</h2>
    {#if tree.length > 0}
      <button
        type="button"
        class="md-outline-bulk"
        title={allCollapsed ? t(lang, 'outline.expandAll') : t(lang, 'outline.collapseAll')}
        aria-label={allCollapsed ? t(lang, 'outline.expandAll') : t(lang, 'outline.collapseAll')}
        onclick={() => (allCollapsed ? expandAll() : collapseAll())}
      >{allCollapsed ? t(lang, 'outline.expandAll') : t(lang, 'outline.collapseAll')}</button>
    {/if}
  </div>
{/if}
<div class="md-outline-scroll">
  {#if headings.length === 0}
    <div class="md-warning">{t(lang, 'outline.empty')}</div>
  {:else if query && displayTree.length === 0}
    <div class="md-warning">{t(lang, 'search.noMatches')}</div>
  {:else}
    <ul class="md-outline" bind:this={listEl}>
      {#each displayTree as node (node.id)}
        {@render outlineNode(node)}
      {/each}
    </ul>
  {/if}
</div>

{#snippet outlineNode(node: OutlineNode)}
  {@const isCollapsed = !query && collapsedIds.has(node.id)}
  <li
    data-id={node.id}
    data-level={node.level}
    class:is-active={activeId === node.id}
    class:has-children={node.children.length > 0}
  >
    <div class="md-outline-row">
      {#if node.children.length > 0}
        <button
          type="button"
          class="md-outline-toggle"
          aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
          aria-expanded={!isCollapsed}
          onclick={() => toggle(node.id)}
        >
          {#if isCollapsed}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4 2 L9 6 L4 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2 4 L6 9 L10 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {/if}
        </button>
      {:else}
        <span class="md-outline-toggle-spacer" aria-hidden="true"></span>
      {/if}
      <a href={`#${node.id}`} onclick={(e) => jump(e, node.id)}>
        {#if query}
          {#each splitHighlight(node.text, query) as part, i}
            {#if part.hit}<mark class="md-outline-hit">{part.text}</mark>{:else}{part.text}{/if}
          {/each}
        {:else}
          {node.text}
        {/if}
      </a>
    </div>
    {#if node.children.length > 0 && !isCollapsed}
      <ul>
        {#each node.children as child (child.id)}
          {@render outlineNode(child)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}
