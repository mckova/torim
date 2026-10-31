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
  remind: "Draft a reminder",
  confirm: "Approve",
  offer_slot: "Offer to the waitlist",
  open_booking: "Open booking",
};

/** The assistant's card on Today: what needs you, each with one action. */
export function AssistantCard({ onOpenBooking, onRemind, onChanged }: { onOpenBooking: (id: number) => void; onRemind: (id: number) => void; onChanged: () => void }) {
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
        setNote("Approved. The client got a message.");
      } else if (it.action === "offer_slot") {
        const r = await api.post<{ sent: number }>("/api/pro/waitlist/offer-today");
        setBrief((b) => b && { ...b, items: b.items.filter((x) => x !== it) });
        setNote(r.sent ? `Sent to ${r.sent} people on the waitlist.` : "Nobody on the waitlist fits the free time right now.");
      }
    } catch (e) {
      setNote(translateError(e));
    }
  }

  const actionable = brief?.items.filter((it) => it.action !== "none" && (it.booking_id || it.action === "offer_slot")).length ?? 0;
  const secondary = (it: BriefItem) => (it.action === "remind" || it.action === "confirm") && it.booking_id;

  return (
    <section className="panel sunset assistant" aria-labelledby="brief-h" aria-busy={busy}>
      <div className="assistant-head">
        <h2 id="brief-h">Your assistant</h2>
        {brief && actionable > 0 && <span className="count">{actionable} for you</span>}
      </div>
      {!brief && !error && (
        <div className="assistant-item" aria-hidden>
          <div className="skeleton" style={{ height: 14, width: "80%" }} />
          <div className="skeleton" style={{ height: 14, width: "60%" }} />
        </div>
      )}
      {error ? <p className="assistant-item">{translateError(error)}</p> : null}
      {brief && (
        <>
          <p className="assistant-headline">{brief.headline}</p>
          {brief.items.length === 0 && <p className="assistant-item">Nothing needs you right now.</p>}
          {brief.items.map((it, i) => {
            const can = it.action !== "none" && (it.booking_id || it.action === "offer_slot");
            return (
              <div key={i} className="assistant-item">
                <b>{it.text}</b>
                {can && (
                  <div className="assistant-acts">
                    <button className="btn sm" onClick={() => act(it)}>
                      {ACTION_LABEL[it.action]}
                    </button>
                    {secondary(it) && (
                      <button className="btn soft sm" onClick={() => onOpenBooking(it.booking_id!)}>
                        Open booking
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {note && (
            <span className="assistant-note" role="status">
              {note}
            </span>
          )}
          <div className="assistant-foot">
            <span>{brief.source === "rules" ? "Ranked by rules. With a Claude key the assistant writes these from the data." : "Written from today's data."}</span>
            <button className="btn link" onClick={() => load(true)} disabled={busy}>
              {busy ? "Reading the day…" : "Refresh"}
            </button>
          </div>
        </>
      )}
    </section>
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
    <Modal title={`Reminder for ${booking.customer.name}`} onClose={onClose}>
      <p className="small muted">
        {booking.service.name} · {dayLong(booking.start)} {time(booking.start)}
      </p>
      {source === null && !error ? (
        <div className="ai-thinking" role="status">
          <div className="spinner" />
          <span>The assistant is writing…</span>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="rem" className="row">
            Message {source === "ai" && <span className="ai-sign">Drafted by the assistant</span>}
          </label>
          <textarea id="rem" className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} dir="auto" />
        </div>
      )}
      <ErrorText error={error} />
      <div className="row between">
        <button className="btn link ai" onClick={draft} disabled={source === null && !error}>
          Try another draft
        </button>
        <button className="btn" onClick={send} disabled={busy || text.trim().length < 5}>
          Send on WhatsApp
        </button>
      </div>
    </Modal>
  );
}
