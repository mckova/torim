import { useEffect, useState } from "react";
import { ISRAELI_WEEK, WEEKDAYS_FROM_MONDAY, dayLong, time } from "@torim/shared";
import { api, useMe } from "../api";
import { ErrorText, useToast } from "../components";

interface Day {
  weekday: number;
  start: string;
  end: string;
  breaks: [string, string][];
}
interface Sched {
  provider_id: number;
  days: Day[];
  overrides: { id: number; date: string; start: string | null; end: string | null }[];
  time_off: { id: number; start: string; end: string; reason: string }[];
}

export default function Schedule() {
  const { data } = useMe();
  const isOwner = data.me.role === "owner";
  const [providerId, setProviderId] = useState(data.me.id);
  const [sched, setSched] = useState<Sched | null>(null);
  const [plan, setPlan] = useState<Record<number, Day | null>>({});
  const [error, setError] = useState<unknown>(null);
  const [toast, show] = useToast();
  const [ov, setOv] = useState({ date: "", start: "", end: "", off: true });
  const [to, setTo] = useState({ start: "", end: "", reason: "" });

  function apply(s: Sched) {
    setSched(s);
    const p: Record<number, Day | null> = {};
    for (const wd of ISRAELI_WEEK) p[wd] = s.days.find((d) => d.weekday === wd) ?? null;
    setPlan(p);
  }
  useEffect(() => {
    api.get<Sched>("/api/pro/schedule", { provider_id: providerId }).then(apply).catch(setError);
  }, [providerId]);

  async function save() {
    setError(null);
    try {
      const days = Object.values(plan).filter((d): d is Day => !!d);
      apply(await api.put<Sched>("/api/pro/schedule", { days }, { provider_id: providerId }));
      show("שעות העבודה נשמרו. הזמינות מתעדכנת מיד.");
    } catch (e) {
      setError(e);
    }
  }

  const set = (wd: number, d: Day | null) => setPlan({ ...plan, [wd]: d });

  async function addOverride(e: React.FormEvent) {
    e.preventDefault();
    try {
      apply(await api.post<Sched>("/api/pro/overrides", { date: ov.date, start: ov.off ? null : ov.start, end: ov.off ? null : ov.end }, { provider_id: providerId }));
      show("החריגה נשמרה");
    } catch (err) {
      setError(err);
    }
  }

  async function addTimeOff(e: React.FormEvent) {
    e.preventDefault();
    const tz = (s: string) => new Date(s).toISOString();
    try {
      apply(await api.post<Sched>("/api/pro/time-off", { start: tz(to.start), end: tz(to.end), reason: to.reason }, { provider_id: providerId }));
      show("החופשה נוספה");
    } catch (err) {
      setError(err);
    }
  }

  if (!sched) return <div className="spinner" />;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>שעות עבודה וזמינות</h1>
        {isOwner && (
          <select className="input" style={{ width: "auto" }} value={providerId} onChange={(e) => setProviderId(Number(e.target.value))}>
            {data.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorText error={error} />
      <div className="card">
        <h2>שבוע קבוע</h2>
        {ISRAELI_WEEK.map((wd) => {
          const d = plan[wd];
          return (
            <div key={wd} className="sched-row">
              <b>{WEEKDAYS_FROM_MONDAY[wd]}</b>
              <button
                className={`toggle ${d ? "on" : ""}`}
                aria-label="יום עבודה"
                onClick={() => set(wd, d ? null : { weekday: wd, start: "09:00", end: "18:00", breaks: [] })}
              />
              {d ? (
                <div className="times">
                  <input type="time" className="input" value={d.start} onChange={(e) => set(wd, { ...d, start: e.target.value })} />
                  <span>עד</span>
                  <input type="time" className="input" value={d.end} onChange={(e) => set(wd, { ...d, end: e.target.value })} />
                  {d.breaks.map(([s, e], i) => (
                    <span key={i} className="chip">
                      הפסקה {s}–{e}
                      <button style={{ border: 0, background: "none", cursor: "pointer" }} onClick={() => set(wd, { ...d, breaks: d.breaks.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </span>
                  ))}
                  <button className="btn ghost sm" onClick={() => set(wd, { ...d, breaks: [...d.breaks, ["13:00", "13:30"]] })}>
                    + הפסקה
                  </button>
                </div>
              ) : (
                <span className="muted small">סגור</span>
              )}
            </div>
          );
        })}
        <div className="row" style={{ marginTop: "1rem" }}>
          <button className="btn" onClick={save}>
            שמירה
          </button>
        </div>
      </div>

      <div className="grid two">
        <form className="card stack" onSubmit={addOverride}>
          <h2>חריגה ליום מסוים</h2>
          <p className="small muted">יום חופש, או שעות שונות מהרגיל (למשל ערב חג).</p>
          <input type="date" className="input" required value={ov.date} onChange={(e) => setOv({ ...ov, date: e.target.value })} />
          <label className="row small">
            <input type="checkbox" checked={ov.off} onChange={(e) => setOv({ ...ov, off: e.target.checked })} /> לא עובד/ת ביום הזה
          </label>
          {!ov.off && (
            <div className="row">
              <input type="time" className="input" required value={ov.start} onChange={(e) => setOv({ ...ov, start: e.target.value })} />
              <input type="time" className="input" required value={ov.end} onChange={(e) => setOv({ ...ov, end: e.target.value })} />
            </div>
          )}
          <button className="btn soft">הוספה</button>
          {sched.overrides.map((o) => (
            <div key={o.id} className="row between small">
              <span>
                {dayLong(o.date + "T12:00:00")}: {o.start ? `${o.start}–${o.end}` : "חופש"}
              </span>
              <button type="button" className="btn ghost sm" onClick={() => api.del<Sched>(`/api/pro/overrides/${o.id}`).then(apply)}>
                הסרה
              </button>
            </div>
          ))}
        </form>
        <form className="card stack" onSubmit={addTimeOff}>
          <h2>חופשה / היעדרות</h2>
          <p className="small muted">חוסם תורים חדשים בטווח. תורים קיימים לא נמחקים.</p>
          <input type="datetime-local" className="input" required value={to.start} onChange={(e) => setTo({ ...to, start: e.target.value })} />
          <input type="datetime-local" className="input" required value={to.end} onChange={(e) => setTo({ ...to, end: e.target.value })} />
          <input className="input" placeholder="סיבה" value={to.reason} onChange={(e) => setTo({ ...to, reason: e.target.value })} />
          <button className="btn soft">הוספה</button>
          {sched.time_off.map((t) => (
            <div key={t.id} className="row between small">
              <span>
                {dayLong(t.start)} {time(t.start)} עד {dayLong(t.end)} {time(t.end)} {t.reason && `· ${t.reason}`}
              </span>
              <button type="button" className="btn ghost sm" onClick={() => api.del<Sched>(`/api/pro/time-off/${t.id}`).then(apply)}>
                הסרה
              </button>
            </div>
          ))}
        </form>
      </div>
      {toast}
    </div>
  );
}
