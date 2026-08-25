<script lang="ts">
  import { onMount } from 'svelte'
  import { t, type Lang } from '../lib/i18n'

  type Heading = { id: string; level: number; text: string }

  type Props = {
    headings: Heading[]
    lang: Lang
  }
  let { headings, lang }: Props = $props()

  let q = $state('')
  let scrollEl: HTMLDivElement | null = $state(null)

  onMount(() => {
    // When the search panel is shown, reset the .md-panel scroll so the
    // search bar always starts at the top, independent of the panel's own
    // scroll position from previous panel views.
    scrollEl?.closest<HTMLElement>('.md-panel')?.scrollTo(0, 0)
  })

  let results = $derived.by(() => {
    const trimmed = q.trim()
    if (!trimmed) return headings
    const lower = trimmed.toLowerCase()
    return headings.filter((h) => h.text.toLowerCase().includes(lower))
  })

  function jump(ev: MouseEvent, id: string) {
    ev.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }
</script>

<div class="md-search-self" bind:this={scrollEl}>
  <div class="md-search-bar">
    <input
      type="search"
      bind:value={q}
      placeholder={t(lang, 'search.placeholder')}
      autocomplete="off"
    />
  </div>

  <!-- Scrollable results list — lives entirely inside the bar, never affected
       by .md-panel scroll position. -->
  <div class="md-search-results">
    {#if results.length === 0}
      <div class="md-warning">{t(lang, 'search.noMatches')}</div>
    {:else}
      <ul class="md-outline">
        {#each results as h (h.id)}
          <li data-level={h.level}>
            <a href={`#${h.id}`} onclick={(e) => jump(e, h.id)}>{h.text}</a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
