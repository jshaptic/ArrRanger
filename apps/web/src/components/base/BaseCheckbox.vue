<script setup lang="ts">
import { computed, useAttrs } from 'vue';
import IconCheck from '@/components/base/icons/IconCheck.vue';
import IconRemove from '@/components/base/icons/IconRemove.vue';

/**
 * The one checkbox in the app.
 *
 * Why it exists: 21 raw inputs had drifted into three shapes - a bare input in a table
 * cell, an input inside a caller-owned <label>, and an input with `mt-0.5` beside a
 * two-line explanation - all leaning on the browser's `accent-color` for the tick.
 * `accent-color` gives no say over the mark itself, and on this dark surface the native
 * tick is a hairline that reads nothing like the icons the rest of the UI is built from.
 * So the native mark is switched off and one of ours is drawn in its place.
 *
 * Why a real <input type="checkbox"> is still here: it is the one control where the
 * platform hands you keyboard handling, the label-for association, `:indeterminate` and
 * form semantics for nothing. Every selection test in this app also drives it - by
 * `setValue`, by `trigger('change')`, by counting `tbody input[type="checkbox"]`, and in
 * two dialogs by `HTMLElement.click()` on a node found through `document.querySelector`.
 * A div with role="checkbox" would have cost all of that. The input is simply transparent
 * and stretched over the box drawn for it.
 *
 * Why it renders no <label> of its own: 19 of the 21 sites already sit inside one that
 * carries the copy, and nesting a second makes the click target ambiguous. The caller
 * keeps its label; this draws the box and nothing else. The two sites with no label - the
 * folder matrix header and a folder row - stay clickable because the input is an overlay,
 * not an `sr-only` node parked 1px wide in the corner of the wrapper.
 */

type Tone = 'accent' | 'danger';

const props = withDefaults(
  defineProps<{
    /**
     * Neither on nor off: some of what this box stands for is selected. Bound as a DOM
     * property (there is no `indeterminate` attribute) so the platform state is real, but
     * the drawn state is taken from the prop - a pseudo-class cannot choose a glyph, and
     * one source for both the fill and the mark is the only way the two cannot disagree.
     */
    indeterminate?: boolean;
    disabled?: boolean;
    /**
     * A prop rather than a fall-through attribute because the input is invisible: a
     * `title` on a transparent 14px input is a tooltip with no hover area. It goes on the
     * wrapper, which has the hit area, and on the input, which is what a screen reader
     * names when the caller passed no aria-label.
     */
    title?: string;
    /** Rose rather than sky, for the destructive options: delete contents, move the files. */
    tone?: Tone;
  }>(),
  { indeterminate: false, disabled: false, title: undefined, tone: 'accent' },
);

/**
 * Serves both binding shapes. `v-model` for the plain option toggles; `:model-value` plus
 * `@change` for the selection boxes, whose parents own an array and derive this box's
 * state from it. Vue compiles `v-model` on a checkbox to precisely the `:checked` +
 * `@change` pair written by hand in the template below, so these are one path, not two.
 */
const model = defineModel<boolean>({ default: false });

/**
 * Re-emitted so the array-owning parents keep reading exactly as they did:
 * `@change="toggleAll()"`. It must fire whether or not the value actually moved -
 * `defineModel`'s setter returns early when the new value equals the old one, and the
 * matrix tests dispatch `change` without flipping `element.checked` first, so a parent
 * listening on `update:modelValue` alone would never hear them. Declaring `change` also
 * keeps `onChange` out of `$attrs`, so the input can never end up with two handlers.
 */
const emit = defineEmits<{ change: [event: Event] }>();

defineOptions({ inheritAttrs: false });

/**
 * `data-testid`, `aria-label` and `name` belong on the input - that is the node tests
 * query and assistive tech reads, and where they sit today. `class` belongs on the
 * wrapper, because the only classes callers pass are layout (`mt-0.5` against an
 * `items-start` label) and layout on an invisible, absolutely positioned input does
 * nothing. Hence the split rather than a plain `v-bind="$attrs"`.
 */
const attrs = useAttrs();
const inputAttrs = computed<Record<string, unknown>>(() => {
  const rest: Record<string, unknown> = { ...attrs };
  delete rest.class;
  delete rest.style;
  return rest;
});

/** Checked and indeterminate read the same from a metre away: a filled box with a mark. */
const marked = computed(() => props.indeterminate || model.value);

const TONES: Record<Tone, { readonly on: string; readonly hover: string; readonly focus: string }> = {
  accent: {
    on: 'border-accent bg-accent text-surface',
    hover: 'peer-hover:border-accent/70',
    focus: 'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40',
  },
  danger: {
    on: 'border-danger bg-danger text-surface',
    hover: 'peer-hover:border-danger/70',
    focus: 'peer-focus-visible:ring-2 peer-focus-visible:ring-danger/40',
  },
};

/**
 * `peer-*` compiles to a previous-sibling selector, so the input having to be written
 * before the box is load-bearing, not cosmetic. Hover, focus and disabled are read off
 * the DOM through it, since no prop describes them; the fill is prop-driven so that it
 * and the mark cannot fall out of step.
 */
const boxClasses = computed(() => [
  'pointer-events-none absolute inset-0 flex items-center justify-center rounded-[3px] border transition-colors',
  'peer-disabled:opacity-40',
  TONES[props.tone].hover,
  TONES[props.tone].focus,
  marked.value ? TONES[props.tone].on : 'border-line-strong bg-raised',
]);

function onChange(event: Event): void {
  model.value = (event.target as HTMLInputElement).checked;
  emit('change', event);
}
</script>

<template>
  <span
    class="relative inline-flex h-3.5 w-3.5 shrink-0 align-middle"
    :class="attrs.class"
    :title="props.title"
  >
    <input
      v-bind="inputAttrs"
      type="checkbox"
      class="peer absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      :checked="model"
      :indeterminate="props.indeterminate"
      :disabled="props.disabled"
      :title="props.title"
      @change="onChange"
    />
    <span :class="boxClasses" aria-hidden="true">
      <IconRemove v-if="props.indeterminate" size="xs" />
      <IconCheck v-else-if="model" size="xs" />
    </span>
  </span>
</template>
