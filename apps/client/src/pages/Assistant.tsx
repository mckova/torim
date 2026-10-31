import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Booking, ChatPanel, STATUS_LABEL, dayLong, time } from "@torim/shared";
import { api, getSession, rememberBooking } from "../api";

interface Reply {
  conversation_id: string;
  reply: string;
  actions: { type: "booking"; booking: Booking }[];
}

function BookingCard({ b }: { b: Booking }) {
  return (
    <div className="card flat stack tight" style={{ marginTop: "0.5rem", padding: "0.7rem" }}>
      <div className="row between">
        <b className="small">{b.service.name}</b>
        <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
      </div>
      <span className="small muted">
        {dayLong(b.start)} · {time(b.start)} · {b.provider.name}
      </span>
      {b.manage_token && (
        <Link className="small" to={`/manage/${b.uid}?t=${b.manage_token}`}>
          ניהול התור ›
        </Link>
      )}
    </div>
  );
}

export default function Assistant({ slug, businessName }: { slug: string; businessName: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const conv = useRef<string | null>(null);

  useEffect(() => {
    api.get<{ enabled: boolean }>("/api/ai/status").then((s) => setEnabled(s.enabled)).catch(() => setEnabled(false));
  }, []);

  if (enabled === null) return <div className="spinner" />;
  if (!enabled)
    return (
      <div className="alert warn">
        הנציגה החכמה לא מחוברת בשרת הזה (חסר ANTHROPIC_API_KEY). אפשר לקבוע תור רגיל בלשונית "קביעת תור".
      </div>
    );

  const session = getSession();
  return (
    <div className="stack">
      <div className="row between">
        <span className="ai-badge">✨ נציגה חכמה · Claude</span>
        <span className="tiny muted">קובעת, מזיזה ומבטלת תורים בשבילך</span>
      </div>
      <ChatPanel
        height="62vh"
        intro={`היי! אני הנציגה הדיגיטלית של ${businessName}. ספרו לי מה תרצו ומתי נוח לכם, ואני אמצא ואקבע תור.`}
        suggestions={["אפשר תספורת מחר אחרי 17:00?", "מה הכי מוקדם שיש השבוע?", "אני רוצה לבטל את התור שלי"]}
        placeholder="למשל: תור לתספורת ביום שלישי בערב"
        send={async (text) => {
          const r = await api.post<Reply>(`/api/b/${slug}/assistant`, { message: text, conversation_id: conv.current });
          conv.current = r.conversation_id;
          for (const a of r.actions) if (a.booking.manage_token) rememberBooking(a.booking.uid, a.booking.manage_token);
          return {
            reply: r.reply,
            extra: r.actions.length ? r.actions.map((a) => <BookingCard key={a.booking.uid + a.booking.status} b={a.booking} />) : undefined,
          };
        }}
      />
      {!session && <p className="tiny muted center">כדי שהנציגה תראה את התורים הקיימים שלך, התחברו במסך "התורים שלי".</p>}
    </div>
  );
}
