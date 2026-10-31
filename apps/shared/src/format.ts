const TZ = "Asia/Jerusalem";

export const WEEKDAYS_FROM_MONDAY = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"];
/** Display order for an Israeli week: Sunday first. Values are backend weekdays (0 = Monday). */
export const ISRAELI_WEEK = [6, 0, 1, 2, 3, 4, 5];

export function time(iso: string, tz = TZ) {
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

export function dayLong(iso: string, tz = TZ) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(new Date(iso));
}

export function dayShort(isoDate: string) {
  const d = new Date(isoDate + "T12:00:00");
  return {
    weekday: new Intl.DateTimeFormat("he-IL", { weekday: "short" }).format(d),
    day: d.getDate(),
    month: new Intl.DateTimeFormat("he-IL", { month: "short" }).format(d),
  };
}

export function money(n: number) {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
}

/** YYYY-MM-DD for a date in the business timezone. */
export function isoDate(d: Date = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function duration(min: number) {
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}:${String(m).padStart(2, "0")} שע׳` : h === 1 ? "שעה" : `${h} שעות`;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: "ממתין לאישור",
  confirmed: "מאושר",
  completed: "הושלם",
  cancelled: "בוטל",
  no_show: "לא הגיע",
};

export function phoneDisplay(p: string) {
  return p.startsWith("+972") ? "0" + p.slice(4).replace(/(\d{2})(\d{7})/, "$1-$2") : p;
}
