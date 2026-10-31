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
      flash("התור בוטל");
    } catch (e) {
      setError(e);
    }
  }

  async function move(slot: Slot) {
    try {
      setBooking(await api.post<Booking>(`/api/manage/${uid}/reschedule`, { t, start: slot.start }));
      setMode("view");
      flash("התור הועבר בהצלחה");
    } catch (e) {
      setError(e);
    }
  }

  if (!booking) return error ? <ErrorBox error={error} /> : <Spinner />;
  const active = booking.status === "pending" || booking.status === "confirmed";

  return (
    <div className="stack">
      <div className="row between">
        <h1>התור שלך</h1>
        <span className={`chip ${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
      </div>
      <div className="card">
        <div className="summary-line">
          <span className="muted">עסק</span>
          <Link to={`/b/${booking.business.slug}`}>
            <b>{booking.business.name}</b>
          </Link>
        </div>
        <div className="summary-line">
          <span className="muted">שירות</span>
          <b>{booking.service.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">מתי</span>
          <b>
            {dayLong(booking.start)} · {time(booking.start)}
          </b>
        </div>
        <div className="summary-line">
          <span className="muted">אצל</span>
          <b>{booking.provider.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">מחיר</span>
          <b>{money(booking.price)}</b>
        </div>
      </div>
      <ErrorBox error={error} />

      {active && mode === "view" && (
        <div className="stack tight">
          <a className="btn soft block" href={icsHref(booking.service.name + " - " + booking.business.name, booking.start, booking.end, "")} download="torim.ics">
            הוספה ליומן
          </a>
          <button className="btn ghost block" onClick={() => setMode("move")}>
            שינוי מועד
          </button>
          <button className="btn danger block" onClick={() => setMode("cancel")}>
            ביטול התור
          </button>
        </div>
      )}

      {mode === "move" && (
        <div className="stack">
          <div className="row between">
            <h2>בחירת מועד חדש</h2>
            <button className="btn ghost sm" onClick={() => setMode("view")}>
              סגירה
            </button>
          </div>
          <SlotPicker slug={booking.business.slug} serviceId={booking.service.id} providerId={booking.provider.id} onPick={move} />
        </div>
      )}

      {mode === "cancel" && (
        <div className="card stack">
          <h2>לבטל את התור?</h2>
          <p className="small muted">השעה תשוחרר ללקוחות אחרים ברשימת ההמתנה.</p>
          <input className="input" placeholder="סיבה (לא חובה)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button className="btn danger grow" onClick={cancel}>
              כן, לבטל
            </button>
            <button className="btn ghost grow" onClick={() => setMode("view")}>
              לא, להשאיר
            </button>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
