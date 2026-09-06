<script setup lang="ts">
import { ToggleGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="ToggleGlyph" data-icon="toggle" />
</template>
