<script setup lang="ts">
import { computed } from 'vue';
import BaseButton from '@/components/base/BaseButton.vue';
import { pageItems } from '@/components/base/pagination';

const props = withDefaults(
  defineProps<{
    page: number;
    totalPages: number;
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{ page: [next: number] }>();

const items = computed(() => pageItems(props.page, props.totalPages));

function go(next: number): void {
  if (props.loading) return;
  if (next < 1 || next > props.totalPages || next === props.page) return;
  emit('page', next);
}
</script>

<template>
  <nav class="flex flex-wrap items-center gap-1" data-testid="pagination" aria-label="Pagination">
    <BaseButton
      size="sm"
      variant="ghost"
      :disabled="loading || page <= 1"
      data-testid="page-prev"
      @click="go(page - 1)"
    >
      Previous
    </BaseButton>
    <template v-for="(item, index) in items" :key="item === 'gap' ? `gap-${String(index)}` : item">
      <span v-if="item === 'gap'" class="px-1 text-faint" aria-hidden="true">…</span>
      <BaseButton
        v-else
        size="sm"
        :variant="item === page ? 'primary' : 'ghost'"
        :disabled="loading"
        :aria-current="item === page ? 'page' : undefined"
        :data-testid="`page-${String(item)}`"
        @click="go(item)"
      >
        {{ item }}
      </BaseButton>
    </template>
    <BaseButton
      size="sm"
      variant="ghost"
      :disabled="loading || page >= totalPages"
      data-testid="page-next"
      @click="go(page + 1)"
    >
      Next
    </BaseButton>
  </nav>
</template>
