import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Ticket } from "@torim/shared";
import { api } from "../api";
import { ErrorBox, Spinner } from "../components";

const LABEL: Record<Ticket["status"], string> = {
  waiting: "ממתינים",
  called: "הגיע תורך! גשו לעמדה",
  serving: "בטיפול",
  done: "הסתיים. תודה!",
  left: "יצאת מהתור",
};

export default function TicketPage() {
  const { uid = "" } = useParams();
  const [t, setT] = useState<Ticket | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const load = () => api.get<Ticket>(`/api/queue/${uid}`).then(setT).catch(setError);
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [uid]);

  useEffect(() => {
    if (t?.status === "called" && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
  }, [t?.status]);

  if (!t) return error ? <ErrorBox error={error} /> : <Spinner />;
  return (
    <div className="stack center">
      <span className="muted">המספר שלך</span>
      <div className="ticket-number">{t.number}</div>
      <span className={`chip ${t.status === "called" ? "confirmed" : "accent"}`} style={{ alignSelf: "center", fontSize: "1rem" }}>
        {LABEL[t.status]}
      </span>
      {t.status === "waiting" && (
        <div className="grid two">
          <div className="card stack tight">
            <span className="small muted">לפניך</span>
            <b style={{ fontSize: "1.8rem" }}>{(t.position ?? 1) - 1}</b>
          </div>
          <div className="card stack tight">
            <span className="small muted">זמן משוער</span>
            <b style={{ fontSize: "1.8rem" }}>{t.eta_minutes ? `~${t.eta_minutes} דק׳` : "עכשיו"}</b>
          </div>
        </div>
      )}
      <p className="small muted">{t.service.name} · הדף מתעדכן אוטומטית</p>
      {t.status === "waiting" && (
        <button className="btn danger" onClick={() => api.post<Ticket>(`/api/queue/${uid}/leave`).then(setT)}>
          יציאה מהתור
        </button>
      )}
    </div>
  );
}
