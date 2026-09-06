<script setup lang="ts">
import { FileGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="FileGlyph" data-icon="file" />
</template>
