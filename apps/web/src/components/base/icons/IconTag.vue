<script setup lang="ts">
import { TagGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="TagGlyph" data-icon="tag" />
</template>
