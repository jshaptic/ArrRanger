<script setup lang="ts">
import { computed } from 'vue';
import type { MediaRow } from '@arrranger/shared';
import { externalLinks } from '@/lib/media';

/**
 * Where else to look this title up.
 *
 * Site names, not one shared arrow glyph: *which* system it is carries the whole meaning,
 * and an icon would hide exactly that. A missing id renders nothing at all rather than a
 * guessed search URL - the view does not make claims it cannot back.
 */
const props = defineProps<{ row: MediaRow }>();

const links = computed(() => externalLinks(props.row));
</script>

<template>
  <span v-if="links.length > 0" class="inline-flex items-center gap-1.5">
    <a
      v-for="link in links"
      :key="link.key"
      :href="link.href"
      target="_blank"
      rel="noreferrer noopener"
      :data-link="link.key"
      :title="link.title"
      class="text-[10px] text-faint underline decoration-dotted transition-colors hover:text-accent"
      @click.stop
    >
      {{ link.label }}
    </a>
  </span>
</template>
