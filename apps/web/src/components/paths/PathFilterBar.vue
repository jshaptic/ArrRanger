<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { parsePathFilter, type PathFilterMode } from '@arrranger/shared';
import { usePathsStore } from '@/stores/paths';

/**
 * The folder filter.
 *
 * One box, two jobs. Typing `doramas` still does what a search box does; typing
 * `{movies,series}/{russian,western}/4k` names six folders exactly, because the box speaks
 * the same brace expansion `mkdir -p` does. The toggle beside it flips the answer over:
 * the same patterns, everything *but* what they name.
 *
 * The draft is parsed on every keystroke and applied only on Enter or blur - a filter that
 * expands to 231 patterns is one request, and half-typed braces should never be one at all.
 * The parse is otherwise silent: the only thing it has to say out loud is that it failed.
 */
const paths = usePathsStore();

const draft = ref(paths.filter);
const showHelp = ref(false);

// Kept in step with the store so a rescan, or anything else that resets the filter, does
// not leave a stale draft sitting in the box.
watch(
  () => paths.filter,
  (value) => {
    if (value !== draft.value.trim()) draft.value = value;
  },
);

const parsed = computed(() => parsePathFilter(draft.value, paths.filterMode));
const excluding = computed(() => paths.filterMode === 'exclude');

function apply(): void {
  if (parsed.value.error !== null) return;
  void paths.setFilter(draft.value.trim());
}

function clear(): void {
  draft.value = '';
  void paths.setFilter('');
}

function setMode(mode: PathFilterMode): void {
  void paths.setFilterMode(mode);
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-1.5">
      <!-- mode first: it changes what the words in the box mean -->
      <div
        class="flex h-9 shrink-0 items-center rounded-md border border-line bg-raised p-0.5"
        role="group"
        aria-label="Filter mode"
        data-testid="path-filter-mode"
      >
        <button
          v-for="mode in (['include', 'exclude'] as const)"
          :key="mode"
          type="button"
          class="h-full rounded px-2 text-[11px] font-medium transition-colors"
          :class="
            paths.filterMode === mode
              ? mode === 'exclude'
                ? 'bg-drift/20 text-drift'
                : 'bg-accent/15 text-accent'
              : 'text-faint hover:text-ink'
          "
          :aria-pressed="paths.filterMode === mode"
          :data-mode="mode"
          :title="
            mode === 'include'
              ? 'Show the folders these patterns name'
              : 'Show everything except the folders these patterns name'
          "
          @click="setMode(mode)"
        >
          {{ mode === 'include' ? 'match' : 'exclude' }}
        </button>
      </div>

      <div class="relative max-w-3xl flex-1">
        <input
          v-model="draft"
          type="text"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          data-testid="path-filter-input"
          :placeholder="
            excluding
              ? 'Hide folders: name, or {a,b}/{c,d}…'
              : 'Filter folders: name, or {movies,series}/{russian,western}/4k…'
          "
          class="h-9 w-full rounded-md border bg-raised px-3 pr-16 font-mono text-sm text-ink outline-none focus:border-accent"
          :class="parsed.error === null ? 'border-line' : 'border-danger/60'"
          @keydown.enter.prevent="apply"
          @keydown.esc="clear"
          @change="apply"
        />
        <div class="absolute top-0 right-1.5 flex h-9 items-center gap-1">
          <button
            v-if="draft.length > 0"
            type="button"
            class="px-1 text-xs text-faint transition-colors hover:text-ink"
            title="Clear the filter (Esc)"
            data-testid="path-filter-clear"
            @click="clear"
          >
            ✕
          </button>
          <button
            type="button"
            class="px-1 text-xs transition-colors"
            :class="showHelp ? 'text-accent' : 'text-faint hover:text-ink'"
            title="Filter syntax"
            :aria-expanded="showHelp"
            @click="showHelp = !showHelp"
          >
            ?
          </button>
        </div>
      </div>
    </div>

    <!-- Nothing under the box but the reason it cannot be applied. What a filter expands
         to, and how it treats the folders on the way to a match, is the `?` card's job -
         a permanent status line said it on every keystroke, whether or not anyone asked. -->
    <p
      v-if="parsed.error !== null"
      class="text-[11px] text-danger"
      data-testid="path-filter-error"
    >
      ⚠ {{ parsed.error }} - the filter is not applied
    </p>

    <div
      v-if="showHelp"
      class="rounded-md border border-line bg-raised/60 p-2 text-[11px] leading-relaxed text-muted"
      data-testid="path-filter-help"
    >
      <dl class="grid gap-x-3 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt class="font-mono text-ink">doramas</dt>
        <dd>any folder whose name contains it</dd>
        <dt class="font-mono text-ink">movies/4k</dt>
        <dd>whole folder names, in that order, anywhere in the path - and everything below</dd>
        <dt class="font-mono text-ink">{movies,series}/4k</dt>
        <dd>both of them; braces nest, exactly like <span class="font-mono">mkdir -p</span></dd>
        <dt class="font-mono text-ink">season{01..12}</dt>
        <dd>ranges, zero-padded when you pad the first one</dd>
        <dt class="font-mono text-ink">*-feed/?k</dt>
        <dd><span class="font-mono">*</span> and <span class="font-mono">?</span> match inside one folder name</dd>
        <dt class="font-mono text-ink">"TV Shows"</dt>
        <dd>quote (or <span class="font-mono">\</span>-escape) a space, a brace or a quote</dd>
        <dt class="font-mono text-ink">a/b c/d</dt>
        <dd>a space separates patterns - any of them is a match</dd>
      </dl>
      <p class="mt-1.5 text-faint">
        Mounts and the folders above your root folders are never filtered away: they are how
        the tree reaches what you asked for. <span class="text-drift">exclude</span> protects
        nothing - hiding what it names, and everything under it, is the point.
      </p>
    </div>
  </div>
</template>
