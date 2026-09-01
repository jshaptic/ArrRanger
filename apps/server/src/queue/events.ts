import { EventEmitter } from 'node:events';
import type { RunEvent } from '@arrranger/shared';

export interface SequencedRunEvent {
  /** Monotonic per-process id, used as the SSE `id:` field for Last-Event-ID replay. */
  readonly id: number;
  readonly runId: number;
  readonly event: RunEvent;
}

export type RunEventListener = (event: SequencedRunEvent) => void;

const MAX_BUFFERED_EVENTS = 250;
const MAX_BUFFERED_RUNS = 5;

/**
 * In-process fan-out of run progress to SSE subscribers.
 *
 * A short replay buffer per run means a client that connects a moment after Apply All
 * still sees the steps that already completed, rather than an empty progress bar.
 */
export class RunEventBus {
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<number, SequencedRunEvent[]>();
  private sequence = 0;

  constructor() {
    // One listener per SSE connection; a busy UI can hold several tabs open.
    this.emitter.setMaxListeners(64);
  }

  publish(runId: number, event: RunEvent): SequencedRunEvent {
    const sequenced: SequencedRunEvent = { id: ++this.sequence, runId, event };

    const buffer = this.buffers.get(runId) ?? [];
    buffer.push(sequenced);
    if (buffer.length > MAX_BUFFERED_EVENTS) buffer.splice(0, buffer.length - MAX_BUFFERED_EVENTS);
    this.buffers.set(runId, buffer);
    this.trimBuffers();

    this.emitter.emit(String(runId), sequenced);
    return sequenced;
  }

  subscribe(runId: number, listener: RunEventListener): () => void {
    const channel = String(runId);
    this.emitter.on(channel, listener);
    return () => this.emitter.off(channel, listener);
  }

  /** Events buffered after `afterId`, for a subscriber that reconnected. */
  replay(runId: number, afterId = 0): SequencedRunEvent[] {
    return (this.buffers.get(runId) ?? []).filter((entry) => entry.id > afterId);
  }

  private trimBuffers(): void {
    if (this.buffers.size <= MAX_BUFFERED_RUNS) return;
    const oldest = [...this.buffers.keys()].sort((a, b) => a - b);
    for (const runId of oldest.slice(0, this.buffers.size - MAX_BUFFERED_RUNS)) {
      this.buffers.delete(runId);
    }
  }
}
