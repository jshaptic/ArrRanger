<script setup lang="ts">
import { ErrorGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

/**
 * Smaller than the shared default - the optical counterpart to `IconWarning`'s bump. A
 * filled circle packs the viewBox solid, and this is the small glyph in every dense 11px
 * list it appears in. The folder twisty draws the same icon at `sm` by passing `size`,
 * which beats this.
 */
const props = withDefaults(defineProps<IconProps>(), { size: 'xs' });
</script>

<template>
  <BaseIcon v-bind="props" :glyph="ErrorGlyph" data-icon="error" />
</template>
