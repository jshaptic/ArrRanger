<script setup lang="ts">
import { CloseGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CloseGlyph" data-icon="close" />
</template>
