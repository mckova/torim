export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Friendlier wording for the API's error codes. */
const MESSAGES: Record<string, string> = {
  "this link name is taken": "That link is taken. Try another one.",
  "email already registered": "This email is already registered. You can sign in instead.",
  "invalid email": "That email address doesn't look right.",
  "too many requests, try again in a minute": "Too many requests. Try again in a minute.",
  "link name must be 3-40 latin letters, digits or dashes": "Links use 3 to 40 latin letters, digits or dashes.",
  "the owner account cannot be deactivated": "The owner account can't be deactivated.",
  "a password of at least 8 characters is required": "Use a password of at least 8 characters.",
  "owner only": "Only the owner can do this.",
  "booking is not upcoming": "This booking is already in the past.",
  "color must be #rrggbb": "That colour isn't valid.",
  "AI is busy, try again in a moment": "The assistant is busy. Try again in a moment.",
  "slot is no longer available": "Someone just took that time. Pick another one.",
  "booking is not active": "This booking is no longer active.",
  "wrong or expired code": "That code is wrong or has expired.",
  "wrong email or password": "Wrong email or password.",
  "nobody is waiting": "Nobody is waiting right now.",
  "hold expired": "The hold on that time ran out. Pick a time again.",
};

export function translateError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message.startsWith("changes are possible up to")) {
      const h = e.message.match(/\d+/)?.[0];
      return `Changes are possible up to ${h} hours before the appointment. Please contact the business.`;
    }
    return MESSAGES[e.message] ?? e.message;
  }
  return "Something went wrong. Try again.";
}

export function createApi(getToken: () => string | null = () => null) {
  async function request<T>(method: string, path: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, window.location.origin);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url.pathname + url.search, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      } catch {
        /* not json */
      }
      throw new ApiError(res.status, detail);
    }
    return res.json() as Promise<T>;
  }
  return {
    get: <T>(path: string, params?: Record<string, unknown>) => request<T>("GET", path, undefined, params),
    post: <T>(path: string, body?: unknown, params?: Record<string, unknown>) => request<T>("POST", path, body ?? {}, params),
    put: <T>(path: string, body?: unknown, params?: Record<string, unknown>) => request<T>("PUT", path, body ?? {}, params),
    del: <T>(path: string) => request<T>("DELETE", path),
  };
}
