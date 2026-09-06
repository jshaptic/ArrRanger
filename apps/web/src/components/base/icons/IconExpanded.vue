<script setup lang="ts">
import { ExpandedGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="ExpandedGlyph" data-icon="expanded" />
</template>
