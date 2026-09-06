<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{ title: string; description?: string; icon?: Component }>();
</script>

<template>
  <div class="rounded-lg border border-dashed border-line bg-raised/40 px-6 py-10 text-center">
    <!-- A flex row rather than `mx-auto`: an icon is `inline-flex`, and two display
         utilities racing in the cascade is not a thing to leave to luck. The emoji these
         replaced were the only glyphs in the app carrying a colour of their own. -->
    <div v-if="icon" class="mb-3 flex justify-center text-faint">
      <component :is="icon" size="2xl" />
    </div>
    <p class="text-sm font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
      {{ description }}
    </p>
    <div class="mt-4 flex justify-center">
      <slot />
    </div>
  </div>
</template>
