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
  { id: "barber", label: "Barbershop" },
  { id: "beauty", label: "Beauty and nails" },
  { id: "clinic", label: "Clinic and treatments" },
  { id: "fitness", label: "Studio and fitness" },
  { id: "other", label: "Something else" },
];
const EXAMPLES: Record<string, string> = {
  barber: "I'm a barber working alone in Haifa. Men's cut 80 shekels, with beard 110. Sunday to Thursday 10 to 8, Friday until 2. Half an hour lunch break.",
  beauty: "Nail studio in Ramat Gan. Gel manicure, pedicure, nail extensions. Sunday to Thursday 9:30 to 7, Friday until 1.",
  clinic: "Physiotherapy clinic. First assessment is an hour, follow-ups 45 minutes. Open Monday, Tuesday and Thursday 8 to 5, Sunday until 1.",
  fitness: "Reformer Pilates studio. 50 minute group classes of up to 6, and personal training. Mornings 7 to 11 and evenings 5 to 9.",
  other: "",
};
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STEPS = ["The business", "Tell us about it", "Services and hours", "Your account"];

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
      <aside className="signup-aside panel sunset">
        <div className="brand">
          <span className="logo-mark" style={{ background: "#fff", color: "var(--rose-ink)" }} aria-hidden>
            t
          </span>
          torim
        </div>
        <p className="hide-sm">
          Open an appointment calendar for your business. In step two you describe the business in your own words, and the assistant writes the services, prices and opening hours. You can change anything it wrote.
        </p>
        <div className="signup-steps" aria-hidden>
          {STEPS.map((s, i) => (
            <div key={s} className={i === step ? "on" : i < step ? "done" : ""}>
              <b>{i + 1}</b>
              <span>{s}</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="signup-main panel">
        <p className="eyebrow">
          Step {step + 1} of {STEPS.length}
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
              What is the business called?
            </h2>
            <div className="field">
              <label htmlFor="biz-name">Business name</label>
              <input id="biz-name" className="input" required minLength={2} value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} placeholder="For example: Ron's Barbershop" autoFocus />
            </div>
            <div className="field">
              <span className="label" id="cat-label">
                Type of business
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
                <label htmlFor="biz-phone">Business phone</label>
                <input id="biz-phone" className="input" inputMode="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="biz-addr">Address</label>
                <input id="biz-addr" className="input" value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} />
              </div>
            </div>
            <div className="row between">
              <Link to="/" className="small">
                I already have an account
              </Link>
              <button className="btn lg">Continue</button>
            </div>
          </form>
        )}

        {step === 1 && (
          <div className="stack loose">
            <div className="stack tight">
              <h2 ref={heading} tabIndex={-1} className="step-title">
                Tell us about {biz.name || "the business"}
              </h2>
              <p className="muted">Which services, how long each takes, prices, days and hours. Keep it short and casual; whatever you leave out, the assistant fills in from what is usual in your field.</p>
            </div>
            <div className="field">
              <label htmlFor="about">
                Your description
              </label>
              <textarea id="about" className="input" rows={6} value={about} onChange={(e) => setAbout(e.target.value)} placeholder={EXAMPLES[biz.category] || "Describe the business…"} />
              {EXAMPLES[biz.category] && !about && (
                <button type="button" className="chip" style={{ alignSelf: "flex-start" }} onClick={() => setAbout(EXAMPLES[biz.category])}>
                  Use the example
                </button>
              )}
            </div>
            {busy && (
              <div className="ai-thinking" role="status">
                <div className="spinner" />
                <span className="writing">The assistant is writing your services and hours</span>
              </div>
            )}
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(0)}>
                Back
              </button>
              <div className="row">
                <button type="button" className="btn ghost" disabled={busy} onClick={() => { setAbout(""); generate(); }}>
                  Skip, use a template
                </button>
                <button type="button" className="btn ai lg" disabled={busy || !about.trim()} onClick={generate}>
                  Set it up for me
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
                {proposal.source === "ai" ? "Here is what the assistant wrote" : "A starting point for your field"}
              </h2>
              <p className="muted">You can edit all of it, now or any time later.</p>
              {proposal.notes && (
                <p className="by-ai small">{proposal.notes}</p>
              )}
            </div>

            <section className="proposal-section" aria-labelledby="svc-h">
              <div className="section-title">
                <h3 id="svc-h">Services</h3>
                {proposal.source === "ai" && <span className="ai-sign">Written by the assistant</span>}
              </div>
              {proposal.services.map((s, i) => (
                <div key={i} className="svc-row">
                  <input className={`input ${proposal.source === "ai" ? "by-ai" : ""}`} aria-label="Service name" required value={s.name} onChange={(e) => setSvc(i, { name: e.target.value })} />
                  <div className="input-group">
                    <input className="input num" aria-label="Duration in minutes" type="number" min={5} max={480} required value={s.duration} onChange={(e) => setSvc(i, { duration: Number(e.target.value) })} />
                    <span className="addon">min</span>
                  </div>
                  <div className="input-group">
                    <input className="input num" aria-label="Price" type="number" min={0} required value={s.price} onChange={(e) => setSvc(i, { price: Number(e.target.value) })} />
                    <span className="addon">₪</span>
                  </div>
                  <button
                    type="button"
                    className="btn ghost icon-only sm"
                    aria-label={`Remove ${s.name}`}
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
                Add a service
              </button>
            </section>

            <section className="proposal-section" aria-labelledby="hours-h">
              <h3 id="hours-h">Opening hours</h3>
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
                      aria-label={`Open on ${DAY_NAME[wd]}`}
                      onClick={() => setDay(wd, d ? null : { weekday: wd, start: "09:00", end: "18:00", breaks: [] })}
                    />
                    {d ? (
                      <div className="row wrap">
                        <input type="time" className="input num" aria-label="Opens at" value={d.start} onChange={(e) => setDay(wd, { ...d, start: e.target.value })} />
                        <span className="muted">to</span>
                        <input type="time" className="input num" aria-label="Closes at" value={d.end} onChange={(e) => setDay(wd, { ...d, end: e.target.value })} />
                        {d.breaks.map((b) => (
                          <span key={b.join()} className="chip">
                            Break {b[0]} to {b[1]}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="small muted">Closed</span>
                    )}
                  </div>
                );
              })}
            </section>

            <section className="proposal-section" aria-labelledby="look-h">
              <h3 id="look-h">How your page looks to clients</h3>
              <div className="field">
                <label htmlFor="pub-desc">Short description</label>
                <textarea id="pub-desc" className="input" rows={2} value={proposal.description} onChange={(e) => setProposal({ ...proposal, description: e.target.value })} />
              </div>
              <div className="row">
                <label htmlFor="color" className="label">
                  Brand colour
                </label>
                <input id="color" type="color" value={proposal.accent_color} onChange={(e) => setProposal({ ...proposal, accent_color: e.target.value })} />
              </div>
            </section>

            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn lg" disabled={proposal.days.length === 0}>
                Looks good, continue
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form className="stack loose" onSubmit={submit}>
            <h2 ref={heading} tabIndex={-1} className="step-title">
              Your account
            </h2>
            <div className="grid two">
              <div className="field">
                <label htmlFor="owner">Your name</label>
                <input id="owner" className="input" required minLength={2} autoComplete="name" value={account.owner_name} onChange={(e) => setAccount({ ...account, owner_name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
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
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" required minLength={8} autoComplete="new-password" value={account.password} onChange={(e) => setAccount({ ...account, password: e.target.value })} aria-describedby="pw-hint" />
              <span id="pw-hint" className="hint">
                At least 8 characters
              </span>
            </div>
            <div className="field">
              <label htmlFor="slug">Your booking link</label>
              <div className="input-group">
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
                {slugState === "ok" ? "Available" : slugState === "taken" ? "That link is taken" : slugState === "invalid" ? "Latin letters, digits and dashes, 3 to 40 characters" : "This is the link you send to clients"}
              </span>
            </div>
            {error && <div className="alert error" role="alert">{error}</div>}
            <div className="row between">
              <button type="button" className="btn ghost" onClick={() => setStep(2)}>
                Back
              </button>
              <button className="btn cta lg" disabled={busy || slugState === "taken" || slugState === "invalid"}>
                {busy ? "Opening your calendar…" : "Open my calendar"}
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
