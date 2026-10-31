import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Booking, STATUS_LABEL, addDays, dayLong, isoDate, money, phoneDisplay, time } from "@torim/shared";
import { api, useMe } from "../api";
import { BookingActions, BookingModal, NewBookingModal, useToast } from "../components";

export default function Today() {
  const { data } = useMe();
  const [day, setDay] = useState(isoDate());
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [pending, setPending] = useState<Booking[]>([]);
  const [providerId, setProviderId] = useState<number | "">("");
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, show] = useToast();
  const [risk, setRisk] = useState<Record<number, { level: string; probability: number; reasons: string[] }>>({});

  function load() {
    api.get<Booking[]>("/api/pro/bookings", { start: day, end: day, provider_id: providerId }).then(setRows);
    api.get<Booking[]>("/api/pro/bookings", { start: isoDate(), end: addDays(isoDate(), 60), status: "pending" }).then(setPending);
    api
      .get<{ bookings: { booking_id: number; level: string; probability: number; reasons: string[] }[] }>("/api/pro/risk", { start: day, days: 1 })
      .then((r) => setRisk(Object.fromEntries(r.bookings.map((x) => [x.booking_id, x]))));
  }
  useEffect(load, [day, providerId]);

  function changed(b: Booking) {
    setRows((r) => r?.map((x) => (x.id === b.id ? b : x)) ?? null);
    setPending((p) => p.filter((x) => x.id !== b.id || b.status === "pending"));
    setOpen((o) => (o && o.id === b.id ? b : o));
    show(`עודכן: ${STATUS_LABEL[b.status]}`);
  }

  const active = rows?.filter((b) => b.status !== "cancelled") ?? [];
  const expected = active.reduce((s, b) => s + b.price, 0);
  const done = active.filter((b) => b.status === "completed").length;
  const now = new Date().toISOString();
  const isToday = day === isoDate();
  let nowShown = false;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{isToday ? `בוקר טוב, ${data.me.name.split(" ")[0]}` : dayLong(day + "T12:00:00")}</h1>
          <span className="muted small">{isToday ? dayLong(day + "T12:00:00") : ""}</span>
        </div>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={() => setDay(addDays(day, -1))}>
            › אתמול
          </button>
          {!isToday && (
            <button className="btn ghost sm" onClick={() => setDay(isoDate())}>
              היום
            </button>
          )}
          <button className="btn ghost sm" onClick={() => setDay(addDays(day, 1))}>
            מחר ‹
          </button>
          <button className="btn sm" onClick={() => setCreating(true)}>
            + תור חדש
          </button>
        </div>
      </div>

      <div className="grid kpi">
        <div className="card kpi-card">
          <div className="value">{active.length}</div>
          <div className="label">תורים {isToday ? "היום" : "ביום הזה"}</div>
        </div>
        <div className="card kpi-card">
          <div className="value">
            {done}/{active.length}
          </div>
          <div className="label">הושלמו</div>
        </div>
        <div className="card kpi-card">
          <div className="value">{money(expected)}</div>
          <div className="label">הכנסה צפויה</div>
        </div>
        <Link to="/calendar" className="card kpi-card" style={{ color: "inherit" }}>
          <div className="value" style={{ color: pending.length ? "var(--warn)" : undefined }}>
            {pending.length}
          </div>
          <div className="label">בקשות ממתינות לאישור</div>
        </Link>
      </div>

      {pending.length > 0 && (
        <div className="card stack" style={{ borderColor: "#fde68a" }}>
          <h2>⏳ ממתינים לאישור שלך</h2>
          {pending.slice(0, 5).map((b) => (
            <div key={b.id} className="row between wrap" style={{ borderBottom: "1px solid #f3f4f6", paddingBottom: "0.5rem" }}>
              <div className="stack tight">
                <b>
                  {b.customer.name} · {b.service.name}
                </b>
                <span className="small muted">
                  {dayLong(b.start)} {time(b.start)} · {b.provider.name}
                </span>
              </div>
              <BookingActions b={b} onChange={changed} />
            </div>
          ))}
        </div>
      )}

      <div className="row between">
        <h2>סדר היום</h2>
        {data.me.role === "owner" && (
          <select className="input" style={{ width: "auto" }} value={providerId} onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">כל הצוות</option>
            {data.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!rows ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <div className="card empty">אין תורים ביום הזה. זמן טוב לקפה ☕</div>
      ) : (
        <div className="stack tight">
          {rows.map((b) => {
            const showNow = isToday && !nowShown && b.start > now;
            if (showNow) nowShown = true;
            return (
              <Fragment key={b.id}>
                {showNow && <div className="now-line">עכשיו {time(now)}</div>}
                <div className={`agenda-item ${b.end < now ? "past" : ""}`} onClick={() => setOpen(b)} style={{ cursor: "pointer" }}>
                  <div className="stack tight">
                    <span className="t">{time(b.start)}</span>
                    <span className="tiny muted">{time(b.end)}</span>
                  </div>
                  <div className="stripe" style={{ background: b.provider.color }} />
                  <div className="stack tight">
                    <b>{b.customer.name}</b>
                    <span className="small muted">
                      {b.service.name} · {b.provider.name} · <span dir="ltr">{phoneDisplay(b.customer.phone)}</span>
                    </span>
                  </div>
                  <div className="stack tight" style={{ alignItems: "flex-end" }}>
                    <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                    {risk[b.id] && risk[b.id].level !== "low" && (
                      <span className={`risk ${risk[b.id].level}`} title={risk[b.id].reasons.join(", ")}>
                        ✨ סיכון אי-הגעה {Math.round(risk[b.id].probability * 100)}%
                      </span>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
      {open && <BookingModal b={open} onClose={() => setOpen(null)} onChange={changed} />}
      {creating && (
        <NewBookingModal
          date={day}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            load();
            show("התור נקבע ונשלח אישור ללקוח");
          }}
        />
      )}
      {toast}
    </div>
  );
}
