<script setup lang="ts">
import { CaretDownGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CaretDownGlyph" data-icon="caret-down" />
</template>
