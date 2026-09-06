<script setup lang="ts">
import { CaretUpGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CaretUpGlyph" data-icon="caret-up" />
</template>
