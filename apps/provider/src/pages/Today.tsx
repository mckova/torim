import { Fragment, useEffect, useState } from "react";
import { Booking, Icon, STATUS_LABEL, addDays, isoDate, money, time } from "@torim/shared";
import { api, useMe } from "../api";
import { BookingActions, BookingModal, NewBookingModal, useToast } from "../components";
import { MarginNotes, ReminderModal } from "../ai";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function greeting(name: string) {
  const h = new Date().getHours();
  const first = name.split(" ")[0];
  if (h < 12) return `בוקר טוב, ${first}`;
  if (h < 17) return `צהריים טובים, ${first}`;
  return `ערב טוב, ${first}`;
}

export default function Today() {
  const { data } = useMe();
  const [day, setDay] = useState(isoDate());
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [pending, setPending] = useState<Booking[]>([]);
  const [providerId, setProviderId] = useState<number | "">("");
  const [open, setOpen] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  const [remind, setRemind] = useState<Booking | null>(null);
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

  async function bookingById(id: number) {
    const found = rows?.find((b) => b.id === id) ?? pending.find((b) => b.id === id);
    if (found) return found;
    const list = await api.get<Booking[]>("/api/pro/bookings", { start: isoDate(), end: addDays(isoDate(), 2) });
    return list.find((b) => b.id === id) ?? null;
  }

  const active = rows?.filter((b) => b.status !== "cancelled") ?? [];
  const expected = active.reduce((s, b) => s + b.price, 0);
  const done = active.filter((b) => b.status === "completed").length;
  const now = new Date().toISOString();
  const isToday = day === isoDate();
  const d = new Date(day + "T12:00:00");
  let nowShown = false;

  return (
    <div>
      <header className="today-head">
        <div className="today-date" aria-hidden>
          {String(d.getDate()).padStart(2, "0")}.{String(d.getMonth() + 1).padStart(2, "0")}
        </div>
        <div className="today-title">
          <h1>{isToday ? greeting(data.me.name) : `יום ${DAY_NAMES[d.getDay()]}`}</h1>
          <p className="today-summary">
            {isToday ? `יום ${DAY_NAMES[d.getDay()]}. ` : ""}
            {active.length ? (
              <>
                <b>{active.length}</b> תורים, <b>{done}</b> הושלמו, <b>{money(expected)}</b> צפוי
                {pending.length > 0 && (
                  <>
                    {" "}· <b>{pending.length}</b> מחכים לאישור
                  </>
                )}
              </>
            ) : (
              "אין תורים ביום הזה"
            )}
          </p>
        </div>
        <div className="today-nav">
          <button className="btn ghost sm icon-only" onClick={() => setDay(addDays(day, -1))} aria-label="היום הקודם">
            <Icon name="arrow" className="flip-rtl" />
          </button>
          {!isToday && (
            <button className="btn ghost sm" onClick={() => setDay(isoDate())}>
              היום
            </button>
          )}
          <button className="btn ghost sm icon-only" onClick={() => setDay(addDays(day, 1))} aria-label="היום הבא">
            <Icon name="arrow" />
          </button>
          <button className="btn sm" onClick={() => setCreating(true)}>
            תור חדש
          </button>
        </div>
      </header>

      <div className="today-grid">
        <div>
          {pending.length > 0 && (
            <section className="approvals" aria-labelledby="appr-h">
              <h2 id="appr-h">מחכים לאישור שלך</h2>
              {pending.slice(0, 5).map((b) => (
                <div key={b.id} className="approval">
                  <div className="stack tight">
                    <b>
                      {b.customer.name}, {b.service.name}
                    </b>
                    <span className="small muted">
                      <span className="num">{time(b.start)}</span> · {new Date(b.start).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "numeric" })} · {b.provider.name}
                    </span>
                  </div>
                  <BookingActions b={b} onChange={changed} />
                </div>
              ))}
            </section>
          )}

          <section className="ledger" aria-labelledby="ledger-h">
            <div className="ledger-tools">
              <h2 id="ledger-h">סדר היום</h2>
              {data.me.role === "owner" && data.providers.length > 1 && (
                <select className="input" style={{ width: "auto" }} aria-label="סינון לפי איש צוות" value={providerId} onChange={(e) => setProviderId(e.target.value ? Number(e.target.value) : "")}>
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
              <div className="stack tight" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 56 }} />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="ledger-empty">
                <span>הדף של היום ריק.</span>
                <button className="btn ghost sm" onClick={() => setCreating(true)}>
                  רישום תור
                </button>
              </div>
            ) : (
              rows.map((b) => {
                const showNow = isToday && !nowShown && b.start > now;
                if (showNow) nowShown = true;
                const r = risk[b.id];
                return (
                  <Fragment key={b.id}>
                    {showNow && (
                      <div className="ledger-now" aria-label={`עכשיו ${time(now)}`}>
                        {time(now)}
                      </div>
                    )}
                    <button
                      type="button"
                      className={`ledger-row ${b.end < now ? "past" : ""} ${b.source === "ai" ? "ai" : ""} ${b.status}`}
                      onClick={() => setOpen(b)}
                    >
                      <span className="t">
                        {time(b.start)}
                        <small>{time(b.end)}</small>
                      </span>
                      <span className="who">
                        <b>{b.customer.name}</b>
                        <span>
                          {b.service.name}
                          {data.providers.length > 1 && (
                            <>
                              {" · "}
                              <span className="staff">
                                <span className="dot" style={{ background: b.provider.color }} />
                                {b.provider.name}
                              </span>
                            </>
                          )}
                          {b.source === "ai" && <span className="by-ai"> · נקבע ע״י העוזר</span>}
                        </span>
                      </span>
                      <span className="side">
                        {b.status !== "confirmed" && <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>}
                        {r && r.level !== "low" && (
                          <span className={`risk ${r.level}`} title={r.reasons.join(", ")}>
                            {Math.round(r.probability * 100)}% אי-הגעה
                          </span>
                        )}
                      </span>
                    </button>
                  </Fragment>
                );
              })
            )}
          </section>
        </div>

        {isToday && (
          <MarginNotes
            onChanged={load}
            onOpenBooking={(id) => bookingById(id).then((b) => b && setOpen(b))}
            onRemind={(id) => bookingById(id).then((b) => b && setRemind(b))}
          />
        )}
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
            show("התזכורת נשלחה בוואטסאפ");
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
            show("התור נרשם ונשלח אישור ללקוח");
          }}
        />
      )}
      {toast}
    </div>
  );
}
