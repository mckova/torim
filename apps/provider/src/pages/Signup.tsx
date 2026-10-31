import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon, translateError } from "@torim/shared";
import { api } from "../api";

interface SetupService {
  name: string;
  description: string;
  duration: number;
  price: number;
  buffer_after: number;
  capacity: number;
  requires_confirmation: boolean;
}
interface SetupDay {
  weekday: number;
  start: string;
  end: string;
  breaks: string[][];
}
interface Proposal {
  source: "ai" | "template";
  description: string;
  accent_color: string;
  services: SetupService[];
  days: SetupDay[];
  notes: string;
}

const CATEGORIES = [
  { id: "barber", label: "מספרה" },
  { id: "beauty", label: "קוסמטיקה וציפורניים" },
  { id: "clinic", label: "קליניקה / טיפולים" },
  { id: "fitness", label: "סטודיו / כושר" },
  { id: "other", label: "אחר" },
];
const EXAMPLES: Record<string, string> = {
  barber: "אני ספר, עובד לבד בחיפה. תספורת גבר 80 ש״ח, עם זקן 110. עובד א׳-ה׳ 10 עד 20, ובשישי עד 14. הפסקה בצהריים חצי שעה.",
  beauty: "סטודיו לציפורניים ברמת גן. מניקור ג׳ל, לק בפדיקור, בניית ציפורניים. ימים א׳-ה׳ 9:30-19:00, שישי עד 13:00.",
  clinic: "קליניקה לפיזיותרפיה. פגישת אבחון ראשונה שעה, טיפולי המשך 45 דקות. מקבלת קהל ב׳, ג׳, ה׳ 8-17 וב-א׳ עד 13.",
  fitness: "סטודיו פילאטיס מכשירים. שיעורים קבוצתיים של 50 דקות עד 6 משתתפות, אימון אישי. בוקר 7-11 וערב 17-21.",
  other: "",
};
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const DAY_NAME = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"];
const STEPS = ["העסק", "ספרו לנו", "שירותים ושעות", "החשבון שלכם"];

