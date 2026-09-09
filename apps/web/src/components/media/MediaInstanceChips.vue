<script setup lang="ts">
import type { MediaFacet, MediaRow } from '@fleetarr/shared';
import MediaInstanceCard from './MediaInstanceCard.vue';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import IconUnknown from '@/components/base/icons/IconUnknown.vue';
import { MEDIA_CHIP_CLASSES } from '@/lib/media';
import { TONE_CLASSES, type OpPresentation } from '@/lib/staging';
import { useHoverCard } from '@/lib/use-hover-card';

/**
 * Which instances hold this title - chips, not a column each.
 *
 * **Every** copy is drawn, including the ones the filter did not match; the matched ones are
 * lit and the rest stay quiet. Hiding them would make `tags:4k` render a title as though it
 * existed on one instance only, which is the same species of lie as showing an unanswered
 * instance as a gap. The lit ones are exactly what a bulk operation acts on.
 */
const props = defineProps<{
  row: MediaRow;
  /** What is staged against one copy, if anything. */
  stagedFor: (instanceId: number, mediaId: number) => OpPresentation | null;
}>();

const card = useHoverCard<MediaFacet>();

function intentOf(facet: MediaFacet): OpPresentation | null {
  return props.stagedFor(facet.instanceId, facet.mediaId);
}

function chipClasses(facet: MediaFacet): string {
  const intent = intentOf(facet);
  if (intent !== null) return `${TONE_CLASSES[intent.tone]} ring-1 ring-inset ring-current/30`;
  return MEDIA_CHIP_CLASSES[facet.matched ? 'matched' : 'other'];
}

/**
 * One word per chip: is *Arr watching this copy.
 *
 * Whether it has the file is deliberately absent - that is the Size column's answer, and a
 * chip repeating it turns a row of instance names into a row of state to read twice.
 */
function metricOf(facet: MediaFacet): string {
  return facet.monitored ? 'on' : 'off';
}

function titleOf(facet: MediaFacet): string {
  const intent = intentOf(facet);
  const claim =
    intent === null
      ? facet.matched
        ? 'matches this filter'
        : 'holds it, but did not match this filter'
      : `${intent.label} staged for ${props.row.title}`;
  return `${facet.name}: ${claim} - click for the full breakdown`;
}
</script>

<template>
  <td class="border-b border-l border-line px-2 py-1.5 align-top">
    <div class="flex flex-wrap items-center gap-1">
      <button
        v-for="facet in row.facets"
        :key="facet.instanceId"
        type="button"
        :data-owner="facet.matched ? 'matched' : 'other'"
        :data-instance="facet.instanceId"
        class="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap transition-colors"
        :class="chipClasses(facet)"
        :title="titleOf(facet)"
        :aria-expanded="card.open.value?.item.instanceId === facet.instanceId"
        @click="card.toggle(facet, $event, (open) => open.instanceId === facet.instanceId)"
        @mouseenter="card.hover(facet, $event)"
        @mouseleave="card.scheduleClose()"
        @focus="card.show(facet, $event)"
        @blur="card.scheduleClose()"
      >
        <BaseInstanceBadge :name="facet.name" :kind="facet.kind" size="sm" />
        <span>{{ facet.name }}</span>
        <span class="font-mono text-[10px] text-faint" data-metric="state">
          · {{ metricOf(facet) }}
        </span>
      </button>

      <!-- Rows the filter could not judge say so here, once, with the reason on hover. -->
      <IconUnknown
        v-if="(row.reasons ?? []).length > 0"
        size="xs"
        class="text-drift"
        data-testid="row-undecided"
        :title="(row.reasons ?? []).join(' · ')"
      />
    </div>

    <Teleport to="body">
      <div v-if="card.pinned.value && card.open.value" class="fixed inset-0 z-40" @click="card.close()"></div>
      <MediaInstanceCard
        v-if="card.open.value"
        :facet="card.open.value.item"
        :row="row"
        :anchor="card.open.value.anchor"
        :staged="intentOf(card.open.value.item)"
        @mouseenter="card.clearTimers()"
        @mouseleave="card.scheduleClose()"
        @close="card.close()"
      />
    </Teleport>
  </td>
</template>
