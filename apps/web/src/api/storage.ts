import type {
  FsMeasurement,
  FsOp,
  FsPreflight,
  FsRootsResponse,
  PathMatrixResponse,
  PathSelector,
  QueuePayloadFor,
} from '@arrranger/shared';
import { api } from './client';

export interface MatrixParams {
  /** Directories to expand. Empty asks for the spine: mounts down to each root folder. */
  readonly paths?: readonly string[];
  readonly only?: readonly PathSelector[];
  readonly filter?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly refresh?: boolean;
}

/** Repeatable `path`, so refetching every expanded level costs one request. */
function matrixQuery(params: MatrixParams): string {
  const query = new URLSearchParams();
  for (const target of params.paths ?? []) query.append('path', target);
  if (params.only !== undefined && params.only.length > 0) query.set('only', params.only.join(','));
  if (params.filter !== undefined && params.filter.length > 0) query.set('q', params.filter);
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  if (params.offset !== undefined && params.offset > 0) query.set('offset', String(params.offset));
  if (params.refresh === true) query.set('refresh', 'true');

  const serialised = query.toString();
  return serialised.length === 0 ? '' : `?${serialised}`;
}

export const storageApi = {
  roots: () => api.get<FsRootsResponse>('/storage/roots'),

  /** The joined view: disk truth and *Arr truth, one directory level at a time. */
  matrix: (params: MatrixParams = {}) =>
    api.get<PathMatrixResponse>(`/storage/matrix${matrixQuery(params)}`),

  measure: (path: string) =>
    api.get<FsMeasurement>(`/storage/measure?path=${encodeURIComponent(path)}`),

  /** What would happen if this ran, asked before anything is staged. */
  preflight: <K extends FsOp>(op: K, payload: QueuePayloadFor<K>) =>
    api.post<FsPreflight>('/storage/preflight', { op, payload }),

};
