import { useEffect, useState } from "react";
import { addDays, dayShort, isoDate, Slot, time, translateError } from "@torim/shared";
import { api } from "./api";

export function Spinner() {
  return <div className="spinner" />;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert error">{translateError(error)}</div>;
}

export function useAccent(color?: string) {
  useEffect(() => {
    if (!color) return;
    // The business colour marks the business (its monogram), not the interface.
    document.documentElement.style.setProperty("--brand", color);
    return () => {
      document.documentElement.style.removeProperty("--brand");
    };
  }, [color]);
}

export function Steps({ step, total }: { step: number; total: number }) {
  return (
    <div className="steps" aria-label={`Step ${step + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i <= step ? "on" : ""} />
      ))}
    </div>
  );
}

interface DayCount {
  date: string;
  slots: number;
}

/** Day strip + slot grid, used for booking and for rescheduling. */
export function SlotPicker({
  slug,
  serviceId,
  providerId,
  initialDate,
  onPick,
  onNoSlots,
  selected,
}: {
  slug: string;
  serviceId: number;
  providerId: number | null;
  initialDate?: string | null;
  selected?: string | null;
  onPick: (slot: Slot) => void;
  onNoSlots?: (date: string) => void;
}) {
  const [days, setDays] = useState<DayCount[] | null>(null);
  const [date, setDate] = useState<string | null>(initialDate ?? null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setDays(null);
    api
      .get<DayCount[]>(`/api/b/${slug}/days`, { service_id: serviceId, provider_id: providerId ?? undefined, days: 21 })
      .then((d) => {
        setDays(d);
        if (!initialDate) setDate(d.find((x) => x.slots > 0)?.date ?? d[0]?.date ?? isoDate());
      })
      .catch(setError);
  }, [slug, serviceId, providerId, initialDate]);

  useEffect(() => {
    if (!date) return;
    setSlots(null);
    api
      .get<Slot[]>(`/api/b/${slug}/slots`, { service_id: serviceId, date, provider_id: providerId ?? undefined })
      .then(setSlots)
      .catch(setError);
  }, [slug, serviceId, providerId, date]);

  const groups = slots
    ? [
        { label: "Morning", items: slots.filter((s) => +time(s.start).slice(0, 2) < 12) },
        { label: "Afternoon", items: slots.filter((s) => +time(s.start).slice(0, 2) >= 12 && +time(s.start).slice(0, 2) < 17) },
        { label: "Evening", items: slots.filter((s) => +time(s.start).slice(0, 2) >= 17) },
      ].filter((g) => g.items.length)
    : [];

  return (
    <div className="stack">
      <ErrorBox error={error} />
      {!days ? (
        <Spinner />
      ) : (
        <div className="days">
          {days.map((d) => {
            const f = dayShort(d.date);
            return (
              <button key={d.date} className={`day ${d.date === date ? "selected" : ""}`} onClick={() => setDate(d.date)}>
                <span className="tiny muted">{d.date === isoDate() ? "Today" : d.date === addDays(isoDate(), 1) ? "Tmrw" : f.weekday}</span>
                <b>{f.day}</b>
                <span className="tiny muted">{d.slots ? `${d.slots} free` : "Full"}</span>
              </button>
            );
          })}
        </div>
      )}
      {date && !slots && <Spinner />}
      {slots && slots.length === 0 && (
        <div className="card flat center stack">
          <p>No free times on this day.</p>
          {onNoSlots && (
            <button className="btn soft" onClick={() => onNoSlots(date!)}>
              Join the waitlist for this day
            </button>
          )}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label} className="stack tight">
          <span className="small muted">{g.label}</span>
          <div className="slots">
            {g.items.map((s) => (
              <button key={s.start} className={`slot ${selected === s.start ? "selected" : ""}`} onClick={() => onPick(s)}>
                {time(s.start)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

/** Build an .ics file so the customer can add the appointment to any calendar. */
export function icsHref(title: string, start: string, end: string, location: string) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TORIM//EN",
    "BEGIN:VEVENT",
    `UID:${f(start)}-${Math.random().toString(36).slice(2)}@torim`,
    `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(start)}`,
    `DTEND:${f(end)}`,
    `SUMMARY:${title}`,
    `LOCATION:${location}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${title}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(body);
}
