import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { translateError } from "@torim/shared";
import { api } from "../api";
import "../landing.css";

/* The page for business owners is the product itself, running one sample day.
   Scrolling advances the day's clock; the day list, the WhatsApp thread and the
   assistant's note all derive from the same list of moments. With
   reduced motion the day is shown finished, with every moment listed. */

const SIGNUP = "/pro/signup";

interface Row {
  t: string;
  name: string;
  svc: string;
  from: number;
  struck?: number;
  ai?: string;
  tag?: string;
  risk?: number;
}

const ROWS: Row[] = [
  { t: "09:00", name: "Moshe Biton", svc: "Men's haircut", from: 0 },
  { t: "09:30", name: "Ron Almog", svc: "Cut and beard", from: 0 },
  { t: "10:30", name: "Gil Sharabi", svc: "Kids' cut", from: 0 },
  { t: "11:30", name: "Tomer Azulay", svc: "Men's haircut", from: 0 },
  { t: "13:00", name: "Yossi Cohen", svc: "Cut and beard", from: 0, struck: 2 },
  {
    t: "13:00",
    name: "Avi Mizrahi",
    svc: "Cut and beard",
    from: 3,
    tag: "from the waitlist",
  },
  { t: "16:00", name: "Omer Dahan", svc: "Men's haircut", from: 0, risk: 4 },
  {
    t: "17:30",
    name: "Dana Levi",
    svc: "Short trim",
    from: 1,
    ai: "AI booked",
  },
  { t: "18:30", name: "Itay Peretz", svc: "Razor shave", from: 0 },
];

interface Msg {
  me?: boolean;
  text: string;
}
interface Moment {
  clock: string;
  caption: string;
  who?: string;
  thread?: Msg[];
  note?: string;
}

