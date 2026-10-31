import { useState } from "react";
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
      <form className="card pad-lg stack" style={{ width: "min(400px, 100%)" }} onSubmit={submit}>
        <div className="row">
          <img src="/pro/icon.svg" width={36} alt="" />
          <div>
            <h1>TORIM Pro</h1>
            <span className="small muted">ממשק לנותני שירות</span>
          </div>
        </div>
        <div className="field">
          <label>אימייל</label>
          <input className="input" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>סיסמה</label>
          <input className="input" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="alert error">{err}</div>}
        <button className="btn block" disabled={busy}>
          כניסה
        </button>
        <div className="stack tight">
          <span className="tiny muted">משתמשי הדגמה (סיסמה demo1234):</span>
          <div className="row wrap">
            {DEMO.map((d) => (
              <button type="button" key={d.email} className="chip" style={{ border: 0, cursor: "pointer" }} onClick={() => setEmail(d.email)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
