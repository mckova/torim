import { ReactNode, useEffect, useRef, useState } from "react";
import { Booking, Icon, STATUS_LABEL, Slot, addDays, dayLong, isoDate, money, phoneDisplay, time, translateError } from "@torim/shared";
import { api, useMe } from "./api";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(box.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? []).filter((el) => !el.hasAttribute("disabled"));
    (focusables()[1] ?? focusables()[0])?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={box} className="modal stack" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="btn ghost sm icon-only" onClick={onClose} aria-label="סגירה">
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState("");
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2600);
  };
  const node = msg ? <div className="toast">{msg}</div> : null;
  return [node, show] as const;
}

export function ErrorText({ error }: { error: unknown }) {
  return error ? <div className="alert error">{translateError(error)}</div> : null;
}

/** Status buttons that make sense for the booking's current state. */
export function BookingActions({ b, onChange }: { b: Booking; onChange: (b: Booking) => void }) {
  const [error, setError] = useState<unknown>(null);
  const isPast = new Date(b.start) < new Date();
  async function go(status: string) {
    setError(null);
    try {
      onChange(await api.post<Booking>(`/api/pro/bookings/${b.id}/status`, { status }));
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="stack tight">
      <div className="row wrap">
        {b.status === "pending" && (
          <button className="btn sm" onClick={() => go("confirmed")}>
            אישור
          </button>
        )}
        {b.status === "confirmed" && (
          <>
            <button className="btn sm" onClick={() => go("completed")}>
              ✓ הגיע
            </button>
            {isPast && (
              <button className="btn soft sm" onClick={() => go("no_show")}>
                לא הגיע
              </button>
            )}
          </>
        )}
        {(b.status === "pending" || b.status === "confirmed") && (
          <button className="btn danger sm" onClick={() => go("cancelled")}>
            {b.status === "pending" ? "דחייה" : "ביטול"}
          </button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function BookingModal({ b, onClose, onChange, onRemind }: { b: Booking; onClose: () => void; onChange: (b: Booking) => void; onRemind?: (b: Booking) => void }) {
  const upcoming = (b.status === "pending" || b.status === "confirmed") && new Date(b.start) > new Date();
  return (
    <Modal title={b.customer.name} onClose={onClose}>
      <div className="row wrap">
        <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
        <span className="chip">{b.source === "online" ? "הזמנה אונליין" : b.source === "provider" ? "נקבע ע״י העסק" : b.source === "ai" ? "נקבע ע״י העוזר" : b.source}</span>
      </div>
      <div className="card flat">
        <Line k="שירות" v={b.service.name} />
        <Line k="מתי" v={`${dayLong(b.start)} · ${time(b.start)}–${time(b.end)}`} />
        <Line k="אצל" v={b.provider.name} />
        <Line k="טלפון" v={<a href={`tel:${b.customer.phone}`} dir="ltr">{phoneDisplay(b.customer.phone)}</a>} />
        <Line k="מחיר" v={money(b.price)} />
        {b.notes && <Line k="הערות" v={b.notes} />}
        {b.cancellation_reason && <Line k="סיבת ביטול" v={b.cancellation_reason} />}
      </div>
      <div className="row wrap">
        <a className="btn ghost sm" href={`https://wa.me/${b.customer.phone.replace("+", "")}`} target="_blank" rel="noreferrer">
          וואטסאפ ללקוח
        </a>
        {upcoming && onRemind && (
          <button className="btn soft sm" onClick={() => onRemind(b)}>
            תזכורת אישית
          </button>
        )}
      </div>
      <BookingActions b={b} onChange={onChange} />
    </Modal>
  );
}

function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row between" style={{ padding: "0.4rem 0", borderBottom: "1px dashed var(--line)" }}>
      <span className="muted small">{k}</span>
      <b className="small">{v}</b>
    </div>
  );
}

export function NewBookingModal({ onClose, onCreated, date: initialDate }: { onClose: () => void; onCreated: (b: Booking) => void; date?: string }) {
  const { data } = useMe();
  const services = data.services.filter((s) => s.active);
  const isOwner = data.me.role === "owner";
  const [serviceId, setServiceId] = useState(services[0]?.id);
  const service = services.find((s) => s.id === serviceId);
  const providerOptions = data.providers.filter((p) => service?.provider_ids.includes(p.id) && (isOwner || p.id === data.me.id));
  const [providerId, setProviderId] = useState<number | null>(null);
  const [date, setDate] = useState(initialDate ?? isoDate());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setProviderId(providerOptions[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  useEffect(() => {
    if (!serviceId || !providerId) return;
    setSlots(null);
    setStart(null);
    api.get<Slot[]>("/api/pro/slots", { service_id: serviceId, date, provider_id: providerId }).then(setSlots).catch(setError);
  }, [serviceId, providerId, date]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      onCreated(await api.post<Booking>("/api/pro/bookings", { service_id: serviceId, provider_id: providerId, start, name, phone, notes }));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title="תור חדש" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid two">
          <div className="field">
            <label htmlFor="nb-service">שירות</label>
            <select id="nb-service" className="input" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nb-provider">נותן שירות</label>
            <select id="nb-provider" className="input" value={providerId ?? ""} onChange={(e) => setProviderId(Number(e.target.value))}>
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn ghost sm icon-only" onClick={() => setDate(addDays(date, -1))} aria-label="יום קודם">
            <Icon name="arrow" className="flip-rtl" />
          </button>
          <input type="date" className="input grow" aria-label="תאריך" value={date} onChange={(e) => setDate(e.target.value)} />
          <button type="button" className="btn ghost sm icon-only" onClick={() => setDate(addDays(date, 1))} aria-label="יום הבא">
            <Icon name="arrow" />
          </button>
        </div>
        {!slots ? (
          <div className="spinner" />
        ) : slots.length === 0 ? (
          <div className="empty small">אין שעות פנויות ביום הזה</div>
        ) : (
          <div className="slots">
            {slots.map((s) => (
              <button type="button" key={s.start} className={`slot ${start === s.start ? "selected" : ""}`} onClick={() => setStart(s.start)}>
                {time(s.start)}
              </button>
            ))}
          </div>
        )}
        <div className="grid two">
          <input className="input" aria-label="שם הלקוח" placeholder="שם הלקוח" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" aria-label="טלפון" placeholder="טלפון" dir="ltr" inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <input className="input" aria-label="הערה" placeholder="הערה (לא חובה)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ErrorText error={error} />
        <button className="btn block" disabled={!start}>
          קביעת התור ושליחת אישור ללקוח
        </button>
      </form>
    </Modal>
  );
}
