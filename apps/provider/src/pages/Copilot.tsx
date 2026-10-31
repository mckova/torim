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
  list_bookings: "calendar",
  business_stats: "numbers",
  no_show_risks: "no-show forecast",
  find_customer: "clients",
  free_slots: "availability",
  waitlist: "waitlist",
  create_booking: "booking",
  set_booking_status: "booking update",
  draft_personal_reminder: "reminder draft",
  send_customer_message: "message",
  offer_free_time_to_waitlist: "waitlist offer",
  block_time: "time block",
};

export default function Copilot() {
  const { data } = useMe();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const conv = useRef<string | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean }>("/api/ai/status").then((s) => setEnabled(s.enabled));
  }, []);

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>Assistant</h1>
          <span className="small muted">Ask in your own words. The assistant reads the calendar and the numbers live, and can book, approve and block time for you.</span>
        </div>
        <span className="ai-sign">Claude Opus 5.5</span>
      </div>
      {enabled === false ? (
        <section className="copilot-off panel">
          <p>
            The assistant isn't connected on this server. Set <code>ANTHROPIC_API_KEY</code> and restart to turn it on. Until then, the assistant card on Today and the no-show forecast run on rules.
          </p>
          <h2 className="small muted">Things you can ask</h2>
          <ul className="plain-list">
            <li>Who might not show up this week? Draft each of them a personal reminder.</li>
            <li>Block tomorrow from 14:00 to 16:00, and offer what opens up to the waitlist.</li>
            <li>How is this month doing against last month, and which service dropped?</li>
            <li>Approve all of tomorrow's pending requests.</li>
          </ul>
        </section>
      ) : enabled === null ? (
        <div className="spinner" />
      ) : (
        <ChatPanel
          height="70dvh"
          intro={`Hi ${data.me.name.split(" ")[0]}, what do you need today?`}
          suggestions={[
            "Who might not show up this week, and what should I do?",
            "How is this month doing against last month?",
            "When are my quiet hours, and how do I fill them?",
            "Block tomorrow from 14:00 to 16:00",
            "Approve all of tomorrow's pending requests",
          ]}
          placeholder="For example: who were my most loyal clients this month?"
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
                      <span className={`chip ${a.booking.status}`}>{STATUS_LABEL[a.booking.status]}</span> {a.booking.customer.name}, {a.booking.service.name},{" "}
                      {dayLong(a.booking.start)} {time(a.booking.start)}
                    </div>
                  ))}
                  {used.length > 0 && <div className="tiny muted" style={{ marginTop: 6 }}>Checked: {used.join(", ")}</div>}
                </>
              ),
            };
          }}
        />
      )}
    </div>
  );
}
