import type {
  ConnectionTestRequest,
  ConnectionTestResult,
  CreateInstanceInput,
  Instance,
  UpdateInstanceInput,
} from '@arrranger/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { instancesApi } from '@/api/instances';
import { ApiRequestError } from '@/api/client';

function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Request failed';
}

export const useInstancesStore = defineStore('instances', () => {
  const items = ref<Instance[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const probing = ref<Record<number, boolean>>({});
  const loadedOnce = ref(false);

  const byId = computed(() => new Map(items.value.map((instance) => [instance.id, instance])));
  const enabled = computed(() => items.value.filter((instance) => instance.enabled));
  const radarr = computed(() => items.value.filter((instance) => instance.kind === 'radarr'));
  const sonarr = computed(() => items.value.filter((instance) => instance.kind === 'sonarr'));
  const unreachable = computed(() =>
    items.value.filter((instance) => instance.lastError !== null && instance.enabled),
  );

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      items.value = [...(await instancesApi.list()).instances];
      loadedOnce.value = true;
    } catch (caught) {
      error.value = messageOf(caught);
    } finally {
      loading.value = false;
    }
  }

  async function create(input: CreateInstanceInput): Promise<ConnectionTestResult | undefined> {
    const response = await instancesApi.create(input);
    items.value = [...items.value, response.instance];
    return response.test;
  }

  async function update(
    id: number,
    patch: UpdateInstanceInput,
  ): Promise<ConnectionTestResult | undefined> {
    const response = await instancesApi.update(id, patch);
    items.value = items.value.map((instance) =>
      instance.id === id ? response.instance : instance,
    );
    return response.test;
  }

  async function remove(id: number): Promise<void> {
    await instancesApi.remove(id);
    items.value = items.value.filter((instance) => instance.id !== id);
  }

  /** Re-probes a stored instance; the row's health fields are refreshed from the server. */
  async function test(id: number): Promise<ConnectionTestResult> {
    probing.value = { ...probing.value, [id]: true };
    try {
      const result = await instancesApi.test(id);
      await load();
      return result;
    } finally {
      const next = { ...probing.value };
      delete next[id];
      probing.value = next;
    }
  }

  function testCandidate(input: ConnectionTestRequest): Promise<ConnectionTestResult> {
    return instancesApi.testCandidate(input);
  }

  return {
    items,
    loading,
    error,
    probing,
    loadedOnce,
    byId,
    enabled,
    radarr,
    sonarr,
    unreachable,
    load,
    create,
    update,
    remove,
    test,
    testCandidate,
  };
});
