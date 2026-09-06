<script setup lang="ts">
import { DropdownGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="DropdownGlyph" data-icon="dropdown" />
</template>
