export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  "slot is no longer available": "השעה הזו נתפסה הרגע. בחרו שעה אחרת.",
  "booking is not active": "התור כבר אינו פעיל.",
  "wrong or expired code": "הקוד שגוי או שפג תוקפו.",
  "wrong email or password": "אימייל או סיסמה שגויים.",
  "nobody is waiting": "אין אף אחד בתור כרגע.",
  "hold expired": "הזמן לשמירת השעה עבר. בחרו שעה שוב.",
};

export function translateError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message.startsWith("changes are possible up to")) {
      const h = e.message.match(/\d+/)?.[0];
      return `אפשר לשנות או לבטל עד ${h} שעות לפני התור. צרו קשר עם בית העסק.`;
    }
    return MESSAGES[e.message] ?? e.message;
  }
  return "משהו השתבש. נסו שוב.";
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