const MOMENTS: Moment[] = [
  {
    clock: "08:40",
    caption: "The shop opens. Seven bookings on the calendar, all made yesterday.",
  },
  {
    clock: "09:12",
    caption:
      "A client writes on WhatsApp. The assistant checks what's free, offers a time and books it.",
    who: "Dana Levi",
    thread: [
      { text: "Hi, anything today after 5? Just a trim" },
      { me: true, text: "Noam has 17:30, 45 min, ₪90. Shall I book you?" },
      { text: "Yes please" },
      { me: true, text: "Done. You'll get a reminder two hours before." },
    ],
  },
  {
    clock: "11:05",
    caption:
      "A cancellation. The booking is struck through and the hour opens up again.",
    who: "Yossi Cohen",
    thread: [
      { text: "Can't make it at 1, something came up at work" },
      { me: true, text: "Cancelled, thanks for letting us know. Want another day this week?" },
    ],
    note: "13:00 is free now. I messaged the two people waiting for today.",
  },
  {
    clock: "11:09",
    caption:
      "Everyone waiting for that hour got a link. The first to book gets it.",
    who: "Avi Mizrahi",
    thread: [
      {
        me: true,
        text: "Hi Avi, a 13:00 cut and beard just opened up today. First to book gets it: torim.app/b/noam",
      },
      { text: "Booked, thanks!" },
    ],
  },
  {
    clock: "14:30",
    caption:
      "A client who missed two of his last four bookings. The assistant drafts a personal reminder, and Noam sends it with one tap.",
    who: "Omer Dahan",
    thread: [
      {
        me: true,
        text: "Omer, see you today at 16:00. If anything changed, you can move it here in one tap.",
      },
      { text: "I'll be there, thanks for the reminder" },
    ],
    note: "Omer missed 2 of his last 4 bookings. I drafted him a personal reminder. It's waiting for your OK.",
  },
  {
    clock: "19:40",
    caption: "End of the day. Noam opened the calendar once, to approve a reminder.",
    note: "Today: 2 new bookings, one cancellation refilled in 4 minutes, one personal reminder you approved. Tomorrow has 6 bookings, the first at 09:30.",
  },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** Index of the current moment, driven by how far the pinned section has scrolled. */
function useScrollStep(
  ref: React.RefObject<HTMLElement>,
  count: number,
  disabled: boolean,
) {
  const [step, setStep] = useState(disabled ? count - 1 : 0);
  useEffect(() => {
    if (disabled) return setStep(count - 1);
    let raf = 0;
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = Math.min(0.999, Math.max(0, -r.top / Math.max(1, span)));
      setStep(Math.floor(p * count));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [ref, count, disabled]);
  return step;
}

function Book({ step }: { step: number }) {
  return (
    <div className="lp-book" aria-label="Sample day calendar">
      <div className="lp-book-head">
        <span>
          <b>Noam Barbers</b> · Tuesday
        </span>
        <span className="lp-demo">Sample day, names are made up</span>
      </div>
      <ol className="lp-rows">
        {ROWS.filter((r) => r.from <= step).map((r) => {
          const struck = r.struck !== undefined && r.struck <= step;
          const risky = r.risk !== undefined && r.risk <= step;
          return (
            <li
              key={r.name}
              className={`lp-row ${r.ai ? "ai" : ""} ${struck ? "struck" : ""}`}
            >
              <span className="t">{r.t}</span>
              <span className="who">
                <b>{r.name}</b>
                <span>
                  {r.svc}
                                    {r.tag && <span className="muted"> · {r.tag}</span>}
                </span>
              </span>
              <span className="side">
                {r.ai && <span className="ai-sign">{r.ai}</span>}
                {struck && <span className="lp-cancel">Cancelled</span>}
                {risky && <span className="risk high">50% no-show</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Thread({ m }: { m: Moment }) {
  if (!m.thread) return <div className="lp-thread quiet">No new messages</div>;
  return (
    <div className="lp-thread" key={m.clock}>
      <div className="lp-thread-head">
        WhatsApp · <b>{m.who}</b>
      </div>
      {m.thread.map((x, i) => (
        <p
          key={i}
          className={`lp-msg ${x.me ? "me" : ""}`}
          style={{ transitionDelay: `${i * 420}ms` }}
        >
          {x.text}
        </p>
      ))}
    </div>
  );
}

function LiveDay() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const step = useScrollStep(ref, MOMENTS.length, reduced);
  const m = MOMENTS[step];
  const note = [...MOMENTS.slice(0, step + 1)]
    .reverse()
    .find((x) => x.note)?.note;

  if (reduced) {
    return (
      <section className="lp-day static" aria-labelledby="day-h">
        <h2 id="day-h" className="lp-h2">
          One day at the barbershop, 08:40 to 19:40
        </h2>
        <ol className="lp-moments">
          {MOMENTS.map((x) => (
            <li key={x.clock}>
              <span className="lp-clock">{x.clock}</span> {x.caption}
            </li>
          ))}
        </ol>
        <Book step={MOMENTS.length - 1} />
        {note && <p className="lp-note">{note}</p>}
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className="lp-day"
      style={{ height: `${MOMENTS.length * 90 + 60}vh` }}
      aria-labelledby="day-h"
    >
      <div className="lp-pin">
        <div className="lp-caption">
          <h2 id="day-h" className="sr-only">
            One day at the barbershop
          </h2>
          <div className="lp-clock" aria-hidden>
            {m.clock}
          </div>
          <p key={m.clock} className="lp-caption-text" aria-live="polite">
            {m.caption}
          </p>
          <div className="lp-progress" aria-hidden>
            {MOMENTS.map((x, i) => (
              <span key={x.clock} className={i <= step ? "on" : ""} />
            ))}
          </div>
        </div>
        <Book step={step} />
        <div className="lp-side">
          <Thread m={m} />
          {note && (
            <p key={note} className="lp-note">
              <span className="ai-sign">Assistant</span>
              {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const CATS = [
  { id: "barber", label: "Barbershop" },
  { id: "beauty", label: "Beauty and nails" },
  { id: "clinic", label: "Clinic" },
  { id: "fitness", label: "Studio" },
  { id: "other", label: "Other" },
];
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Proposal {
  source: "ai" | "template";
  description: string;
  accent_color: string;
  services: { name: string; duration: number; price: number }[];
  days: { weekday: number; start: string; end: string }[];
  notes: string;
}

function Setup() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("barber");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

  async function write(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setProposal(
        await api.post<Proposal>("/api/pro/setup/suggest", {
          name,
          category,
          description: about,
        }),
      );
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  function keep() {
    sessionStorage.setItem(
      "torim.setup",
      JSON.stringify({ name, category, about, proposal }),
    );
  }

  return (
    <section className="lp-setup" id="setup" aria-labelledby="setup-h">
      <div className="lp-setup-intro">
        <h2 id="setup-h" className="lp-h2">
          Describe your business in a sentence or two.
        </h2>
        <p>
          The assistant drafts your services, prices and opening hours. Nothing is
          saved until you approve it, and every line can be changed.
        </p>
      </div>
      {!proposal ? (
        <form className="lp-form" onSubmit={write}>
          <div className="field">
            <label htmlFor="lp-name">Business name</label>
            <input
              id="lp-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Noam Barbers"
              required
              minLength={2}
            />
          </div>
          <fieldset className="field">
            <legend className="label">Type of business</legend>
            <div className="row wrap">
              {CATS.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="chip"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="lp-about">What you do, and when</label>
            <textarea
              id="lp-about"
              className="input"
              rows={4}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Barber in Florentin, working solo. Haircut ₪80, with beard ₪110. Sun to Thu 10:00 to 20:00, Fri until 14:00."
            />
          </div>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              className="btn ai lg"
              disabled={busy || name.trim().length < 2}
            >
              {busy ? "Drafting…" : "Draft my setup"}
            </button>
          </div>
        </form>
      ) : (
        <div className="lp-proposal" aria-live="polite">
          <div className="lp-proposal-head">
            <b>{name}</b>
            <span className="ai-sign">
              {proposal.source === "ai" ? "Drafted by the assistant" : "From a template"}
            </span>
          </div>
          {proposal.description && (
            <p className="by-ai">{proposal.description}</p>
          )}
          <ol className="lp-svc">
            {proposal.services.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <span className="num">{s.duration} min</span>
                <span className="num">₪{s.price}</span>
              </li>
            ))}
          </ol>
          <p className="lp-hours">
            {proposal.days
              .map((d) => `${DAY[d.weekday]} ${d.start}-${d.end}`)
              .join(" · ")}
          </p>
          {proposal.notes && <p className="small ink-2">{proposal.notes}</p>}
          <div className="row wrap">
            <a href={SIGNUP} className="btn cta lg" onClick={keep}>
              Open my calendar with this
            </a>
            <button className="btn link" onClick={() => setProposal(null)}>
              Change the description
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-top">
        <Link to="/" className="lp-mark">
          <span className="brand-mark" aria-hidden>t</span>torim
        </Link>
        <nav className="row">
          <a href="/pro/" className="btn ghost sm">
            Sign in
          </a>
          <a href="#setup" className="btn cta sm">
            Get started
          </a>
        </nav>
      </header>

      <main>
        <section className="lp-open">
          <h1>
            The assistant answers your clients on WhatsApp
            <br />
            and books them into your calendar.
          </h1>
          <div className="lp-open-side">
            <p>
              TORIM is a booking calendar for barbershops, clinics and studios.
              Everything the assistant books carries an <span className="ai-sign">AI booked</span>{" "}
              tag, so you always see what it did and what you did.
            </p>
            <p className="small muted">
              Scroll to live through one working day, morning to evening.
            </p>
          </div>
        </section>

        <LiveDay />

        <section className="lp-limits" aria-labelledby="lim-h">
          <h2 id="lim-h" className="lp-h2">
            What the assistant never does without asking
          </h2>
          <ol>
            <li>
              <span>
                <b>It never cancels on its own.</b> Only when the client asks, or you do.
              </span>
            </li>
            <li>
              <span>
                <b>It never changes prices or hours.</b> It suggests, you approve with a tap.
              </span>
            </li>
            <li>
              <span>
                <b>It never sends a personal message you haven't seen.</b> Routine
                confirmations and reminders go out alone; anything it wrote waits for you.
              </span>
            </li>
            <li>
              <span>
                <b>It never invents availability.</b> It reads only from the calendar,
                and every booking it makes is checked against your hours.
              </span>
            </li>
          </ol>
        </section>

        <Setup />
      </main>

      <footer className="lp-foot">
        <span>torim</span>
        <span>The names, times and messages on this page are examples, not real clients.</span>
        <Link to="/">Book as a client</Link>
      </footer>
    </div>
  );
}
