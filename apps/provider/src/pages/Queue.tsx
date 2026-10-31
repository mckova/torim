import { useEffect, useState } from "react";
import { Ticket, translateError } from "@torim/shared";
import { api } from "../api";
import { useToast } from "../components";

const LABEL: Record<Ticket["status"], string> = { waiting: "Waiting", called: "Called", serving: "In the chair", done: "Done", left: "Left" };

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
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Walk-ins</h1>
          <span className="small muted">
            Walk-in clients take a number from their phone.{" "}
            {data.avg_minutes ? `Average time in the chair today: ${Math.round(data.avg_minutes)} min.` : ""}
          </span>
        </div>
        <button className="btn cta" disabled={!waiting.length} onClick={() => act(api.post("/api/pro/queue/call-next"), "Called the next client and sent them a message")}>
          Call the next client
        </button>
      </div>

      <h2>In the chair now</h2>
      {active.length === 0 ? (
        <div className="card empty small">Nobody is in the chair</div>
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
                  <button className="btn sm grow" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "serving" }), "Started")}>
                    Start
                  </button>
                  <button className="btn ghost sm" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "left" }), "Marked as left")}>
                    Didn't come
                  </button>
                </div>
              ) : (
                <button className="btn sm" onClick={() => act(api.post(`/api/pro/queue/${t.id}/status`, { status: "done" }), "Done")}>
                  Finish
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <h2>Waiting ({waiting.length})</h2>
      {waiting.length === 0 ? (
        <div className="card empty small">Nobody is waiting</div>
      ) : (
        <div className="queue-board">
          {waiting.map((t) => (
            <div key={t.id} className="ticket">
              <div className="num">{t.number}</div>
              <b>{t.name}</b>
              <span className="small muted">{t.service.name}</span>
              <span className="tiny muted">{t.position === 1 ? "Next up" : `Number ${t.position} in line, about ${t.eta_minutes ?? 0} min`}</span>
            </div>
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <>
          <h2 className="muted">Finished today</h2>
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
