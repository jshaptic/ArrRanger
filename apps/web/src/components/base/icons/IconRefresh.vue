<script setup lang="ts">
import { RefreshGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="RefreshGlyph" data-icon="refresh" />
</template>
