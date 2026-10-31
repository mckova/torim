import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, Booking, Business, Provider, Service, Slot, dayLong, duration, money, time } from "@torim/shared";
import { api, getSession, rememberBooking } from "../api";
import { ErrorBox, SlotPicker, Spinner, Steps, icsHref, initials, useAccent } from "../components";
import Assistant from "./Assistant";

interface Page {
  business: Business;
  services: Service[];
  providers: Provider[];
}

interface Hold {
  token: string;
  provider_id: number;
  expires_at: string;
}

export default function BusinessPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<"book" | "chat" | "queue">("book");

  useEffect(() => {
    api.get<Page>(`/api/b/${slug}`).then(setPage).catch(setError);
  }, [slug]);
  useAccent(page?.business.accent_color);

  if (error) return <ErrorBox error={error} />;
  if (!page) return <Spinner />;
  const b = page.business;

  return (
    <div className="stack">
      <section className="biz-head">
        <h1>{b.name}</h1>
        <span className="small muted">
          {b.category}
          {b.address && ` · ${b.address}`}
        </span>
        {b.description && <p className="ink-2">{b.description}</p>}
      </section>
      <div className="tabs">
        <button className={tab === "book" ? "on" : ""} onClick={() => setTab("book")}>
          קביעת תור
        </button>
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          לכתוב לעוזר
        </button>
        <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
          תור חי
        </button>
      </div>
      {tab === "book" && <Wizard page={page} initialService={Number(params.get("service")) || null} initialDate={params.get("date")} />}
      {tab === "chat" && <Assistant slug={b.slug} businessName={b.name} />}
      {tab === "queue" && <WalkIn page={page} />}
    </div>
  );
}

