import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, Booking, Business, Icon, Provider, Service, Slot, dayLong, duration, money, time } from "@torim/shared";
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
          {b.address && `, ${b.address}`}
        </span>
        {b.description && <p className="ink-2">{b.description}</p>}
      </section>
      <div className="tabs">
        <button className={tab === "book" ? "on" : ""} onClick={() => setTab("book")}>
          Book
        </button>
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          Ask the assistant
        </button>
        <button className={tab === "queue" ? "on" : ""} onClick={() => setTab("queue")}>
          Walk-in
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
          Back
        </button>
      )}
      <ErrorBox error={error} />

      {step === 0 && (
        <div className="stack">
          <h2>Which service?</h2>
          {services.map((s) => (
            <button key={s.id} className="option" onClick={() => setService(s)}>
              <div className="grow stack tight">
                <b>{s.name}</b>
                <span className="small muted">
                  {duration(s.duration)}
                  {s.capacity > 1 && `, group of up to ${s.capacity}`}
                  {s.requires_confirmation && ", needs approval"}
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
          <h2>With whom?</h2>
          <button className="option" onClick={() => setProvider(null)}>
            <div className="avatar" style={{ background: "var(--sunset)" }} aria-hidden>
              <Icon name="clock" />
            </div>
            <div className="grow stack tight">
              <b>First available</b>
              <span className="small muted">We'll book you with whoever is free at the time you pick</span>
            </div>
          </button>
          {offered.map((p) => (
            <button key={p.id} className="option" onClick={() => setProvider(p.id)}>
              <div className="avatar" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${p.color} 45%, white), ${p.color})` }} aria-hidden>
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
          <h2>When suits you?</h2>
          <p className="small muted">
            {service.name}, {duration(service.duration)}
            {provider ? `, with ${providers.find((p) => p.id === provider)?.name}` : ""}
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
      <h2>Almost done</h2>
      <div className="card flat">
        <div className="summary-line">
          <span className="muted">Service</span>
          <b>{service.name}</b>
        </div>
        <div className="summary-line">
          <span className="muted">When</span>
          <b>
            {dayLong(slot.start)}, {time(slot.start)}
          </b>
        </div>
        <div className="summary-line">
          <span className="muted">With</span>
          <b>{providerName}</b>
        </div>
        <div className="summary-line">
          <span className="muted">Price</span>
          <b>{money(service.price)}</b>
        </div>
      </div>
      <div className="alert info small">
        We're holding this time for you for <b className="countdown">{mm}:{ss}</b>
      </div>
      <div className="field">
        <label htmlFor="name">Full name</label>
        <input id="name" className="input" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="phone">Mobile (for the WhatsApp confirmation and reminders)</label>
        <input id="phone" className="input" required inputMode="tel" placeholder="050-0000000" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="notes">Notes (optional)</label>
        <textarea id="notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      <button className="btn cta block" disabled={busy}>
        {busy ? "Booking…" : service.requires_confirmation ? "Send the request" : "Confirm booking"}
      </button>
      <p className="tiny muted center">You can change or cancel up to {business.cancel_window_hours} hours before.</p>
    </form>
  );
}

function Done({ booking, business }: { booking: Booking; business: Business }) {
  const pending = booking.status === "pending";
  const manage = `/manage/${booking.uid}?t=${booking.manage_token}`;
  return (
    <div className="stack center">
      <div className={`done-mark ${pending ? "pending" : ""}`} aria-hidden>
        {pending ? "Waiting for approval" : "You're booked"}
      </div>
      <h1>{pending ? "Request sent to the business" : "See you there"}</h1>
      <p className="muted">
        {pending ? "We'll message you on WhatsApp as soon as it's approved." : "We sent a confirmation to WhatsApp, and we'll remind you a day before and two hours before."}
      </p>
      <div className="card flat" style={{ textAlign: "start" }}>
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
          <span className="muted">Where</span>
          <b>{business.address}</b>
        </div>
      </div>
      <a className="btn soft block" href={icsHref(`${booking.service.name}, ${business.name}`, booking.start, booking.end, business.address)} download="torim.ics">
        Add to calendar
      </a>
      <Link className="btn ghost block" to={manage}>
        Manage booking (change or cancel)
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
        <div className="done-mark" aria-hidden>
          On the waitlist
        </div>
        <h2>We'll let you know</h2>
        <p className="muted">
          If a spot opens up for {service.name} on {dayLong(date + "T12:00:00")}, we'll message you right away.
          {result.ahead_of_you > 0 && ` Ahead of you: ${result.ahead_of_you}.`}
        </p>
        <button className="btn ghost" onClick={onBack}>
          Back to times
        </button>
      </div>
    );

  return (
    <form className="stack" onSubmit={submit}>
      <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={onBack}>
        Back
      </button>
      <h2>Waitlist</h2>
      <p className="muted small">
        {service.name}, {dayLong(date + "T12:00:00")}. First to join is the first to hear when a spot opens up.
      </p>
      <input className="input" placeholder="Full name" aria-label="Full name" required value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Mobile" aria-label="Mobile" required value={phone} onChange={(e) => setPhone(e.target.value)} />
      <ErrorBox error={error} />
      <button className="btn block">Join the waitlist</button>
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
          <span className="small muted">Now serving</span>
          <b style={{ fontSize: "2rem" }}>{board?.now_serving.map((t) => t.number).join(", ") || "Nobody"}</b>
        </div>
        <div className="card center stack tight">
          <span className="small muted">Waiting</span>
          <b style={{ fontSize: "2rem" }}>{board?.waiting_count ?? "0"}</b>
        </div>
      </div>
      <form className="card stack" onSubmit={take}>
        <h2>Take a number</h2>
        <p className="small muted">No appointment? Take a number on your phone and we'll message you when you're up.</p>
        <select className="input" aria-label="Service" value={serviceId} onChange={(e) => setServiceId(Number(e.target.value))}>
          {page.services
            .filter((s) => s.capacity === 1)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <input className="input" placeholder="Name" aria-label="Name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Phone, for the alert" aria-label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <ErrorBox error={error} />
        <button className="btn cta block">Get a number</button>
      </form>
    </div>
  );
}
