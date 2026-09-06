<script setup lang="ts">
import { EditGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="EditGlyph" data-icon="edit" />
</template>