function Wizard({ page, initialService, initialDate }: { page: Page; initialService: number | null; initialDate: string | null }) {
  const { business, services, providers } = page;
  const [service, setService] = useState<Service | null>(services.find((s) => s.id === initialService) ?? null);
  const [provider, setProvider] = useState<number | null | undefined>(undefined); // null = any
  const [slot, setSlot] = useState<Slot | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [waitlistDate, setWaitlistDate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const offered = useMemo(() => providers.filter((p) => service?.provider_ids.includes(p.id)), [providers, service]);
  useEffect(() => {
    if (service && offered.length === 1) setProvider(offered[0].id);
  }, [service, offered]);

  const step = booking ? 4 : hold ? 3 : provider !== undefined && service ? 2 : service ? 1 : 0;

  async function pick(s: Slot) {
    setError(null);
    setSlot(s);
    try {
      const h = await api.post<Hold>(`/api/b/${business.slug}/holds`, {
        service_id: service!.id,
        start: s.start,
        provider_id: provider ?? null,
      });
      setHold(h);
    } catch (e) {
      setSlot(null);
      setError(e);
    }
  }

  function back() {
    setError(null);
    if (hold) {
      setHold(null);
      setSlot(null);
    } else if (provider !== undefined && offered.length > 1) setProvider(undefined);
    else {
      setProvider(undefined);
      setService(null);
    }
  }

  if (waitlistDate && service) {
    return <Waitlist business={business} service={service} providerId={provider ?? null} date={waitlistDate} onBack={() => setWaitlistDate(null)} />;
  }

  return (
    <div className="stack">
      <Steps step={step} total={5} />
      {step > 0 && step < 4 && (
        <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={back}>
          חזרה
        </button>
      )}
      <ErrorBox error={error} />

      {step === 0 && (
        <div className="stack">
          <h2>איזה שירות?</h2>
          {services.map((s) => (
            <button key={s.id} className="option" onClick={() => setService(s)}>
              <div className="grow stack tight">
                <b>{s.name}</b>
                <span className="small muted">
                  {duration(s.duration)}
                  {s.capacity > 1 && ` · קבוצה עד ${s.capacity}`}
                  {s.requires_confirmation && " · דורש אישור"}
                </span>
                {s.description && <span className="tiny muted">{s.description}</span>}
              </div>
              <b>{money(s.price)}</b>
            </button>
          ))}
        </div>
      )}

      {step === 1 && service && (
        <div className="stack">
          <h2>אצל מי?</h2>
          <button className="option" onClick={() => setProvider(null)}>
            <div className="avatar" style={{ background: "var(--accent)" }}>
              ★
            </div>
            <div className="grow stack tight">
              <b>הכי מוקדם שפנוי</b>
              <span className="small muted">נשבץ אותך אצל מי שפנוי בשעה שתבחרו</span>
            </div>
          </button>
          {offered.map((p) => (
            <button key={p.id} className="option" onClick={() => setProvider(p.id)}>
              <div className="avatar" style={{ background: p.color }}>
                {initials(p.name)}
              </div>
              <div className="grow stack tight">
                <b>{p.name}</b>
                <span className="small muted">{p.title}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 2 && service && (
        <div className="stack">
          <h2>מתי נוח לך?</h2>
          <p className="small muted">
            {service.name} · {duration(service.duration)}
            {provider ? ` · ${providers.find((p) => p.id === provider)?.name}` : ""}
          </p>
          <SlotPicker
            slug={business.slug}
            serviceId={service.id}
            providerId={provider ?? null}
            initialDate={initialDate}
            selected={slot?.start}
            onPick={pick}
            onNoSlots={setWaitlistDate}
          />
        </div>
      )}

      {step === 3 && service && slot && hold && (
        <Details
          business={business}
          service={service}
          slot={slot}
          hold={hold}
          providerName={providers.find((p) => p.id === hold.provider_id)?.name ?? ""}
          onExpired={() => {
            setHold(null);
            setSlot(null);
            setError(new ApiError(410, "hold expired"));
          }}
          onDone={setBooking}
        />
      )}

      {step === 4 && booking && <Done booking={booking} business={business} />}
    </div>
  );
}

function useCountdown(until: string) {
  const [left, setLeft] = useState(() => new Date(until).getTime() - Date.now());
  useEffect(() => {
    const id = setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return Math.max(0, left);
}

function Details({
  business,
  service,
  slot,
  hold,
  providerName,
  onExpired,
  onDone,
}: {
  business: Business;
  service: Service;
  slot: Slot;
  hold: Hold;
  providerName: string;
  onExpired: () => void;
  onDone: (b: Booking) => void;
}) {
  const saved = JSON.parse(localStorage.getItem("torim.profile") || "{}");
  const [name, setName] = useState<string>(saved.name || "");
  const [phone, setPhone] = useState<string>(saved.phone || getSession()?.phone || "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const left = useCountdown(hold.expires_at);

  useEffect(() => {
    if (left === 0) onExpired();
  }, [left, onExpired]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const b = await api.post<Booking>(`/api/b/${business.slug}/bookings`, {
        service_id: service.id,
        start: slot.start,
        provider_id: hold.provider_id,
        hold_token: hold.token,
        name,
        phone,
        notes,
      });
      localStorage.setItem("torim.profile", JSON.stringify({ name, phone }));
      rememberBooking(b.uid, b.manage_token!);
      onDone(b);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");

  return (
    <form className="stack" onSubmit={submit}>
      <h2>כמעט סיימנו</h2>
      <div className="card flat">
        <div className="summary-line">
          <span className="muted">שירות</span>
          <b>{service.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">מתי</span>
          <b>
            {dayLong(slot.start)} · {time(slot.start)}
          </b>
        </div>
        <div className="summary-line">
          <span className="muted">אצל</span>
          <b>{providerName}</b>
        </div>
        <div className="summary-line">
          <span className="muted">מחיר</span>
          <b>{money(service.price)}</b>
        </div>
      </div>
      <div className="alert info small">
        השעה שמורה לך עוד <b className="countdown">{mm}:{ss}</b> דקות
      </div>
      <div className="field">
        <label htmlFor="name">שם מלא</label>
        <input id="name" className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="phone">טלפון נייד (לאישור ותזכורות בוואטסאפ)</label>
        <input id="phone" className="input" required inputMode="tel" dir="ltr" placeholder="050-0000000" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="notes">הערות (לא חובה)</label>
        <textarea id="notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <button className="btn block" disabled={busy}>
        {busy ? "קובעים..." : service.requires_confirmation ? "שליחת בקשה לתור" : "אישור וקביעת תור"}
      </button>
      <p className="tiny muted center">ביטול או שינוי אפשריים עד {business.cancel_window_hours} שעות לפני התור.</p>
    </form>
  );
}

function Done({ booking, business }: { booking: Booking; business: Business }) {
  const pending = booking.status === "pending";
  const manage = `/manage/${booking.uid}?t=${booking.manage_token}`;
  return (
    <div className="stack center">
      <div className={`done-mark ${pending ? "pending" : ""}`} aria-hidden>
        {pending ? "ממתין לאישור" : "נרשם ביומן"}
      </div>
      <h1>{pending ? "הבקשה נשלחה לעסק" : "התור נקבע"}</h1>
      <p className="muted">
        {pending ? "נעדכן אותך בוואטסאפ ברגע שהתור יאושר." : "שלחנו אישור לוואטסאפ, ונזכיר לך יום לפני ושעתיים לפני."}
      </p>
      <div className="card flat" style={{ textAlign: "start" }}>
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
          <span className="muted">איפה</span>
          <b>{business.address}</b>
        </div>
      </div>
      <a className="btn soft block" href={icsHref(`${booking.service.name} - ${business.name}`, booking.start, booking.end, business.address)} download="torim.ics">
        הוספה ליומן
      </a>
      <Link className="btn ghost block" to={manage}>
        ניהול התור (שינוי או ביטול)
      </Link>
    </div>
  );
}

function Waitlist({
  business,
  service,
  providerId,
  date,
  onBack,
}: {
  business: Business;
  service: Service;
  providerId: number | null;
  date: string;
  onBack: () => void;
}) {
  const saved = JSON.parse(localStorage.getItem("torim.profile") || "{}");
  const [name, setName] = useState<string>(saved.name || "");
  const [phone, setPhone] = useState<string>(saved.phone || "");
  const [result, setResult] = useState<{ ahead_of_you: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      setResult(
        await api.post(`/api/b/${business.slug}/waitlist`, { service_id: service.id, date, provider_id: providerId, name, phone }),
      );
    } catch (err) {
      setError(err);
    }
  }

  if (result)
    return (
      <div className="stack center">
        <div style={{ fontSize: "3rem" }}>🔔</div>
        <h2>נרשמת לרשימת ההמתנה</h2>
        <p className="muted">
          אם יתפנה מקום ל{service.name} ב{dayLong(date + "T12:00:00")}, נשלח לך הודעה מיד.
          {result.ahead_of_you > 0 && ` לפניך ברשימה: ${result.ahead_of_you}.`}
        </p>
        <button className="btn ghost" onClick={onBack}>
          חזרה לבחירת שעה
        </button>
      </div>
    );

  return (
    <form className="stack" onSubmit={submit}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        חזרה
      </button>
      <h2>רשימת המתנה</h2>
      <p className="muted small">
        {service.name} · {dayLong(date + "T12:00:00")}. מי שנרשם ראשון מקבל הודעה ראשון כשמתפנה מקום.
      </p>
      <input className="input" placeholder="שם מלא" required value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="טלפון נייד" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <ErrorBox error={error} />
      <button className="btn block">הרשמה להמתנה</button>
    </form>
  );
}

function WalkIn({ page }: { page: Page }) {
  const nav = useNavigate();
  const [board, setBoard] = useState<{ now_serving: { number: number }[]; waiting_count: number; next_eta_minutes: number | null } | null>(null);
  const [serviceId, setServiceId] = useState(page.services[0]?.id);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const load = () => api.get<typeof board>(`/api/b/${page.business.slug}/queue`).then(setBoard).catch(setError);
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [page.business.slug]);

  async function take(e: React.FormEvent) {
    e.preventDefault();
    try {
      const t = await api.post<{ uid: string }>(`/api/b/${page.business.slug}/queue`, { service_id: serviceId, name, phone });
      nav(`/ticket/${t.uid}`);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack">
      <div className="grid two">
        <div className="card center stack tight">
          <span className="small muted">עכשיו בטיפול</span>
          <b style={{ fontSize: "2rem" }}>{board?.now_serving.map((t) => t.number).join(", ") || "אין"}</b>
        </div>
        <div className="card center stack tight">
          <span className="small muted">ממתינים</span>
          <b style={{ fontSize: "2rem" }}>{board?.waiting_count ?? "0"}</b>
        </div>
      </div>
      <form className="card stack" onSubmit={take}>
        <h2>לקחת מספר</h2>
        <p className="small muted">מגיעים בלי תור? קחו מספר מהטלפון ונשלח הודעה כשמגיע תורכם.</p>
        <select className="input" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
          {page.services
            .filter((s) => s.capacity === 1)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <input className="input" placeholder="שם" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="טלפון (להתראה)" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <ErrorBox error={error} />
        <button className="btn block">קבלת מספר</button>
      </form>
    </div>
  );
}
