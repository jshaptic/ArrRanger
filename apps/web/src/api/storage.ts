import type {
  FsListResponse,
  FsMeasurement,
  FsOp,
  FsPreflight,
  FsRootsResponse,
  QueuePayloadFor,
  ReconcileReport,
} from '@arrranger/shared';
import { api } from './client';

export const storageApi = {
  roots: () => api.get<FsRootsResponse>('/storage/roots'),

  list: (path: string) =>
    api.get<FsListResponse>(`/storage/list?path=${encodeURIComponent(path)}`),

  measure: (path: string) =>
    api.get<FsMeasurement>(`/storage/measure?path=${encodeURIComponent(path)}`),

  /** What would happen if this ran, asked before anything is staged. */
  preflight: <K extends FsOp>(op: K, payload: QueuePayloadFor<K>) =>
    api.post<FsPreflight>('/storage/preflight', { op, payload }),

  reconcile: (refresh = false) =>
    api.get<ReconcileReport>(`/storage/reconcile${refresh ? '?refresh=true' : ''}`),
};
