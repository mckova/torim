import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Booking, Business, STATUS_LABEL, dayLong, time } from "@torim/shared";
import { api, getSession, knownBookings, setSession } from "../api";
import { ErrorBox, Spinner } from "../components";

function Row({ b }: { b: Booking }) {
  const link = b.manage_token ? `/manage/${b.uid}?t=${b.manage_token}` : null;
  const inner = (
    <>
      <div className="dot" style={{ background: b.provider.color }} />
      <div className="grow stack tight">
        <b>{b.service.name}</b>
        <span className="small muted">
          {dayLong(b.start)}, {time(b.start)}, with {b.provider.name}
        </span>
        <span className="tiny muted">{b.business.name}</span>
      </div>
      <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
    </>
  );
  return link ? (
    <Link to={link} className="option" style={{ color: "inherit" }}>
      {inner}
    </Link>
  ) : (
    <div className="option">{inner}</div>
  );
}

export default function MyBookings() {
  const [session, setS] = useState(getSession());
  const [data, setData] = useState<{ upcoming: Booking[]; past: Booking[] } | null>(null);
  const [local, setLocal] = useState<Booking[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (session) {
      api.get<{ upcoming: Booking[]; past: Booking[] }>("/api/me/bookings").then(setData).catch((e) => {
        setError(e);
        setSession(null);
        setS(null);
      });
    } else {
      Promise.all(knownBookings().map((k) => api.get<Booking>(`/api/manage/${k.uid}`, { t: k.token }).catch(() => null))).then((rows) =>
        setLocal(rows.filter((b): b is Booking => !!b).sort((a, b) => a.start.localeCompare(b.start))),
      );
    }
  }, [session]);

  if (session) {
    return (
      <div className="stack">
        <div className="row between">
          <h1>My bookings</h1>
          <button
            className="btn ghost sm"
            onClick={() => {
              setSession(null);
              setS(null);
              setData(null);
            }}
          >
            Sign out
          </button>
        </div>
        <ErrorBox error={error} />
        {!data && <Spinner />}
        {data && (
          <>
            <h2>Coming up</h2>
            {data.upcoming.length ? data.upcoming.map((b) => <Row key={b.uid} b={b} />) : <div className="empty">Nothing coming up</div>}
            <h2>History</h2>
            {data.past.slice(0, 20).map((b) => (
              <Row key={b.uid} b={b} />
            ))}
          </>
        )}
      </div>
    );
  }

  const now = new Date().toISOString();
  return (
    <div className="stack">
      <h1>My bookings</h1>
      {!local && <Spinner />}
      {local && local.filter((b) => b.end > now).length > 0 && (
        <>
          <p className="small muted">Booked from this device:</p>
          {local
            .filter((b) => b.end > now)
            .map((b) => (
              <Row key={b.uid} b={b} />
            ))}
        </>
      )}
      <SignIn onIn={setS} />
    </div>
  );
}

function SignIn({ onIn }: { onIn: (s: ReturnType<typeof getSession>) => void }) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [slug, setSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.get<Business[]>("/api/businesses").then((b) => {
      setBusinesses(b);
      setSlug(b[0]?.slug ?? "");
    });
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ dev_code?: string }>(`/api/b/${slug}/otp`, { phone });
      setDevCode(r.dev_code ?? null);
      setSent(true);
    } catch (err) {
      setError(err);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api.post<{ token: string }>(`/api/b/${slug}/otp/verify`, { phone, code });
      const s = { token: r.token, slug, phone };
      setSession(s);
      onIn(s);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card stack">
      <h2>Sign in with your phone</h2>
      <p className="small muted">See all your bookings and history with a business, from any device.</p>
      {!sent ? (
        <form className="stack" onSubmit={send}>
          <select className="input" aria-label="Business" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {businesses.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
          <input className="input" inputMode="tel" aria-label="Mobile" placeholder="050-0000000" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          <ErrorBox error={error} />
          <button className="btn block">Send a code on WhatsApp</button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          {devCode && <div className="alert warn small">Demo mode: the code is {devCode}</div>}
          <input className="input center" inputMode="numeric" maxLength={6} aria-label="Code" placeholder="6-digit code" required value={code} onChange={(e) => setCode(e.target.value)} />
          <ErrorBox error={error} />
          <button className="btn block">Sign in</button>
        </form>
      )}
    </div>
  );
}
