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
          {dayLong(b.start)} · {time(b.start)} · {b.provider.name}
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
          <h1>התורים שלי</h1>
          <button
            className="btn ghost sm"
            onClick={() => {
              setSession(null);
              setS(null);
              setData(null);
            }}
          >
            יציאה
          </button>
        </div>
        <ErrorBox error={error} />
        {!data && <Spinner />}
        {data && (
          <>
            <h2>קרובים</h2>
            {data.upcoming.length ? data.upcoming.map((b) => <Row key={b.uid} b={b} />) : <div className="empty">אין תורים קרובים</div>}
            <h2>היסטוריה</h2>
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
      <h1>התורים שלי</h1>
      {!local && <Spinner />}
      {local && local.filter((b) => b.end > now).length > 0 && (
        <>
          <p className="small muted">תורים שנקבעו מהמכשיר הזה:</p>
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
      <h2>כניסה עם מספר טלפון</h2>
      <p className="small muted">לצפייה בכל התורים וההיסטוריה שלך בעסק, גם ממכשיר אחר.</p>
      {!sent ? (
        <form className="stack" onSubmit={send}>
          <select className="input" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {businesses.map((b) => (
              <option key={b.slug} value={b.slug}>
                {b.name}
              </option>
            ))}
          </select>
          <input className="input" dir="ltr" inputMode="tel" placeholder="050-0000000" required value={phone} onChange={(e) => setPhone(e.target.value)} />
          <ErrorBox error={error} />
          <button className="btn block">שליחת קוד בוואטסאפ</button>
        </form>
      ) : (
        <form className="stack" onSubmit={verify}>
          {devCode && <div className="alert warn small">מצב הדגמה: הקוד הוא {devCode}</div>}
          <input className="input center" dir="ltr" inputMode="numeric" maxLength={6} placeholder="קוד בן 6 ספרות" required value={code} onChange={(e) => setCode(e.target.value)} />
          <ErrorBox error={error} />
          <button className="btn block">כניסה</button>
        </form>
      )}
    </div>
  );
}
