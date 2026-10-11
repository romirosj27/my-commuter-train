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

export type TicketType = 'single' | 'return' | 'season';
export type ClaimStatus = 'none' | 'claimed' | 'paid' | 'rejected';

export interface Eligibility {
  status: 'eligible' | 'not_eligible' | 'needs_arrival_time' | 'no_scheme';
  delayMin: number | null;
  percent: number | null;
  message: string;
  schemeVerified: boolean;
}

export interface Journey {
  id: string;
  travelDate: string;
  originCrs: string;
  originName: string;
  destCrs: string;
  destName: string;
  toc: string;
  operator: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  arrivalDelayMin: number | null;
  destCancelled: boolean;
  ticketType: TicketType;
  claimStatus: ClaimStatus;
  source: 'live' | 'hsp' | 'manual';
  eligibility: Eligibility;
  claimUrl: string | null;
}

export interface Suggestion {
  direction: 'outbound' | 'return';
  commuteId: string;
  serviceId: string;
  basis: 'usual' | 'first';
  travelDate: string;
  originCrs: string;
  originName: string;
  destCrs: string;
  destName: string;
  toc: string;
  operator: string;
  schedDep: string;
  schedArr: string;
  actualArr: string | null;
  destCancelled: boolean;
}

export interface Band {
  minMinutes: number;
  maxMinutes: number | null;
  singlePct: number;
  returnPct: number;
}

export interface Scheme {
  toc: string;
  operator: string;
  name: string;
  bands: Band[];
  claimUrl: string | null;
  notes: string | null;
  verifiedOn: string | null;
  updatedAt: string;
}

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api<{ id: string; email: string; name: string; isAdmin: boolean }>('/api/me'),
  staleTime: 5 * 60_000,
});

export const journeysQuery = queryOptions({
  queryKey: ['journeys'],
  queryFn: () => api<{ journeys: Journey[]; note: string }>('/api/journeys'),
});

export const suggestionsQuery = (date: string) =>
  queryOptions({
    queryKey: ['journeys', 'suggestions', date],
    queryFn: () => api<{ date: string; suggestions: Suggestion[] }>(`/api/journeys/suggestions?date=${date}`).then((r) => r.suggestions),
  });

export const schemesQuery = queryOptions({
  queryKey: ['delay-repay', 'schemes'],
  queryFn: () => api<{ schemes: Scheme[]; note: string }>('/api/delay-repay/schemes'),
});
