<script setup lang="ts">
import { FolderOpenGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="FolderOpenGlyph" data-icon="folder-open" />
</template>
