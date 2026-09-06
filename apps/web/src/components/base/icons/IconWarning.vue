<script setup lang="ts">
import { WarningGlyph } from './glyphs';
import BaseIcon, { type IconProps } from './BaseIcon.vue';

/**
 * Larger than the shared default, and it is optical correction rather than preference. A
 * triangle puts far less ink inside the 24px viewBox than the filled circle of `IconError`
 * sitting in the very same severity column, so at one box size the error shouts and the
 * warning whispers - which inverts the meaning of the pair.
 *
 * It has to be a default rather than a call-site prop because `PathRowView.vue` puts
 * `severity.icon` through one `<component :is>` with one attribute list, so warning and
 * error cannot be told apart there. A caller who does write `size` still wins outright -
 * that is `withDefaults`, not a cascade-order bet.
 */
const props = withDefaults(defineProps<IconProps>(), { size: 'lg' });
</script>

<template>
  <BaseIcon v-bind="props" :glyph="WarningGlyph" data-icon="warning" />
</template>
