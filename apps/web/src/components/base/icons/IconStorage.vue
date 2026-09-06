<script setup lang="ts">
import { StorageGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="StorageGlyph" data-icon="storage" />
</template>
