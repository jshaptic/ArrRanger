<script setup lang="ts">
import { AbsentGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="AbsentGlyph" data-icon="absent" />
</template>
