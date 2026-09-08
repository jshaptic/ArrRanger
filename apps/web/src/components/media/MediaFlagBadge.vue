<script setup lang="ts">
import { computed } from 'vue';
import type { MediaFlag, MediaRow } from '@arrranger/shared';
import { MEDIA_FLAG_STYLES, MEDIA_SEVERITY_ICONS, instancesWithFlag } from '@/lib/media';

/**
 * One state badge, in this view's own vocabulary.
 *
 * Only `warn` and above draw a glyph. `unmonitored` and `no file yet` fire on ordinary,
 * healthy rows - a monitored item nobody has downloaded yet has a path that is *meant* not
 * to exist - so decorating them with a warning would train the eye to ignore the ones that
 * matter.
 */
const props = defineProps<{ flag: MediaFlag; row: MediaRow }>();

const style = computed(() => MEDIA_FLAG_STYLES[props.flag]);
const icon = computed(() => MEDIA_SEVERITY_ICONS[style.value.severity]);

const owners = computed(() => instancesWithFlag(props.row, props.flag));

const title = computed(() =>
  owners.value.length === props.row.facets.length
    ? style.value.title
    : `${style.value.title} - on ${owners.value.join(', ')}`,
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap"
    :class="style.classes"
    :data-flag="flag"
    :title="title"
  >
    <component :is="icon" v-if="icon" size="xs" />
    {{ style.label }}
  </span>
</template>
