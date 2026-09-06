<script setup lang="ts">
import { MoveUpGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="MoveUpGlyph" data-icon="move-up" />
</template>
