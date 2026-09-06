<script setup lang="ts">
import { QueueGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="QueueGlyph" data-icon="queue" />
</template>
