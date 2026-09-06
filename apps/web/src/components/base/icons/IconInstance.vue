<script setup lang="ts">
import { InstanceGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

const props = defineProps<IconProps>();
</script>

<template>
  <BaseIcon v-bind="props" :glyph="InstanceGlyph" data-icon="instance" />
</template>
