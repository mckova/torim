import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Booking, STATUS_LABEL, Slot, dayLong, money, time } from "@torim/shared";
import { api, rememberBooking } from "../api";
import { ErrorBox, SlotPicker, Spinner, icsHref } from "../components";

export default function Manage() {
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const t = params.get("t") ?? "";
  const [booking, setBooking] = useState<Booking | null>(null);
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    api
      .get<Booking>(`/api/manage/${uid}`, { t })
      .then((b) => {
        setBooking(b);
        rememberBooking(b.uid, t);
      })
      .catch(setError);
  }, [uid, t]);

  function flash(text: string) {
    setToast(text);
    setTimeout(() => setToast(""), 3000);
  }

  async function cancel() {
    try {
      setBooking(await api.post<Booking>(`/api/manage/${uid}/cancel`, { t, reason }));
      setMode("view");
      flash("Booking cancelled");
    } catch (e) {
      setError(e);
    }
  }

  async function move(slot: Slot) {
    try {
      setBooking(await api.post<Booking>(`/api/manage/${uid}/reschedule`, { t, start: slot.start }));
      setMode("view");
      flash("Booking moved");
    } catch (e) {
      setError(e);
    }
  }

  if (!booking) return error ? <ErrorBox error={error} /> : <Spinner />;
  const active = booking.status === "pending" || booking.status === "confirmed";

  return (
    <div className="stack">
      <div className="row between">
        <h1>Your booking</h1>
        <span className={`chip ${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
      </div>
      <div className="card">
        <div className="summary-line">
          <span className="muted">Business</span>
          <Link to={`/b/${booking.business.slug}`}>
            <b>{booking.business.name}</b>
          </Link>
        </div>
        <div className="summary-line">
          <span className="muted">Service</span>
          <b>{booking.service.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">When</span>
          <b>
            {dayLong(booking.start)}, {time(booking.start)}
          </b>
        </div>
        <div className="summary-line">
          <span className="muted">With</span>
          <b>{booking.provider.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">Price</span>
          <b>{money(booking.price)}</b>
        </div>
      </div>
      <ErrorBox error={error} />

      {active && mode === "view" && (
        <div className="stack tight">
          <a className="btn soft block" href={icsHref(booking.service.name + ", " + booking.business.name, booking.start, booking.end, "")} download="torim.ics">
            Add to calendar
          </a>
          <button className="btn ghost block" onClick={() => setMode("move")}>
            Change time
          </button>
          <button className="btn danger block" onClick={() => setMode("cancel")}>
            Cancel booking
          </button>
        </div>
      )}

      {mode === "move" && (
        <div className="stack">
          <div className="row between">
            <h2>Pick a new time</h2>
            <button className="btn ghost sm" onClick={() => setMode("view")}>
              Close
            </button>
          </div>
          <SlotPicker slug={booking.business.slug} serviceId={booking.service.id} providerId={booking.provider.id} onPick={move} />
        </div>
      )}

      {mode === "cancel" && (
        <div className="card stack">
          <h2>Cancel this booking?</h2>
          <p className="small muted">The time goes back to other clients on the waitlist.</p>
          <input className="input" placeholder="Reason (optional)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button className="btn danger grow" onClick={cancel}>
              Yes, cancel
            </button>
            <button className="btn ghost grow" onClick={() => setMode("view")}>
              No, keep it
            </button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
