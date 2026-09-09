<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type { MediaFacet, MediaRow } from '@fleetarr/shared';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import IconClose from '@/components/base/icons/IconClose.vue';
import IconUnknown from '@/components/base/icons/IconUnknown.vue';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { instanceLink, MEDIA_FLAG_STYLES } from '@/lib/media';
import { TONE_CLASSES, type OpPresentation } from '@/lib/staging';
import { useInstancesStore } from '@/stores/instances';
import type { HoverAnchor } from '@/lib/use-hover-card';

/**
 * One copy of one title, in full.
 *
 * The row shows a chip and a single metric; everything else lives here, including the link
 * into this instance's own UI - four of those beside a title would drown the title.
 */
const props = defineProps<{
  facet: MediaFacet;
  row: MediaRow;
  anchor: HoverAnchor;
  staged: OpPresentation | null;
}>();

const emit = defineEmits<{ close: [] }>();

const instances = useInstancesStore();

const CARD_HEIGHT = 260;

const position = computed(() => {
  const below = window.innerHeight - props.anchor.bottom > CARD_HEIGHT;
  return {
    left: `${String(Math.max(8, Math.min(props.anchor.left, window.innerWidth - 340)))}px`,
    ...(below
      ? { top: `${String(props.anchor.bottom + 6)}px` }
      : { bottom: `${String(window.innerHeight - props.anchor.top + 6)}px` }),
  };
});

const link = computed(() => instanceLink(props.row, instances.byId.get(props.facet.instanceId)));

/** Two readings kept apart: what *Arr tracks, and what it says is on disk. */
const facts = computed(() => {
  const facet = props.facet;
  const entries: Array<{ label: string; value: string; tone: 'normal' | 'warn' | 'muted' }> = [
    {
      label: 'Monitored',
      value: facet.monitored ? 'yes' : 'no',
      tone: facet.monitored ? 'normal' : 'muted',
    },
    {
      label: 'On disk',
      // null is unknown, and it says so rather than reading as "nothing there".
      value: facet.hasFile === null ? 'unknown' : facet.hasFile ? 'yes' : 'not yet',
      tone: facet.hasFile === null ? 'warn' : 'normal',
    },
    {
      label: 'Size',
      value: facet.sizeOnDisk === null ? 'unknown' : formatBytes(facet.sizeOnDisk),
      tone: facet.sizeOnDisk === null ? 'muted' : 'normal',
    },
    {
      label: 'Profile',
      value: facet.qualityProfileName ?? 'no profile for this id',
      tone: facet.qualityProfileName === null ? 'warn' : 'normal',
    },
    { label: 'Path', value: facet.path.length > 0 ? facet.path : '—', tone: 'normal' },
    { label: 'Root folder', value: facet.rootFolderPath ?? '—', tone: 'normal' },
    {
      label: 'Tags',
      value: facet.tags.length > 0 ? facet.tags.join(', ') : 'none',
      tone: facet.tags.length > 0 ? 'normal' : 'muted',
    },
    {
      label: 'Import lists',
      // Null is Sonarr, which exposes no list-contents endpoint at all. It is unknown -
      // never "in no list", which is a claim we have no way to make.
      value:
        facet.lists === null
          ? 'unknown here'
          : facet.lists.length > 0
            ? facet.lists.join(', ')
            : 'none',
      tone: facet.lists === null ? 'warn' : facet.lists.length > 0 ? 'normal' : 'muted',
    },
    {
      label: 'Added',
      value: facet.added === null ? '—' : formatRelativeTime(facet.added),
      tone: 'normal',
    },
  ];

  if (props.facet.episodes !== null) {
    entries.splice(3, 0, {
      label: 'Episodes',
      value: `${String(props.facet.episodes.have)} of ${String(props.facet.episodes.total)}`,
      tone: 'normal',
    });
  }
  return entries;
});

const TONE_TEXT = { normal: 'text-ink', warn: 'text-drift', muted: 'text-faint' } as const;

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('scroll', () => emit('close'), { once: true, capture: true });
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div
    class="fixed z-50 w-[21rem] rounded-lg border border-line bg-overlay p-3 shadow-xl"
    :style="position"
    data-testid="media-owner-card"
    role="dialog"
    :aria-label="`${facet.name}: ${row.title}`"
  >
    <div class="mb-2 flex items-start gap-2">
      <BaseInstanceBadge :name="facet.name" :kind="facet.kind" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-xs font-medium text-ink">{{ facet.name }}</span>
        <span class="block truncate text-[10px] text-faint">{{ row.title }}</span>
      </span>
      <button
        type="button"
        class="text-faint transition-colors hover:text-ink"
        aria-label="Close"
        @click="emit('close')"
      >
        <IconClose size="sm" />
      </button>
    </div>

    <p
      v-if="staged"
      class="mb-2 flex items-center gap-1.5 rounded border px-1.5 py-1 text-[11px]"
      :class="TONE_CLASSES[staged.tone]"
      data-testid="media-owner-staged"
    >
      <component :is="staged.icon" size="sm" />
      {{ staged.label }} staged for this copy
    </p>

    <dl class="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1 text-[11px]">
      <template v-for="fact in facts" :key="fact.label">
        <dt class="text-faint">{{ fact.label }}</dt>
        <dd class="min-w-0 break-words" :class="TONE_TEXT[fact.tone]">
          <IconUnknown v-if="fact.value === 'unknown here'" size="xs" class="text-drift" />
          {{ fact.value }}
        </dd>
      </template>
    </dl>

    <div v-if="facet.flags.length > 0" class="mt-2 flex flex-wrap gap-1">
      <span
        v-for="flag in facet.flags"
        :key="flag"
        class="rounded border px-1.5 py-0.5 text-[10px]"
        :class="MEDIA_FLAG_STYLES[flag].classes"
      >
        {{ MEDIA_FLAG_STYLES[flag].label }}
      </span>
    </div>

    <a
      v-if="link"
      :href="link"
      target="_blank"
      rel="noreferrer noopener"
      data-testid="media-owner-link"
      class="mt-2.5 inline-block text-[11px] text-accent underline decoration-dotted"
    >
      open in {{ facet.name }}
    </a>
  </div>
</template>