export default function Signup({ onDone }: { onDone: (token: string) => void }) {
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [biz, setBiz] = useState({ name: "", category: "barber", phone: "", address: "" });
  const [about, setAbout] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [account, setAccount] = useState({ owner_name: "", email: "", password: "", slug: "" });
  const [slugState, setSlugState] = useState<"idle" | "ok" | "taken" | "invalid">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), [step]);

  // A proposal written on the public page carries over, so the owner lands on review.
  useEffect(() => {
    const raw = sessionStorage.getItem("torim.setup");
    if (!raw) return;
    sessionStorage.removeItem("torim.setup");
    try {
      const saved = JSON.parse(raw) as { name: string; category: string; about: string; proposal: Proposal };
      setBiz((b) => ({ ...b, name: saved.name, category: saved.category }));
      setAbout(saved.about);
      setProposal(saved.proposal);
      setStep(2);
    } catch {
      /* ignore a malformed draft */
    }
  }, []);

  useEffect(() => {
    const slug = account.slug.trim().toLowerCase();
    if (!slug) return setSlugState("idle");
    const t = setTimeout(() => {
      api
        .get<{ valid: boolean; available: boolean }>("/api/pro/slug-available", { slug })
        .then((r) => setSlugState(!r.valid ? "invalid" : r.available ? "ok" : "taken"))
        .catch(() => setSlugState("idle"));
    }, 300);
    return () => clearTimeout(t);
  }, [account.slug]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.post<Proposal>("/api/pro/setup/suggest", { name: biz.name, category: biz.category, description: about });
      setProposal(p);
      setStep(2);
    } catch (e) {
      setError(translateError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ token: string }>("/api/pro/signup", {
        business_name: biz.name,
        category: biz.category,
        phone: biz.phone,
        address: biz.address,
        description: proposal.description,
        accent_color: proposal.accent_color,
        services: proposal.services,
        days: proposal.days,
        ...account,
        slug: account.slug.trim().toLowerCase(),
      });
      onDone(r.token);
      nav("/", { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  const setSvc = (i: number, patch: Partial<SetupService>) =>
    setProposal((p) => p && { ...p, services: p.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const dayOf = (wd: number) => proposal?.days.find((d) => d.weekday === wd);
  const setDay = (wd: number, d: SetupDay | null) =>
    setProposal((p) => p && { ...p, days: [...p.days.filter((x) => x.weekday !== wd), ...(d ? [d] : [])] });

  return (
    <div className="signup">
      <aside className="signup-aside">
        <div className="brand">
          <b>TORIM</b> <span className="muted small">לעסק</span>
        </div>
        <p className="hide-sm">
          פתיחת יומן תורים לעסק. בשלב השני מתארים את העסק במילים שלכם, והעוזר רושם את השירותים, המחירים ושעות הפעילות. כל מה שהוא כתב מסומן בכחול ואפשר לשנות.
        </p>
        <div className="signup-steps" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s} className={i === step ? "on" : i < step ? "done" : ""}>
              <b>{String(i + 1).padStart(2, "0")}</b>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="signup-main">
        <p className="eyebrow">
          שלב {step + 1} מתוך {STEPS.length}
        </p>

        {step === 0 && (
          <form
            className="stack loose"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(1);
            }}
          >
            <h2 ref={heading} tabIndex={-1} className="step-title">
              מה שם העסק?
            </h2>
            <div className="field">
              <label htmlFor="biz-name">שם העסק</label>
              <input id="biz-name" className="input" required minLength={2} value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} placeholder="למשל: המספרה של רון" autoFocus />
            </div>
            <div className="field">
              <span className="label" id="cat-label">
                תחום
              </span>
              <div className="cat-grid" role="radiogroup" aria-labelledby="cat-label">
                {CATEGORIES.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    role="radio"
                    aria-checked={biz.category === c.id}
                    className={`option ${biz.category === c.id ? "selected" : ""}`}
                    onClick={() => setBiz({ ...biz, category: c.id })}
                  >
                    <span className="small">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid two">
              <div className="field">
                <label htmlFor="biz-phone">טלפון העסק</label>
                <input id="biz-phone" className="input" dir="ltr" inputMode="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="biz-addr">כתובת</label>
                <input id="biz-addr" className="input" value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} />
              </div>
            </div>
            <div className="row between">
              <Link to="/" className="small">
                כבר יש לי חשבון
              </Link>
              <button className="btn lg">המשך</button>
            </div>
          </form>
        )}

        {step === 1 && (
          <div className="stack loose">
            <div className="stack tight">
              <h2 ref={heading} tabIndex={-1} className="step-title">
                ספרו לנו על {biz.name || "העסק"}
              </h2>
              <p className="muted">איזה שירותים, כמה זמן כל אחד, מחירים, ימים ושעות. אפשר בקצרה ובשפה חופשית, מה שלא תכתבו ה-AI ישלים לפי מה שמקובל בתחום.</p>
            </div>
            <div className="field">
              <label htmlFor="about">
                התיאור שלכם
              </label>
              <textarea id="about" className="input" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={EXAMPLES[biz.category] || "תארו את העסק…"} />
              {EXAMPLES[biz.category] && !about && (
                <button type="button" className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setAbout(EXAMPLES[biz.category])}>
                  להשתמש בדוגמה
                </button>
              )}
            </div>
            {busy && (
              <div className="ai-thinking" role="status">
                <div className="spinner" />
                <span className="writing">העוזר רושם שירותים ושעות</span>
              </div>
            )}
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(0)}>
                חזרה
              </button>
              <div className="row">
                <button type="button" className="btn ghost" disabled={busy} onClick={() => { setAbout(""); generate(); }}>
                  דילוג, תבנית מוכנה
                </button>
                <button type="button" className="btn ai lg" disabled={busy || !about.trim()} onClick={generate}>
                  לרשום לי את העסק
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 2 && proposal && (
          <form
            className="stack loose"
            onSubmit={(e) => {
              e.preventDefault();
              setStep(3);
            }}
          >
            <div className="stack tight">
              <h2 ref={heading} tabIndex={-1} className="step-title">
                {proposal.source === "ai" ? "זה מה שהעוזר רשם" : "נקודת התחלה לתחום שלכם"}
              </h2>
              <p className="muted">הכול ניתן לעריכה, עכשיו או בכל רגע אחר כך.</p>
              {proposal.notes && (
                <p className="by-ai small">{proposal.notes}</p>
              )}
            </div>

            <section className="proposal-section" aria-labelledby="svc-h">
              <div className="section-title">
                <h3 id="svc-h">שירותים</h3>
                {proposal.source === "ai" && <span className="ai-sign">נרשם ע״י העוזר</span>}
              </div>
              {proposal.services.map((s, i) => (
                <div key={i} className="svc-row">
                  <input className={`input ${proposal.source === "ai" ? "by-ai" : ""}`} aria-label="שם השירות" required value={s.name} onChange={(e) => setSvc(i, { name: e.target.value })} />
                  <div className="input-group">
                    <input className="input num" aria-label="משך בדקות" type="number" min={5} max={480} required value={s.duration} onChange={(e) => setSvc(i, { duration: Number(e.target.value) })} />
                    <span className="addon">דק׳</span>
                  </div>
                  <div className="input-group">
                    <input className="input num" aria-label="מחיר" type="number" min={0} required value={s.price} onChange={(e) => setSvc(i, { price: Number(e.target.value) })} />
                    <span className="addon">₪</span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost icon-only sm"
                    aria-label={`הסרת ${s.name}`}
                    disabled={proposal.services.length === 1}
                    onClick={() => setProposal({ ...proposal, services: proposal.services.filter((_, j) => j !== i) })}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn soft sm"
                style={{ alignSelf: "flex-start" }}
                onClick={() => setProposal({ ...proposal, services: [...proposal.services, { name: "", description: "", duration: 30, price: 0, buffer_after: 0, capacity: 1, requires_confirmation: false }] })}
              >
                הוספת שירות
              </button>
            </section>

            <section className="proposal-section" aria-labelledby="hours-h">
              <h3 id="hours-h">שעות פעילות</h3>
              {WEEK.map((wd) => {
                const d = dayOf(wd);
                return (
                  <div key={wd} className="day-row">
                    <b className="small">{DAY_NAME[wd]}</b>
                    <button
                      type="button"
                      className={`toggle ${d ? "on" : ""}`}
                      role="switch"
                      aria-checked={!!d}
                      aria-label={`פתוח ביום ${DAY_NAME[wd]}`}
                      onClick={() => setDay(wd, d ? null : { weekday: wd, start: "09:00", end: "18:00", breaks: [] })}
                    />
                    {d ? (
                      <div className="row wrap">
                        <input type="time" className="input num" aria-label="שעת פתיחה" value={d.start} onChange={(e) => setDay(wd, { ...d, start: e.target.value })} />
                        <span className="muted">עד</span>
                        <input type="time" className="input num" aria-label="שעת סגירה" value={d.end} onChange={(e) => setDay(wd, { ...d, end: e.target.value })} />
                        {d.breaks.map((b) => (
                          <span key={b.join()} className="chip">
                            הפסקה <bdi>{b[0]}-{b[1]}</bdi>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="small muted">סגור</span>
                    )}
                  </div>
                );
              })}
            </section>

            <section className="proposal-section" aria-labelledby="look-h">
              <h3 id="look-h">איך הדף שלכם ייראה ללקוחות</h3>
              <div className="field">
                <label htmlFor="pub-desc">תיאור קצר</label>
                <textarea id="pub-desc" className="input" rows={2} value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} />
              </div>
              <div className="row">
                <label htmlFor="color" className="label">
                  צבע המותג
                </label>
                <input id="color" type="color" value={proposal.accent_color} onChange={(e) => setProposal({ ...proposal, accent_color: e.target.value })} />
              </div>
            </section>

            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                חזרה
              </button>
              <button className="btn lg" disabled={proposal.days.length === 0}>
                נראה טוב, המשך
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form className="stack loose" onSubmit={submit}>
            <h2 ref={heading} tabIndex={-1} className="step-title">
              החשבון שלכם
            </h2>
            <div className="grid two">
              <div className="field">
                <label htmlFor="owner">השם שלכם</label>
                <input id="owner" className="input" required minLength={2} autoComplete="name" value={account.owner_name} onChange={(e) => setAccount({ ...account, owner_name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="email">אימייל</label>
                <input
                  id="email"
                  className="input"
                  dir="ltr"
                  type="email"
                  required
                  autoComplete="email"
                  value={account.email}
                  onChange={(e) => {
                    const email = e.target.value;
                    setAccount((a) => ({ ...a, email, slug: a.slug && a.slug !== autoSlug(a.email) ? a.slug : autoSlug(email) }));
                  }}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="pw">סיסמה</label>
              <input id="pw" className="input" dir="ltr" type="password" required minLength={8} autoComplete="new-password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} aria-describedby="pw-hint" />
              <span id="pw-hint" className="hint">
                לפחות 8 תווים
              </span>
            </div>
            <div className="field">
              <label htmlFor="slug">הקישור של העסק</label>
              <div className="input-group" dir="ltr">
                <span className="addon">torim.app/b/</span>
                <input
                  id="slug"
                  className="input"
                  required
                  value={account.slug}
                  onChange={(e) => setAccount({ ...account, slug: e.target.value })}
                  aria-invalid={slugState === "taken" || slugState === "invalid"}
                  aria-describedby="slug-hint"
                />
              </div>
              <span id="slug-hint" className="hint" aria-live="polite" style={{ color: slugState === "ok" ? "var(--ok)" : slugState === "idle" ? undefined : "var(--danger)" }}>
                {slugState === "ok" ? "✓ פנוי" : slugState === "taken" ? "הקישור הזה תפוס" : slugState === "invalid" ? "אותיות באנגלית, ספרות ומקפים, 3 עד 40 תווים" : "את הקישור הזה תשלחו ללקוחות"}
              </span>
            </div>
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(2)}>
                חזרה
              </button>
              <button className="btn lg" disabled={busy || slugState === "taken" || slugState === "invalid"}>
                {busy ? "פותח את העסק…" : "פתיחת העסק"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function autoSlug(email: string) {
  return email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
