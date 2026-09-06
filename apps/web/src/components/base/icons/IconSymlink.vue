<script setup lang="ts">
import { SymlinkGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="SymlinkGlyph" data-icon="symlink" />
</template>
