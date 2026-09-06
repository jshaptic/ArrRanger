<script setup lang="ts">
import { SearchGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="SearchGlyph" data-icon="search" />
</template>
