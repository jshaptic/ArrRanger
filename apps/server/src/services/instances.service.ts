import {
  createInstanceSchema,
  normaliseBaseUrl,
  type ConnectionTestRequest,
  type ConnectionTestResult,
  type CreateInstance,
  type Instance,
  type InstanceWithKey,
  type UpdateInstance,
} from '@arrranger/shared';
import { ArrClient } from '../arr/client.js';
import type { ArrDispatcherPool } from '../arr/http.js';
import type { InstancesRepository } from '../repositories/instances.repo.js';
import type { SnapshotsRepository } from '../repositories/snapshots.repo.js';

export interface InstancesServiceDeps {
  readonly instances: InstancesRepository;
  readonly snapshots: SnapshotsRepository;
  readonly dispatchers: ArrDispatcherPool;
}

export interface InstanceWriteResult {
  readonly instance: Instance;
  readonly test: ConnectionTestResult;
}

/** Fields whose change invalidates the pooled dispatcher and the cached snapshots. */
const CONNECTION_FIELDS = ['baseUrl', 'apiKey', 'verifySsl', 'timeoutMs', 'kind'] as const;

export class InstancesService {
  constructor(private readonly deps: InstancesServiceDeps) {}

  list(): Instance[] {
    return this.deps.instances.list();
  }

  require(id: number): Instance {
    return this.deps.instances.require(id);
  }

  /**
   * Saves the instance and immediately probes it. A failing probe is reported, not
   * fatal - people add instances while the container is still starting.
   */
  async create(input: CreateInstance): Promise<InstanceWriteResult> {
    const instance = this.deps.instances.create(input);
    const test = await this.testSaved(instance.id);
    return { instance: this.deps.instances.require(instance.id), test };
  }

  async update(id: number, patch: UpdateInstance): Promise<InstanceWriteResult> {
    const instance = this.deps.instances.update(id, patch);

    const connectionChanged = CONNECTION_FIELDS.some((field) => patch[field] !== undefined);
    if (connectionChanged) {
      await this.deps.dispatchers.invalidate(id);
      this.deps.snapshots.invalidate(id);
    }

    const test = await this.testSaved(instance.id);
    return { instance: this.deps.instances.require(instance.id), test };
  }

  async remove(id: number): Promise<void> {
    this.deps.instances.remove(id);
    await this.deps.dispatchers.invalidate(id);
  }

  /** Probes a stored instance and records the outcome on the row. */
  async testSaved(id: number): Promise<ConnectionTestResult> {
    const instance = this.deps.instances.requireWithKey(id);
    const client = new ArrClient(instance, { dispatcher: this.deps.dispatchers.get(instance) });
    const result = await client.testConnection();
    this.deps.instances.recordProbe(id, result);
    return result;
  }

  /** Probes credentials that have not been saved - the "Test" button on the add form. */
  async testCandidate(input: ConnectionTestRequest): Promise<ConnectionTestResult> {
    const candidate = createInstanceSchema
      .pick({ kind: true, baseUrl: true, apiKey: true, verifySsl: true, timeoutMs: true })
      .parse({ ...input, baseUrl: normaliseBaseUrl(input.baseUrl) });

    const instance: InstanceWithKey = {
      id: -1,
      name: 'candidate',
      kind: candidate.kind,
      baseUrl: candidate.baseUrl,
      apiKey: candidate.apiKey,
      verifySsl: candidate.verifySsl,
      enabled: true,
      timeoutMs: candidate.timeoutMs,
      appVersion: null,
      lastConnectedAt: null,
      lastError: null,
      createdAt: '',
      updatedAt: '',
    };

    const dispatcher = this.deps.dispatchers.createEphemeral({
      verifySsl: candidate.verifySsl,
      timeoutMs: candidate.timeoutMs,
    });

    try {
      return await new ArrClient(instance, { dispatcher }).testConnection();
    } finally {
      await dispatcher.close();
    }
  }
}
