<script setup lang="ts">
import { ImportListGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="ImportListGlyph" data-icon="import-list" />
</template>
