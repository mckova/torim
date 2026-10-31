import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { translateError } from "@torim/shared";

const DEMO = [
  { email: "owner@barber.demo", label: "Gal, barbershop owner" },
  { email: "dana@barber.demo", label: "Dana, stylist (staff)" },
  { email: "owner@studio.demo", label: "Noa, Pilates studio" },
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
      <form className="login-card panel" onSubmit={submit}>
        <div className="stack tight">
          <span className="brand">
            <span className="logo-mark" aria-hidden>
              t
            </span>
            torim
          </span>
          <h1>Sign in to your calendar</h1>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="alert error" role="alert">{err}</div>}
        <button className="btn cta block" disabled={busy}>
          Sign in
        </button>
        <div className="stack tight">
          <span className="tiny muted">Demo accounts, all with the password demo1234</span>
          <div className="row wrap">
            {DEMO.map((d) => (
              <button type="button" key={d.email} className="chip" onClick={() => setEmail(d.email)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
        <div className="row between" style={{ borderTop: "1px solid var(--rule-2)", paddingTop: "0.9rem" }}>
          <span className="small muted">New to TORIM?</span>
          <Link to="/signup" className="small">
            Open a calendar for your business
          </Link>
        </div>
      </form>
    </div>
  );
}
