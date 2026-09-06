<script setup lang="ts">
import { CreateGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="CreateGlyph" data-icon="create" />
</template>
