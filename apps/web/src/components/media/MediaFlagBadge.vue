<script setup lang="ts">
import { computed } from 'vue';
import type { MediaFlag, MediaRow } from '@arrranger/shared';
import {
  MEDIA_FLAG_FILTER,
  MEDIA_FLAG_STYLES,
  MEDIA_SEVERITY_ICONS,
  instancesWithFlag,
} from '@/lib/media';

/**
 * One state badge, in this view's own vocabulary.
 *
 * Only `warn` and above draw a glyph. `unmonitored` and `no file yet` fire on ordinary,
 * healthy rows - a monitored item nobody has downloaded yet has a path that is *meant* not
 * to exist - so decorating them with a warning would train the eye to ignore the ones that
 * matter.
 *
 * Where a click has a filter (`MEDIA_FLAG_FILTER`), this is a button the way a root folder
 * is: one click asks "what else looks like this".
 */
const props = defineProps<{ flag: MediaFlag; row: MediaRow }>();

const emit = defineEmits<{ filter: [source: string] }>();

const style = computed(() => MEDIA_FLAG_STYLES[props.flag]);
const icon = computed(() => MEDIA_SEVERITY_ICONS[style.value.severity]);
const filterSource = computed(() => MEDIA_FLAG_FILTER[props.flag]);

const owners = computed(() => instancesWithFlag(props.row, props.flag));

const title = computed(() => {
  const detail =
    owners.value.length === props.row.facets.length
      ? style.value.title
      : `${style.value.title} - on ${owners.value.join(', ')}`;
  return filterSource.value === undefined
    ? detail
    : `Filter by ${style.value.label}. ${detail}`;
});

function onClick(): void {
  if (filterSource.value !== undefined) emit('filter', filterSource.value);
}
</script>

<template>
  <component
    :is="filterSource ? 'button' : 'span'"
    :type="filterSource ? 'button' : undefined"
    class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
    :class="[style.classes, filterSource ? 'transition-colors hover:border-accent' : '']"
    :data-flag="flag"
    :title="title"
    @click="onClick"
  >
    <component :is="icon" v-if="icon" size="xs" />
    {{ style.label }}
  </component>
</template>
