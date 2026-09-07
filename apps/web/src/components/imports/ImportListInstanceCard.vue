<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import BaseInstanceBadge from '@/components/base/BaseInstanceBadge.vue';
import {
  importListOwnerFacts,
  type ImportListOwner,
} from '@/lib/import-lists';
import type { ImportListRow } from '@/lib/matrix';
import { TONE_CLASSES, type OpPresentation } from '@/lib/staging';

/**
 * Everything one instance has to say about one import list.
 *
 * The chip only answers who has the list and whether it is on. Path, profile and
 * automatic-add live here, because they do not fit on the badge and because this is
 * where enable/disable can be named before it is staged.
 */
const props = defineProps<{
  owner: ImportListOwner;
  row: ImportListRow;
  anchor: { readonly top: number; readonly bottom: number; readonly left: number };
  staged: OpPresentation | null;
}>();

const emit = defineEmits<{ setEnabled: [enabled: boolean]; close: [] }>();

const GAP = 6;
const MARGIN = 8;

const card = ref<HTMLElement | null>(null);
const placed = ref<{ left: number; top: number } | null>(null);

const facts = computed(() => importListOwnerFacts(props.owner));

const TONE_TEXT = {
  normal: 'text-ink',
  warn: 'text-drift',
  muted: 'text-faint',
} as const;

function place(): void {
  const element = card.value;
  if (element === null) return;

  const { width, height } = element.getBoundingClientRect();
  const below = props.anchor.bottom + GAP;
  const flip =
    below + height > window.innerHeight - MARGIN && props.anchor.top - height - GAP > MARGIN;

  placed.value = {
    left: Math.max(MARGIN, Math.min(props.anchor.left, window.innerWidth - width - MARGIN)),
    top: flip ? props.anchor.top - height - GAP : below,
  };
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

function onScroll(): void {
  emit('close');
}

onMounted(() => {
  place();
  window.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', onScroll, { capture: true });
});
</script>

<template>
  <div
    ref="card"
    role="dialog"
    :aria-label="`${owner.name} · ${row.name}`"
    data-testid="owner-card"
    class="fixed z-50 w-72 rounded-lg border border-line-strong bg-surface p-3 text-xs shadow-xl"
    :style="{
      left: `${String(placed?.left ?? anchor.left)}px`,
      top: `${String(placed?.top ?? anchor.bottom + GAP)}px`,
      visibility: placed === null ? 'hidden' : 'visible',
    }"
  >
    <header class="flex items-center gap-2">
      <BaseInstanceBadge :name="owner.name" :kind="owner.kind" />
      <span class="min-w-0 flex-1 truncate font-semibold text-ink">{{ owner.name }}</span>
      <span class="text-[10px] tracking-wide text-faint uppercase">{{ owner.kind }}</span>
    </header>

    <p
      v-if="staged"
      class="mt-2 rounded border px-1.5 py-0.5 text-[10px]"
      :class="TONE_CLASSES[staged.tone]"
    >
      <component :is="staged.icon" size="xs" /> {{ staged.label }} staged for this list
    </p>

    <dl class="mt-2 space-y-1.5 border-t border-line pt-2">
      <div v-for="fact in facts" :key="fact.label" class="flex gap-2">
        <dt class="w-20 shrink-0 text-[10px] tracking-wide text-faint uppercase">{{ fact.label }}</dt>
        <dd class="min-w-0 flex-1">
          <p class="text-[11px] break-all" :class="TONE_TEXT[fact.tone]">{{ fact.value }}</p>
          <p
            v-for="line in fact.detail"
            :key="line"
            class="text-[10px] text-muted"
          >
            {{ line }}
          </p>
        </dd>
      </div>
    </dl>

    <div class="mt-2 flex justify-end border-t border-line pt-2">
      <BaseButton
        v-if="owner.enabled"
        size="sm"
        @click="emit('setEnabled', false)"
      >
        Disable
      </BaseButton>
      <BaseButton
        v-else
        size="sm"
        variant="success"
        @click="emit('setEnabled', true)"
      >
        Enable
      </BaseButton>
    </div>
  </div>
</template>
