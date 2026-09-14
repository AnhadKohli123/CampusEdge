/**
 * Thin fetch wrapper. Attaches the stored JWT, unwraps JSON, and turns a
 * non-2xx response into a thrown ApiError carrying the server's message so
 * every screen can render one consistent error string.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

const TOKEN_KEY = 'campusedge.token';
const USER_KEY = 'campusedge.user';

export class ApiError extends Error {
  status: number;
  details?: { field?: string; message: string }[];

  constructor(status: number, message: string, details?: ApiError['details']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export const userStore = {
  get<T>(): T | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  set: (user: unknown) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = tokenStore.get();
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? `Request failed (${response.status})`,
      payload?.details
    );
  }
  return payload as T;
}
