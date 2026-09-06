<script setup lang="ts">
import { BackGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="BackGlyph" data-icon="back" />
</template>
