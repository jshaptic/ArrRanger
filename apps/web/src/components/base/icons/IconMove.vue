<script setup lang="ts">
import { MoveGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="MoveGlyph" data-icon="move" />
</template>
