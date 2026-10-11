/** Thin fetch wrapper for the API (same origin in dev via the Vite proxy). */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...rest,
    headers: { accept: 'application/json', ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; message?: string; details?: Array<{ path: string; message: string }> };
    throw new ApiError(res.status, b.error ?? b.message ?? `Request failed (${res.status})`, b.details);
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.details?.length) return err.details.map((d) => d.message).join('. ');
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
