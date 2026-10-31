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
  booked: "Booking confirmation",
  pending: "Request received",
  confirmed: "Approved",
  cancelled: "Cancellation",
  rescheduled: "Moved",
  reminder_24h: "Reminder, a day before",
  reminder_2h: "Reminder, two hours before",
  provider_new: "Team alert",
  waitlist_offer: "A spot opened up",
  queue_called: "Walk-in: you're up",
  otp: "Sign-in code",
  ai_reply: "Assistant reply",
  personal_reminder: "Personal reminder",
};

export default function Messages() {
  const [rows, setRows] = useState<N[] | null>(null);
  useEffect(() => {
    api.get<N[]>("/api/pro/notifications", { limit: 100 }).then(setRows);
  }, []);
  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <span className="small muted">Every message sent to clients, and what is scheduled to go out.</span>
        </div>
      </div>
      {!rows ? (
        <div className="spinner" />
      ) : rows.length === 0 ? (
        <div className="card empty">No messages yet. Make a booking to see the automations at work.</div>
      ) : (
        <div className="stack tight">
          {rows.map((n) => (
            <div key={n.id} className="card stack tight">
              <div className="row between wrap">
                <div className="row">
                  <span className="chip accent">{KIND[n.kind] ?? n.kind}</span>
                  <span className="small muted">
                    {n.to.includes("@") ? n.to : phoneDisplay(n.to)}
                  </span>
                </div>
                <span className={`chip ${n.status === "sent" ? "confirmed" : n.status === "queued" ? "pending" : "cancelled"}`}>
                  {n.status === "sent" ? `Sent ${time(n.sent_at!)}` : n.status === "queued" ? `Scheduled for ${dayLong(n.send_at)} ${time(n.send_at)}` : n.status === "cancelled" ? "Cancelled" : "Failed"}
                </span>
              </div>
              <p className="small" dir="auto" style={{ background: "#fff", padding: "0.65rem 0.85rem", borderRadius: 16, borderEndStartRadius: 6 }}>
                {n.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
