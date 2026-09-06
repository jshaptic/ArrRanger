<script setup lang="ts">
import { HelpGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="HelpGlyph" data-icon="help" />
</template>
