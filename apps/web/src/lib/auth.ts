import { createAuthClient } from 'better-auth/react';
import { queryOptions } from '@tanstack/react-query';
import { API_BASE } from './api';

export const authClient = createAuthClient({
  baseURL: API_BASE || window.location.origin,
  basePath: '/api/auth',
});

export interface SessionInfo {
  user: { id: string; email: string; name: string; emailVerified: boolean };
}

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionInfo | null> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(error.message ?? 'Could not check your session');
    return data ? { user: data.user } : null;
  },
  staleTime: 60_000,
});

/** Better Auth error → readable message. */
export function authErrorMessage(error: { message?: string; status?: number; code?: string } | null | undefined): string {
  if (!error) return 'Something went wrong';
  if (error.code === 'EMAIL_NOT_VERIFIED' || error.status === 403) return 'Please confirm your email address first — check your inbox for the link.';
  if (error.status === 429) return 'Too many attempts. Please wait a minute and try again.';
  return error.message ?? 'Something went wrong';
}
