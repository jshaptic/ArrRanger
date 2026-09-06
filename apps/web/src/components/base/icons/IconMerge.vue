<script setup lang="ts">
import { MergeGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="MergeGlyph" data-icon="merge" />
</template>
