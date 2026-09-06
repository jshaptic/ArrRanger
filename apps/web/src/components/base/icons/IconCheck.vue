<script setup lang="ts">
import { CheckGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CheckGlyph" data-icon="check" />
</template>
