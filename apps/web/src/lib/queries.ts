import type { CommuteDto } from '@mct/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

export interface Station {
  crs: string;
  name: string;
}
export interface Operator {
  code: string;
  name: string;
}

export const commutesQuery = queryOptions({
  queryKey: ['commutes'],
  queryFn: () => api<{ commutes: CommuteDto[] }>('/api/commutes').then((r) => r.commutes),
});

export const commuteQuery = (id: string) =>
  queryOptions({
    queryKey: ['commutes', id],
    queryFn: () => api<CommuteDto>(`/api/commutes/${id}`),
  });

export const operatorsQuery = queryOptions({
  queryKey: ['operators'],
  queryFn: () => api<{ operators: Operator[] }>('/api/operators').then((r) => r.operators),
  staleTime: 60 * 60_000,
});

export const stationSearchQuery = (q: string) =>
  queryOptions({
    queryKey: ['stations', q.trim().toLowerCase()],
    queryFn: ({ signal }) => api<{ stations: Station[] }>(`/api/stations?q=${encodeURIComponent(q.trim())}`, { signal }).then((r) => r.stations),
    enabled: q.trim().length >= 2,
    staleTime: 10 * 60_000,
  });
