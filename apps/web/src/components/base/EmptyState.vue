<script setup lang="ts">
defineProps<{ title: string; description?: string; icon?: string }>();
</script>

<template>
  <div class="rounded-lg border border-dashed border-line bg-raised/40 px-6 py-10 text-center">
    <div v-if="icon" class="mb-3 text-2xl">{{ icon }}</div>
    <p class="text-sm font-medium text-ink">{{ title }}</p>
    <p v-if="description" class="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted">
      {{ description }}
    </p>
    <div class="mt-4 flex justify-center">
      <slot />
    </div>
  </div>
</template>
