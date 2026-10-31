import { useEffect, useState } from "react";
import { dayLong, phoneDisplay, time } from "@torim/shared";
import { api } from "../api";

interface N {
  id: number;
  kind: string;
  to: string;
  body: string;
  status: string;
  send_at: string;
  sent_at: string | null;
}

const KIND: Record<string, string> = {
  booked: "אישור הזמנה",
  pending: "בקשה התקבלה",
  confirmed: "אושר",
  cancelled: "ביטול",
  rescheduled: "שינוי מועד",
  reminder_24h: "תזכורת יום לפני",
  reminder_2h: "תזכורת שעתיים לפני",
  provider_new: "התראה לצוות",
  waitlist_offer: "התפנה מקום",
  queue_called: "תור חי: נקראת",
  otp: "קוד כניסה",
  ai_reply: "✨ תשובת הנציגה החכמה",
};

export default function Messages() {
  const [rows, setRows] = useState<N[] | null>(null);
  useEffect(() => {
    api.get<N[]>("/api/pro/notifications", { limit: 100 }).then(setRows);
  }, []);
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>הודעות ואוטומציות</h1>
          <span className="small muted">כל הודעה שהמערכת שולחת ללקוחות (וואטסאפ / SMS / Webhook). תזכורות מתוזמנות מופיעות כ״בתור״.</span>
        </div>
      </div>
      {!rows ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <div className="card empty">עוד לא נשלחו הודעות. קבעו תור כדי לראות את האוטומציה בפעולה.</div>
      ) : (
        <div className="stack tight">
          {rows.map((n) => (
            <div key={n.id} className="card flat stack tight">
              <div className="row between wrap">
                <div className="row">
                  <span className="chip accent">{KIND[n.kind] ?? n.kind}</span>
                  <span className="small muted" dir="ltr">
                    {n.to.includes("@") ? n.to : phoneDisplay(n.to)}
                  </span>
                </div>
                <span className={`chip ${n.status === "sent" ? "confirmed" : n.status === "queued" ? "pending" : "cancelled"}`}>
                  {n.status === "sent" ? `נשלח ${time(n.sent_at!)}` : n.status === "queued" ? `מתוזמן ל-${dayLong(n.send_at)} ${time(n.send_at)}` : n.status === "cancelled" ? "בוטל" : "נכשל"}
                </span>
              </div>
              <p className="small" style={{ background: "#ecfdf5", padding: "0.6rem 0.8rem", borderRadius: 10 }}>
                {n.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
