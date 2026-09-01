<script setup lang="ts">
import { computed } from 'vue';
import { describeTargets } from '@/lib/staging';
import { useQueueStore } from '@/stores/queue';

const queue = useQueueStore();

const sentence = computed(() => {
  const impact = queue.impact;
  if (impact.operations === 0) return 'Nothing staged yet';

  const targets = impact.byKind
    .map((entry) => describeTargets(entry.kind, entry.targets))
    .join(', ');
  const instances = `${String(impact.instances)} instance${impact.instances === 1 ? '' : 's'}`;
  const operations = `${String(impact.operations)} API operation${impact.operations === 1 ? '' : 's'}`;

  return `Modifying ${targets} across ${instances} (${operations} total)`;
});

const affected = computed(() => queue.impact.affectedItems);
</script>

<template>
  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <span class="text-sm font-medium text-ink">{{ sentence }}</span>
    <span v-if="affected > 0" class="text-xs text-muted">
      touching {{ affected }} media item(s)
    </span>
    <span v-if="queue.failed.length > 0" class="text-xs text-danger">
      · {{ queue.failed.length }} failed
    </span>
  </div>
</template>
