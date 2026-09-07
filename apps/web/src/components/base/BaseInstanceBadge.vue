<script setup lang="ts">
import { computed } from 'vue';
import type { InstanceKind } from '@arrranger/shared';
import { initialsOf } from '@/lib/format';

/**
 * The two-character square that stands for an instance.
 *
 * Why it exists: nine call sites drew it by hand. Three of them - the fleet bar, the
 * matrix column header and the instances table - carried their own
 * `kind === 'radarr' ? amber : sky` ternary, a fourth palette copy of the `KIND_CLASSES`
 * the paths and imports chips imported from `lib/path-matrix`, where an instance colour
 * had no business living. The squares had drifted to three sizes and the quiet initials
 * in the queue lists to two colours, so "what colour is Sonarr" had four answers and
 * "what does an instance look like" had none.
 *
 * The colour is the app, never the state, with one exception: `tone="error"` for an
 * instance that did not answer. That is the matrix header's rule and it belongs here,
 * because an unreachable instance must not be told apart from a reachable one by whoever
 * happens to be rendering it.
 */

type BadgeSize = 'sm' | 'md' | 'lg';

/**
 * `muted` is the same badge with the square taken off - the form used in the queue and
 * staging lists, where a coloured tile on every row of a dense list would be noise and
 * the instance name is already spelled out beside it. It is a tone rather than a separate
 * component so that both forms derive their initials the one way.
 */
type BadgeTone = 'kind' | 'error' | 'muted';

const props = withDefaults(
  defineProps<{
    /** The instance's name; `null` means local storage, which has none and reads "FS". */
    name: string | null;
    /** Absent for local storage, and ignored when the tone is not `kind`. */
    kind?: InstanceKind;
    size?: BadgeSize;
    tone?: BadgeTone;
  }>(),
  { kind: undefined, size: 'md', tone: 'kind' },
);

/** Box and text are split because `muted` keeps the text scale and drops the box. */
const SIZES: Record<BadgeSize, { readonly box: string; readonly text: string }> = {
  sm: { box: 'h-4 w-4', text: 'text-[9px]' },
  md: { box: 'h-5 w-5', text: 'text-[10px]' },
  lg: { box: 'h-6 w-6', text: 'text-[10px]' },
};

const KIND_FILLS: Record<InstanceKind, string> = {
  radarr: 'bg-amber-500/20 text-amber-300',
  sonarr: 'bg-sky-500/20 text-sky-300',
};

/** Local storage is an owner of work, not an app, so it gets a fill with no app colour. */
const NEUTRAL_FILL = 'bg-line/60 text-muted';

const initials = computed(() => (props.name === null ? 'FS' : initialsOf(props.name)));

const classes = computed(() => {
  const size = SIZES[props.size];
  if (props.tone === 'muted') return ['font-mono text-faint', size.text];

  const fill =
    props.tone === 'error'
      ? 'bg-danger/20 text-danger'
      : props.kind === undefined
        ? NEUTRAL_FILL
        : KIND_FILLS[props.kind];

  return [
    'flex shrink-0 items-center justify-center rounded font-mono font-bold',
    size.box,
    size.text,
    fill,
  ];
});
</script>

<template>
  <span data-instance-badge :class="classes">{{ initials }}</span>
</template>
