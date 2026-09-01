import type {
  ConnectionTestRequest,
  ConnectionTestResult,
  CreateInstanceInput,
  InstanceListResponse,
  InstanceResponse,
  UpdateInstanceInput,
} from '@arrranger/shared';
import { api } from './client';

export const instancesApi = {
  list: () => api.get<InstanceListResponse>('/instances'),
  create: (body: CreateInstanceInput) => api.post<InstanceResponse>('/instances', body),
  update: (id: number, body: UpdateInstanceInput) =>
    api.patch<InstanceResponse>(`/instances/${id}`, body),
  remove: (id: number) => api.delete<void>(`/instances/${id}`),
  test: (id: number) => api.post<ConnectionTestResult>(`/instances/${id}/test`),
  testCandidate: (body: ConnectionTestRequest) =>
    api.post<ConnectionTestResult>('/instances/test', body),
};
