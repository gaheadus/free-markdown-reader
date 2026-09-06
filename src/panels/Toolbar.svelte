<script lang="ts">
  import type { PanelKind } from '../lib/storage'
  import { t, type Lang } from '../lib/i18n'

  type Props = {
    panel: PanelKind
    lang: Lang
    filterOpen?: boolean
    onSelect: (next: PanelKind) => void
    onToggleFilter: () => void
  }
  let { panel, lang, filterOpen = false, onSelect, onToggleFilter }: Props = $props()

  const items: Array<{ key: PanelKind; icon: string; i18nKey: string }> = [
    { key: 'folder',   icon: '\u{1F4C1}', i18nKey: 'panel.folder' },
    { key: 'outline',  icon: '☰',           i18nKey: 'panel.outline' },
    { key: 'search',   icon: '\u{1F50D}', i18nKey: 'panel.search' },
    { key: 'settings', icon: '⚙',           i18nKey: 'panel.settings' },
  ]

  function click(key: PanelKind) {
    if (key === 'search') {
      onToggleFilter()
      return
    }
    onSelect(panel === key ? null : key)
  }

  function isActive(key: PanelKind): boolean {
    // Search is a filter overlay on the outline, not its own tab.
    if (key === 'search') return false
    return panel === key
  }
</script>

<div class="md-toolbar" role="toolbar" aria-label="Markdown Reader">
  {#each items as item (item.key)}
    <button
      type="button"
      data-tool={item.key}
      class:is-active={isActive(item.key)}
      title={t(lang, item.i18nKey)}
      aria-label={t(lang, item.i18nKey)}
      aria-pressed={item.key === 'search' ? filterOpen : panel === item.key}
      onclick={() => click(item.key)}
    >
      {item.icon}
    </button>
  {/each}
</div>
