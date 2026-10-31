import { useEffect, useState } from "react";
import { Booking, dayLong, time, translateError } from "@torim/shared";
import { api } from "./api";
import { ErrorText, Modal } from "./components";

export interface BriefItem {
  text: string;
  kind: "risk" | "approval" | "waitlist" | "gap" | "queue" | "tip";
  action: "remind" | "confirm" | "offer_slot" | "open_booking" | "none";
  booking_id: number | null;
}
interface Brief {
  source: "ai" | "rules";
  headline: string;
  items: BriefItem[];
}

const ACTION_LABEL: Record<string, string> = {
  remind: "לנסח תזכורת אישית",
  confirm: "לאשר",
  offer_slot: "להציע לממתינים",
  open_booking: "לפתוח את התור",
};

/** The assistant's notes in the margin of today's page: what matters, each with one action. */
export function MarginNotes({ onOpenBooking, onRemind, onChanged }: { onOpenBooking: (id: number) => void; onRemind: (id: number) => void; onChanged: () => void }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  function load(refresh = false) {
    setBusy(true);
    setError(null);
    api
      .get<Brief>("/api/pro/briefing", refresh ? { refresh: 1 } : undefined)
      .then(setBrief)
      .catch(setError)
      .finally(() => setBusy(false));
  }
  useEffect(() => load(), []);

  async function act(it: BriefItem) {
    setNote("");
    try {
      if (it.action === "remind" && it.booking_id) onRemind(it.booking_id);
      else if (it.action === "open_booking" && it.booking_id) onOpenBooking(it.booking_id);
      else if (it.action === "confirm" && it.booking_id) {
        await api.post(`/api/pro/bookings/${it.booking_id}/status`, { status: "confirmed" });
        setBrief((b) => b && { ...b, items: b.items.filter((x) => x !== it) });
        onChanged();
        setNote("אושר. הלקוח קיבל הודעה.");
      } else if (it.action === "offer_slot") {
        const r = await api.post<{ sent: number }>("/api/pro/waitlist/offer-today");
        setBrief((b) => b && { ...b, items: b.items.filter((x) => x !== it) });
        setNote(r.sent ? `נשלחה הודעה ל-${r.sent} ממתינים.` : "אין כרגע ממתינים שמתאימים לזמן הפנוי.");
      }
    } catch (e) {
      setNote(translateError(e));
    }
  }

  return (
    <aside className="margin" aria-labelledby="brief-h" aria-busy={busy}>
      <div className="margin-head">
        <h2 id="brief-h" className="small" style={{ color: "var(--cobalt)", fontWeight: 600 }}>
          הערות העוזר להיום
        </h2>
        <button className="btn link ai small" onClick={() => load(true)} disabled={busy}>
          {busy ? "קורא את היומן…" : "לקרוא שוב"}
        </button>
      </div>
      {!brief && !error && (
        <div className="stack tight" aria-hidden>
          <div className="skeleton" style={{ height: 14, width: "80%" }} />
          <div className="skeleton" style={{ height: 14, width: "92%" }} />
          <div className="skeleton" style={{ height: 14, width: "70%" }} />
        </div>
      )}
      {error ? <span className="small muted">{translateError(error)}</span> : null}
      {brief && (
        <>
          <p className="note" style={{ fontWeight: 500 }}>
            {brief.headline}
          </p>
          {brief.items.length === 0 && <p className="note">אין כרגע משהו שדורש טיפול.</p>}
          {brief.items.map((it, i) => (
            <div key={i} className="note">
              <span>{it.text}</span>
              {it.action !== "none" && (it.booking_id || it.action === "offer_slot") && (
                <button className="btn link ai small note-act" onClick={() => act(it)}>
                  {ACTION_LABEL[it.action]}
                </button>
              )}
            </div>
          ))}
          {note && (
            <span className="small" role="status" style={{ color: "var(--ink-2)" }}>
              {note}
            </span>
          )}
          {brief.source === "rules" && <span className="tiny muted">נכתב לפי כללים. עם מפתח Claude ההערות נכתבות מתוך הנתונים בשפה חופשית.</span>}
        </>
      )}
    </aside>
  );
}

/** Claude drafts a warm, personal WhatsApp reminder; the owner edits and sends. */
export function ReminderModal({ booking, onClose, onSent }: { booking: Booking; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"ai" | "template" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  function draft() {
    setSource(null);
    setError(null);
    api
      .post<{ source: "ai" | "template"; message: string }>(`/api/pro/bookings/${booking.id}/reminder/draft`)
      .then((r) => {
        setText(r.message);
        setSource(r.source);
      })
      .catch(setError);
  }
  useEffect(draft, [booking.id]);

  async function send() {
    setBusy(true);
    try {
      await api.post(`/api/pro/bookings/${booking.id}/reminder/send`, { message: text });
      onSent();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`תזכורת אישית ל${booking.customer.name}`} onClose={onClose}>
      <p className="small muted">
        {booking.service.name} · {dayLong(booking.start)} {time(booking.start)}
      </p>
      {source === null && !error ? (
        <div className="ai-thinking" role="status">
          <div className="spinner" />
          <span>העוזר כותב הודעה…</span>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="rem" className="row">
            ההודעה {source === "ai" && <span className="ai-sign">נוסח ע״י העוזר</span>}
          </label>
          <textarea id="rem" className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        </div>
      )}
      <ErrorText error={error} />
      <div className="row between">
        <button className="btn link ai" onClick={draft} disabled={source === null && !error}>
          נוסח אחר
        </button>
        <button className="btn" onClick={send} disabled={busy || text.trim().length < 5}>
          שליחה בוואטסאפ
        </button>
      </div>
    </Modal>
  );
}
