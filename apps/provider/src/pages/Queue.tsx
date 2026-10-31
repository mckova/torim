import { useEffect, useState } from "react";
import { Ticket, translateError } from "@torim/shared";
import { api } from "../api";
import { useToast } from "../components";

const LABEL: Record<Ticket["status"], string> = { waiting: "ממתין", called: "נקרא", serving: "בטיפול", done: "הסתיים", left: "עזב" };

export default function Queue() {
  const [data, setData] = useState<{ tickets: Ticket[]; avg_minutes: number | null } | null>(null);
  const [toast, show] = useToast();

  const load = () => api.get<typeof data>("/api/pro/queue").then(setData);
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  async function act(p: Promise<typeof data>, msg: string) {
    try {
      setData(await p);
      show(msg);
    } catch (e) {
      show(translateError(e));
    }
  }

  if (!data) return <div className="spinner" />;
  const waiting = data.tickets.filter((t) => t.status === "waiting");
  const active = data.tickets.filter((t) => t.status === "called" || t.status === "serving");
  const finished = data.tickets.filter((t) => t.status === "done" || t.status === "left");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>תור חי (Walk-in)</h1>
          <span className="small muted">
            לקוחות שהגיעו בלי תור לוקחים מספר מהטלפון.{" "}
            {data.avg_minutes ? `זמן טיפול ממוצע היום: ${Math.round(data.avg_minutes)} דק׳.` : ""}
          </span>
        </div>
        <button className="btn" disabled={!waiting.length} onClick={() => act(api.post("/api/pro/queue/call-next"), "הלקוח הבא נקרא ונשלחה לו הודעה")}>
          📣 קריאה לבא בתור
        </button>
      </div>

      <h2>בטיפול עכשיו</h2>
      {active.length === 0 ? (
        <div className="card empty small">אף אחד לא בטיפול</div>
      ) : (
        <div className="queue-board">
          {active.map((t) => (
            <div key={t.id} className={`ticket ${t.status}`}>
              <div className="num">{t.number}</div>
              <b>{t.name}</b>
              <span className="small muted">{t.service.name}</span>
              <span className="chip accent">{LABEL[t.status]}</span>
              {t.status === "called" ? (
                <div className="row">
                  <button className="btn sm grow" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "serving" }), "התחלת טיפול")}>
                    התחלה
                  </button>
                  <button className="btn ghost sm" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "left" }), "סומן כעזב")}>
                    לא הגיע
                  </button>
                </div>
              ) : (
                <button className="btn sm" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "done" }), "הטיפול הסתיים")}>
                  סיום
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>ממתינים ({waiting.length})</h2>
      {waiting.length === 0 ? (
        <div className="card empty small">התור ריק</div>
      ) : (
        <div className="queue-board">
          {waiting.map((t) => (
            <div key={t.id} className="ticket">
              <div className="num">{t.number}</div>
              <b>{t.name}</b>
              <span className="small muted">{t.service.name}</span>
              <span className="tiny muted">מקום {t.position} · ~{t.eta_minutes ?? 0} דק׳</span>
            </div>
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <>
          <h2 className="muted">הסתיימו היום</h2>
          <div className="row wrap">
            {finished.map((t) => (
              <span key={t.id} className="chip">
                #{t.number} {t.name} · {LABEL[t.status]}
              </span>
            ))}
          </div>
        </>
      )}
      {toast}
    </div>
  );
}
