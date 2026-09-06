<script setup lang="ts">
import { SkipGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="SkipGlyph" data-icon="skip" />
</template>
