import type { ApiErrorBody } from '@suboard/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** App-wide auth events (session expired / temporary password) raised by the API layer. */
export const authEvents = new EventTarget();

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export async function api<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        // Required by the server's CSRF guard for state-changing requests.
        'X-Requested-With': 'suboard',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    const err = new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? 'הבקשה נכשלה', e?.fields);
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') authEvents.dispatchEvent(new Event('unauthorized'));
    if (err.code === 'PASSWORD_CHANGE_REQUIRED') authEvents.dispatchEvent(new Event('password-change-required'));
    throw err;
  }
  return data as T;
}

export const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'אירעה שגיאה בלתי צפויה';

/** Accept only same-app relative paths for post-login redirects (prevents open redirects). */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f]/.test(next)) return '/';
  return next;
}
