<script setup lang="ts">
import { computed } from 'vue';
import type { GlyphEntry } from './glyphs';

/**
 * Six fixed steps, not `em`. The em scale this replaced made an icon's size a function of
 * whichever `text-[11px]` happened to sit above it, so one `<IconWarning />` was 17.6px in
 * a table row and 22.4px in a heading with no way to say which was meant - and no test
 * could see either, because vitest runs with `css: false` and no Tailwind. A token is a
 * class string in the DOM: assertable, greppable, and the same wherever it is written.
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** Remix `-Line` and `-Fill`, named for what they read as rather than for what Remix calls them. */
export type IconVariant = 'outline' | 'solid';

/**
 * What every wrapper accepts and hands on. Exported so the 36 declare one shape instead of
 * 36 copies of it, and so a third knob is one edit here plus a codemod, never 36 hand-edits
 * that can silently be 35.
 */
export interface IconProps {
  size?: IconSize;
  variant?: IconVariant;
}

const props = withDefaults(defineProps<IconProps & { glyph: GlyphEntry }>(), {
  size: 'md',
  variant: 'outline',
});

/**
 * Fixed-scale utilities only - never a bracketed arbitrary value. Tailwind emits arbitrary
 * values after fixed ones, so a single bracketed entry in this table would outrank every
 * other entry in the same table: a token that silently ignores five of the six sizes.
 * The suite pins the absence of brackets rather than trusting the next person to remember.
 */
const SIZES: Record<IconSize, string> = {
  xs: 'h-3 w-3', //        12px - the dense 10-11px matrix and dialog chrome
  sm: 'h-3.5 w-3.5', //    14px - `text-xs` contexts: the folder tree, toolbar buttons
  md: 'h-4 w-4', //        16px - body text
  lg: 'h-4.5 w-4.5', //    18px - the optically light glyphs, warning and focus
  xl: 'h-6 w-6', //        24px - a warning in a section heading
  '2xl': 'h-7 w-7', //     28px - EmptyState
};

/**
 * `app-icon` carries no rule any more; it is the only selector meaning "any icon", since
 * `data-icon` is per-meaning. Kept as the hook a future `forced-colors` or print rule would
 * need, and asserted by the suite so it cannot be mistaken for a leftover and deleted.
 *
 * `align-[-0.15em]` resolves against the *inherited* font size, so it is deliberately not
 * part of the size table - the two are independent and pairing them would make every size
 * change a vertical-rhythm change too.
 */
const classes = computed(() => [
  'app-icon inline-flex shrink-0 items-center justify-center align-[-0.15em]',
  SIZES[props.size],
]);

/**
 * `aria-hidden` on the root is unconditional. An icon here is always either decoration
 * beside a label, or the whole content of a control whose accessible name belongs on the
 * control itself, never on its child.
 *
 * Note for anyone editing the template: keep it to a single root element with no sibling
 * comment. A comment node beside the root makes this a fragment, and Vue then stops
 * inheriting `data-icon` onto the span - silently, since fallthrough has nowhere to land.
 */

/**
 * `solid` is optional because two glyphs have no filled twin. Falling back to the outline
 * is the right failure: `variant="solid"` is a request for weight, and an icon that cannot
 * honour it should still draw. Making it a type error instead would leak the library's
 * inventory into 36 wrapper signatures, which is the one thing this layer exists to prevent.
 */
const drawing = computed(() =>
  props.variant === 'solid' ? (props.glyph.solid ?? props.glyph.outline) : props.glyph.outline,
);
</script>

<template>
  <span :class="classes" aria-hidden="true">
    <component :is="drawing" class="h-full w-full" focusable="false" />
  </span>
</template>
