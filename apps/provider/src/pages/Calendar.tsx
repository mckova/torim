import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Booking, Icon, addDays, dayShort, isoDate, time } from "@torim/shared";
import { api, useMe } from "../api";
import { BookingModal, NewBookingModal, useToast } from "../components";

const FROM = 7;
const TO = 22;
const ROW = 52; // px per hour

function sundayOf(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return addDays(iso, -d.getUTCDay());
}

const minutes = (iso: string) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);

/** Each staff member gets a fixed lane in the day column, so a barber's day reads top to bottom. */
function staffLanes(events: Booking[], staff: number[]) {
  const out = new Map<number, { lane: number; of: number }>();
  const P = Math.max(1, staff.length);
  staff.forEach((pid, pi) => {
    const own = lanes(events.filter((e) => e.provider.id === pid));
    for (const [id, l] of own) out.set(id, { lane: pi * l.of + l.lane, of: P * l.of });
  });
  return out;
}

function lanes(events: Booking[]) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const out = new Map<number, { lane: number; of: number }>();
  let cluster: Booking[] = [];
  let clusterEnd = "";
  const flush = () => {
    const laneEnds: string[] = [];
    const assigned: [Booking, number][] = [];
    for (const e of cluster) {
      let l = laneEnds.findIndex((end) => end <= e.start);
      if (l === -1) l = laneEnds.push(e.end) - 1;
      else laneEnds[l] = e.end;
      assigned.push([e, l]);
    }
    for (const [e, l] of assigned) out.set(e.id, { lane: l, of: laneEnds.length });
    cluster = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = cluster.length === 1 || e.end > clusterEnd ? e.end : clusterEnd;
  }
  if (cluster.length) flush();
  return out;
}

export default function Calendar() {
  const { data } = useMe();
  const [weekStart, setWeekStart] = useState(sundayOf(isoDate()));
  const [rows, setRows] = useState<Booking[]>([]);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [toast, show] = useToast();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  function load() {
    api.get<Booking[]>("/api/pro/bookings", { start: days[0], end: days[6] }).then(setRows);
  }
  useEffect(load, [weekStart]);

  const staffShown = data.providers.filter((p) => !hidden.has(p.id)).map((p) => p.id);
  const visible = rows.filter((b) => !hidden.has(b.provider.id) && (showCancelled || (b.status !== "cancelled" && b.status !== "no_show")));
  const byDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of visible) m.set(b.start.slice(0, 10), [...(m.get(b.start.slice(0, 10)) ?? []), b]);
    return m;
  }, [visible]);

  const today = isoDate();
  const nowMin = minutes(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T"));

  return (
    <div className="stack loose">
      <header className="hero">
        <h1>
          Week of {new Date(weekStart + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}
          <span className="hero-line">
            <span className="pill">{visible.filter((b) => b.status !== "cancelled" && b.status !== "no_show").length} bookings</span> across {staffShown.length} {staffShown.length === 1 ? "person" : "people"}
          </span>
        </h1>
        <div className="hero-ctrls">
          <div className="seg" role="group" aria-label="View">
            <Link to="/">Day</Link>
            <span className="on" aria-current="page">
              Week
            </span>
          </div>
          <div className="date-chip">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              <Icon name="arrow" />
            </button>
            <button className="date-label" onClick={() => setWeekStart(sundayOf(isoDate()))}>
              This week
            </button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              <Icon name="arrow" className="flip" />
            </button>
          </div>
          <button className="btn cta" onClick={() => setCreating(today)}>
            <Icon name="plus" /> New booking
          </button>
        </div>
      </header>
      <div className="row wrap">
        {data.providers
          .filter((p) => data.me.role === "owner" || p.id === data.me.id)
          .map((p) => (
            <button
              key={p.id}
              className="chip"
              aria-pressed={!hidden.has(p.id)}
              style={!hidden.has(p.id) ? { background: `color-mix(in srgb, ${p.color} 22%, white)`, color: `color-mix(in srgb, ${p.color} 78%, #2a1530)` } : undefined}
              onClick={() => {
                const n = new Set(hidden);
                n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                setHidden(n);
              }}
            >
              {p.name}
            </button>
          ))}
        <label className="small muted row" style={{ marginInlineStart: "auto" }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Show cancellations
        </label>
      </div>
      <div className="week panel">
        <div className="head" />
        {days.map((d) => {
          const f = dayShort(d);
          return (
            <div key={d} className={`head ${d === today ? "today" : ""}`}>
              {f.weekday} <b>{f.day}</b>
              <div className="tiny muted">{byDay.get(d)?.filter((b) => b.status !== "cancelled").length ?? 0} bookings</div>
            </div>
          );
        })}
        <div className="hours">
          {Array.from({ length: TO - FROM }, (_, i) => (
            <div key={i} className="hour-label">
              {(FROM + i) % 12 || 12} {FROM + i < 12 ? "AM" : "PM"}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const lane = staffLanes(evs, staffShown);
          return (
            <div key={d} className="col" onDoubleClick={() => setCreating(d)}>
              {Array.from({ length: TO - FROM }, (_, i) => (
                <div key={i} className="cell" />
              ))}
              {d === today && nowMin > FROM * 60 && nowMin < TO * 60 && <div className="week-now" style={{ top: ((nowMin - FROM * 60) / 60) * ROW }} />}
              {evs.map((b) => {
                const top = ((minutes(b.start) - FROM * 60) / 60) * ROW;
                const h = Math.max(18, ((minutes(b.end) - minutes(b.start)) / 60) * ROW - 2);
                const l = lane.get(b.id) ?? { lane: 0, of: 1 };
                const width = 100 / l.of;
                return (
                  <button
                    key={b.id}
                    className={`ev ${b.status} ${b.source === "ai" ? "ai" : ""}`}
                    title={`${time(b.start)} ${b.customer.name}, ${b.service.name}`}
                    style={{
                      top,
                      height: h,
                      background: `color-mix(in srgb, ${b.provider.color} 22%, white)`,
                      insetInlineStart: `calc(${l.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                    onClick={() => setOpen(b)}
                  >
                    {l.of < 3 && <b>{time(b.start)} </b>}
                    <span className="ev-name">{l.of > 1 ? b.customer.name.split(" ")[0] : b.customer.name}</span>
                    {h > 30 && <div style={{ opacity: 0.8 }}>{b.service.name}</div>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="tiny muted">Double-click a day to add a booking. Dashed outline: waiting for approval. Gradient dot: booked by the assistant.</p>
      {open && (
        <BookingModal
          b={open}
          onClose={() => setOpen(null)}
          onChange={(b) => {
            setRows((r) => r.map((x) => (x.id === b.id ? b : x)));
            setOpen(b);
            show("Updated");
          }}
        />
      )}
      {creating && (
        <NewBookingModal
          date={creating}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            load();
            show("Booked. The client got a confirmation.");
          }}
        />
      )}
      {toast}
    </div>
  );
}
