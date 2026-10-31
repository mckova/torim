import { useEffect, useMemo, useState } from "react";
import { Booking, addDays, dayShort, isoDate, time } from "@torim/shared";
import { api, useMe } from "../api";
import { BookingModal, NewBookingModal, useToast } from "../components";

const FROM = 7;
const TO = 22;
const ROW = 48; // px per hour

function sundayOf(iso: string) {
  const d = new Date(iso + "T12:00:00Z");
  return addDays(iso, -d.getUTCDay());
}

const minutes = (iso: string) => +iso.slice(11, 13) * 60 + +iso.slice(14, 16);

/** Assign side-by-side lanes to overlapping events in one day column. */
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

  const visible = rows.filter((b) => !hidden.has(b.provider.id) && (showCancelled || (b.status !== "cancelled" && b.status !== "no_show")));
  const byDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of visible) m.set(b.start.slice(0, 10), [...(m.get(b.start.slice(0, 10)) ?? []), b]);
    return m;
  }, [visible]);

  const today = isoDate();
  const nowMin = minutes(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" }).replace(" ", "T"));

  return (
    <div className="stack">
      <div className="page-head">
        <h1>יומן</h1>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            › שבוע קודם
          </button>
          <button className="btn ghost sm" onClick={() => setWeekStart(sundayOf(isoDate()))}>
            השבוע
          </button>
          <button className="btn ghost sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            שבוע הבא ‹
          </button>
          <button className="btn sm" onClick={() => setCreating(today)}>
            + תור חדש
          </button>
        </div>
      </div>
      <div className="row wrap">
        {data.providers
          .filter((p) => data.me.role === "owner" || p.id === data.me.id)
          .map((p) => (
            <button
              key={p.id}
              className="chip"
              style={{ border: 0, cursor: "pointer", opacity: hidden.has(p.id) ? 0.4 : 1 }}
              onClick={() => {
                const n = new Set(hidden);
                n.has(p.id) ? n.delete(p.id) : n.add(p.id);
                setHidden(n);
              }}
            >
              <span className="dot" style={{ background: p.color }} /> {p.name}
            </button>
          ))}
        <label className="small muted row" style={{ marginInlineStart: "auto" }}>
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> הצגת ביטולים
        </label>
      </div>
      <div className="week">
        <div className="head" />
        {days.map((d) => {
          const f = dayShort(d);
          return (
            <div key={d} className={`head ${d === today ? "today" : ""}`}>
              {f.weekday} {f.day}/{d.slice(5, 7)}
              <div className="tiny muted">{byDay.get(d)?.filter((b) => b.status !== "cancelled").length ?? 0} תורים</div>
            </div>
          );
        })}
        <div className="hours">
          {Array.from({ length: TO - FROM }, (_, i) => (
            <div key={i} className="hour-label">
              {String(FROM + i).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {days.map((d) => {
          const evs = byDay.get(d) ?? [];
          const lane = lanes(evs);
          return (
            <div key={d} className="col" onDoubleClick={() => setCreating(d)}>
              {Array.from({ length: TO - FROM }, (_, i) => (
                <div key={i} className="cell" />
              ))}
              {d === today && nowMin > FROM * 60 && nowMin < TO * 60 && (
                <div style={{ position: "absolute", insetInline: 0, top: ((nowMin - FROM * 60) / 60) * ROW, height: 2, background: "var(--danger)", zIndex: 1 }} />
              )}
              {evs.map((b) => {
                const top = ((minutes(b.start) - FROM * 60) / 60) * ROW;
                const h = Math.max(18, ((minutes(b.end) - minutes(b.start)) / 60) * ROW - 2);
                const l = lane.get(b.id)!;
                const width = 100 / l.of;
                return (
                  <div
                    key={b.id}
                    className={`ev ${b.status}`}
                    title={`${b.customer.name} · ${b.service.name}`}
                    style={{
                      top,
                      height: h,
                      background: b.provider.color,
                      insetInlineStart: `calc(${l.lane * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                    onClick={() => setOpen(b)}
                  >
                    <b>{time(b.start)}</b> {b.customer.name}
                    {h > 30 && <div style={{ opacity: 0.85 }}>{b.service.name}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="tiny muted">לחיצה כפולה על יום פותחת תור חדש. פסים אלכסוניים = ממתין לאישור.</p>
      {open && (
        <BookingModal
          b={open}
          onClose={() => setOpen(null)}
          onChange={(b) => {
            setRows((r) => r.map((x) => (x.id === b.id ? b : x)));
            setOpen(b);
            show("עודכן");
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
            show("התור נקבע");
          }}
        />
      )}
      {toast}
    </div>
  );
}
