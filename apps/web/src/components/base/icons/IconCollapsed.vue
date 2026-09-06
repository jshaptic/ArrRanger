<script setup lang="ts">
import { CollapsedGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CollapsedGlyph" data-icon="collapsed" />
</template>
