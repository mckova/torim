import { createApi } from "@torim/shared";

const KEY = "torim.customer";

export interface Session {
  token: string;
  slug: string;
  phone: string;
}

export function getSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
}

export const api = createApi(() => getSession()?.token ?? null);

/** Remember booking links on this device, so "my appointments" works without signing in. */
const BOOKINGS = "torim.bookings";
export function rememberBooking(uid: string, token: string) {
  const all = knownBookings().filter((b) => b.uid !== uid);
  all.unshift({ uid, token });
  localStorage.setItem(BOOKINGS, JSON.stringify(all.slice(0, 30)));
}
export function knownBookings(): { uid: string; token: string }[] {
  try {
    return JSON.parse(localStorage.getItem(BOOKINGS) || "[]");
  } catch {
    return [];
  }
}
