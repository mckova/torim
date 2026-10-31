import { useEffect, useRef, useState } from "react";
import { Booking, ChatPanel, STATUS_LABEL, dayLong, time } from "@torim/shared";
import { api, useMe } from "../api";

interface Reply {
  conversation_id: string;
  reply: string;
  actions: { type: "booking"; booking: Booking }[];
  tools_used: string[];
}

const TOOL_LABEL: Record<string, string> = {
  list_bookings: "יומן",
  business_stats: "נתונים",
  no_show_risks: "חיזוי אי-הגעה",
  find_customer: "לקוחות",
  free_slots: "זמינות",
  waitlist: "רשימת המתנה",
  create_booking: "קביעת תור",
  set_booking_status: "עדכון תור",
  block_time: "חסימת זמן",
};

export default function Copilot() {
  const { data } = useMe();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const conv = useRef<string | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean }>("/api/ai/status").then((s) => setEnabled(s.enabled));
  }, []);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>עוזר AI</h1>
          <span className="small muted">שואלים בשפה חופשית. העוזר קורא את היומן והנתונים בזמן אמת, ויכול לקבוע, לאשר ולחסום זמן בשבילך.</span>
        </div>
        <span className="ai-badge">✨ Claude Opus 5.5 · כלים</span>
      </div>
      {enabled === false ? (
        <div className="alert warn">העוזר לא מחובר בשרת הזה (חסר ANTHROPIC_API_KEY). חיזוי אי-ההגעה במסך "היום" עובד גם בלי מפתח.</div>
      ) : enabled === null ? (
        <div className="spinner" />
      ) : (
        <ChatPanel
          height="70vh"
          intro={`שלום ${data.me.name.split(" ")[0]}, מה צריך היום?`}
          suggestions={[
            "מי בסיכון לא להגיע השבוע, ומה כדאי לעשות?",
            "איך החודש הזה לעומת החודש שעבר?",
            "מתי השעות החלשות שלי, ואיך למלא אותן?",
            "תחסום לי מחר בין 14:00 ל-16:00",
            "תאשר את כל הבקשות הממתינות של מחר",
          ]}
          placeholder="למשל: מי הלקוחות הכי נאמנים שלי החודש?"
          send={async (text) => {
            const r = await api.post<Reply>("/api/pro/copilot", { message: text, conversation_id: conv.current });
            conv.current = r.conversation_id;
            const used = [...new Set(r.tools_used)].map((t) => TOOL_LABEL[t] ?? t);
            return {
              reply: r.reply,
              extra: (
                <>
                  {r.actions.map((a) => (
                    <div key={a.booking.id + a.booking.status} className="card flat small" style={{ marginTop: 6, padding: "0.5rem 0.7rem" }}>
                      <span className={`chip ${a.booking.status}`}>{STATUS_LABEL[a.booking.status]}</span> {a.booking.customer.name} · {a.booking.service.name} ·{" "}
                      {dayLong(a.booking.start)} {time(a.booking.start)}
                    </div>
                  ))}
                  {used.length > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>נבדק: {used.join(" · ")}</div>}
                </>
              ),
            };
          }}
        />
      )}
    </div>
  );
}
