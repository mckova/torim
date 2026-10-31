import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Booking, Icon, STATUS_LABEL, addDays, isoDate, money, time } from "@torim/shared";
import { api, useMe } from "../api";
import { BookingModal, NewBookingModal, useToast } from "../components";
import { AssistantCard, ReminderModal } from "../ai";
import { DayBoard, RiskMap, minutesOf } from "../DayBoard";

function greeting(name: string) {
  const h = +new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
  const first = name.split(" ")[0];
  if (h < 12) return `Good morning, ${first}.`;
  if (h < 17) return `Good afternoon, ${first}.`;
  return `Good evening, ${first}.`;
}

const dateChip = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/** The day at a glance: who is in which chair, what the assistant wants from you, who is in the chair right now. */
export default function Today() {
  const { data } = useMe();
  const [day, setDay] = useState(isoDate());
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [risk, setRisk] = useState<RiskMap>({});
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [remind, setRemind] = useState<Booking | null>(null);
  const [toast, show] = useToast();

  function load() {
    api.get<Booking[]>("/api/pro/bookings", { start: day, end: day }).then(setRows);
    api
      .get<{ bookings: { booking_id: number; level: string; probability: number; reasons: string[] }[] }>("/api/pro/risk", { start: day, days: 1 })
      .then((r) => setRisk(Object.fromEntries(r.bookings.map((x) => [x.booking_id, x]))))
      .catch(() => setRisk({}));
    api
      .get<{ date: string; status: string }[]>("/api/pro/waitlist")
      .then((w) => setWaiting(w.filter((e) => e.date === day && e.status === "waiting").length))
      .catch(() => setWaiting(0));
  }
  useEffect(load, [day]);

  function changed(b: Booking) {
    setRows((r) => r?.map((x) => (x.id === b.id ? b : x)) ?? null);
    setOpen((o) => (o && o.id === b.id ? b : o));
    show(`Updated: ${STATUS_LABEL[b.status]}`);
  }

  async function bookingById(id: number) {
    const found = rows?.find((b) => b.id === id);
    if (found) return found;
    const list = await api.get<Booking[]>("/api/pro/bookings", { start: isoDate(), end: addDays(isoDate(), 60) });
    return list.find((b) => b.id === id) ?? null;
  }

  async function offer() {
    try {
      const r = await api.post<{ sent: number }>("/api/pro/waitlist/offer-today");
      show(r.sent ? `Sent to ${r.sent} on the waitlist. First to book gets it.` : "Nobody on the waitlist fits the free time.");
      load();
    } catch {
      show("Couldn't reach the waitlist. Try again.");
    }
  }

  const isToday = day === isoDate();
  const live = rows?.filter((b) => b.status !== "cancelled" && b.status !== "no_show") ?? [];
  const expected = live.reduce((s, b) => s + b.price, 0);
  const staff = data.me.role === "owner" ? data.providers.filter((p) => p.active) : data.providers.filter((p) => p.id === data.me.id);
  const nowMin = minutesOf(new Date().toISOString());
  const inChair = isToday ? live.filter((b) => minutesOf(b.start) <= nowMin && nowMin < minutesOf(b.end)) : [];
  const next = isToday ? live.filter((b) => minutesOf(b.start) > nowMin).sort((a, b) => a.start.localeCompare(b.start))[0] : undefined;

  return (
    <div className="today">
      <header className="hero">
        <h1>
          {isToday ? greeting(data.me.name) : new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          <span className="hero-line">
            {isToday ? "Today brings" : "The day has"} <span className="pill">{live.length} {live.length === 1 ? "client" : "clients"}</span> and <span className="pill">{money(expected)}</span>
          </span>
        </h1>
        <div className="hero-ctrls">
          <div className="seg" role="group" aria-label="View">
            <span className="on" aria-current="page">
              Day
            </span>
            <Link to="/calendar">Week</Link>
          </div>
          <div className="date-chip">
            <button onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
              <Icon name="arrow" />
            </button>
            <button className="date-label" onClick={() => setDay(isoDate())} title="Back to today">
              {isToday ? `Today, ${dateChip(day).split(", ")[1]}` : dateChip(day)}
            </button>
            <button onClick={() => setDay(addDays(day, 1))} aria-label="Next day">
              <Icon name="arrow" className="flip" />
            </button>
          </div>
          <button className="btn cta" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New booking
          </button>
        </div>
      </header>

      <div className="today-grid">
        <section className="panel board-panel" aria-label="Day by staff">
          {!rows ? (
            <div className="skeleton" style={{ height: 520 }} />
          ) : (
            <DayBoard staff={staff} bookings={rows} risk={risk} isToday={isToday} waiting={waiting} onOpen={setOpen} onCreate={() => setCreating(true)} onOffer={offer} />
          )}
          {rows && live.length === 0 && (
            <div className="board-empty">
              <p>Nothing booked for this day yet.</p>
              <button className="btn ghost sm" onClick={() => setCreating(true)}>
                Add a booking
              </button>
            </div>
          )}
        </section>

        <aside className="side">
          {isToday && (
            <AssistantCard
              onChanged={load}
              onOpenBooking={(id) => bookingById(id).then((b) => b && setOpen(b))}
              onRemind={(id) => bookingById(id).then((b) => b && setRemind(b))}
            />
          )}
          {isToday && (inChair.length > 0 || next) && <ChairCard now={inChair} next={next} nowMin={nowMin} />}
        </aside>
      </div>

      {open && (
        <BookingModal
          b={open}
          onClose={() => setOpen(null)}
          onChange={changed}
          onRemind={(b) => {
            setOpen(null);
            setRemind(b);
          }}
        />
      )}
      {remind && (
        <ReminderModal
          booking={remind}
          onClose={() => setRemind(null)}
          onSent={() => {
            setRemind(null);
            show("Reminder sent on WhatsApp");
          }}
        />
      )}
      {creating && (
        <NewBookingModal
          date={day}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
            show("Booked. The client got a confirmation.");
          }}
        />
      )}
      {toast}
    </div>
  );
}

function ChairCard({ now, next, nowMin }: { now: Booking[]; next?: Booking; nowMin: number }) {
  const b = now[0];
  if (!b && next) {
    const mins = minutesOf(next.start) - nowMin;
    return (
      <section className="panel night chair" aria-label="Next up">
        <span className="chair-label">Next up</span>
        <b className="chair-name">{next.customer.name}</b>
        <div className="chair-row">
          <span>
            {next.service.name} with {next.provider.name.split(" ")[0]}
          </span>
          <span>{mins < 60 ? `in ${mins} min` : time(next.start)}</span>
        </div>
      </section>
    );
  }
  const s = minutesOf(b.start);
  const e = minutesOf(b.end);
  const pct = Math.min(100, Math.max(0, ((nowMin - s) / (e - s)) * 100));
  return (
    <section className="panel night chair" aria-label="In the chair now">
      <span className="chair-label">In the chair now{now.length > 1 ? ` · ${now.length} chairs busy` : ""}</span>
      <b className="chair-name">{b.customer.name}</b>
      <div className="chair-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Time used">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="chair-row">
        <span>
          {b.service.name} with {b.provider.name.split(" ")[0]}
        </span>
        <span>{e - nowMin} min left</span>
      </div>
    </section>
  );
}
