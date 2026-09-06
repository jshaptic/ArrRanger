<script setup lang="ts">
import { FocusGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

/**
 * Bumped for the same reason as `IconWarning`: a lens is mostly empty circle, so it reads
 * a size smaller than the solid glyphs it sits beside in a folder row.
 */
const props = withDefaults(defineProps<IconProps>(), { size: 'lg' });
</script>

<template>
  <BaseIcon v-bind="props" :glyph="FocusGlyph" data-icon="focus" />
</template>
