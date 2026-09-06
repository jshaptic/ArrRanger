<script setup lang="ts">
import { RemoveGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="RemoveGlyph" data-icon="remove" />
</template>
