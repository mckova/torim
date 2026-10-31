import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { translateError } from "@torim/shared";

const DEMO = [
  { email: "owner@barber.demo", label: "גל, בעל מספרה" },
  { email: "dana@barber.demo", label: "דנה, ספרית (צוות)" },
  { email: "owner@studio.demo", label: "נועה, סטודיו פילאטיס" },
];

export default function Login({ onLogin, error }: { onLogin: (token: string) => void; error: string | null }) {
  const [email, setEmail] = useState(DEMO[0].email);
  const [password, setPassword] = useState("demo1234");
  const [err, setErr] = useState<string | null>(error);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ token: string }>("/api/pro/login", { email, password });
      onLogin(r.token);
    } catch (e) {
      setErr(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="stack tight" style={{ paddingBottom: "0.75rem", borderBottom: "2px solid var(--ink)" }}>
          <span className="small"><b style={{ letterSpacing: "0.06em" }}>TORIM</b> · לעסק</span>
          <h1>כניסה ליומן</h1>
        </div>
        <div className="field">
          <label htmlFor="email">אימייל</label>
          <input id="email" className="input" dir="ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">סיסמה</label>
          <input id="password" className="input" dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="alert error" role="alert">{err}</div>}
        <button className="btn block" disabled={busy}>
          כניסה
        </button>
        <div className="stack tight">
          <span className="tiny muted">חשבונות הדגמה, הסיסמה לכולם demo1234</span>
          <div className="row wrap">
            {DEMO.map((d) => (
              <button type="button" key={d.email} className="chip" onClick={() => setEmail(d.email)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row between" style={{ borderTop: "1px solid var(--rule)", paddingTop: "0.9rem" }}>
          <span className="small muted">עדיין אין לכם חשבון?</span>
          <Link to="/signup" className="small">
            פתיחת יומן לעסק חדש
          </Link>
        </div>
      </form>
    </div>
  );
}
