import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { translateError } from "@torim/shared";
import { api } from "../api";
import "../landing.css";

/* The page for business owners is the product itself, running one sample day.
   Scrolling advances the day's clock; the book, the WhatsApp thread and the
   assistant's margin note all derive from the same list of moments. With
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
  { t: "09:00", name: "משה ביטון", svc: "תספורת גבר", from: 0 },
  { t: "09:30", name: "רון אלמוג", svc: "תספורת וזקן", from: 0 },
  { t: "10:30", name: "גיל שרעבי", svc: "תספורת ילד", from: 0 },
  { t: "11:30", name: "תומר אזולאי", svc: "תספורת גבר", from: 0 },
  { t: "13:00", name: "יוסי כהן", svc: "תספורת וזקן", from: 0, struck: 2 },
  {
    t: "13:00",
    name: "אבי מזרחי",
    svc: "תספורת וזקן",
    from: 3,
    tag: "הזמין מרשימת ההמתנה",
  },
  { t: "16:00", name: "עומר דהן", svc: "תספורת גבר", from: 0, risk: 4 },
  {
    t: "17:30",
    name: "דנה לוי",
    svc: "תספורת קצרה",
    from: 1,
    ai: "נקבע בוואטסאפ",
  },
  { t: "18:30", name: "איתי פרץ", svc: "גילוח בתער", from: 0 },
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
    caption: "המספרה נפתחת. שבעה תורים ביומן, כולם נרשמו אתמול.",
  },
  {
    clock: "09:12",
    caption:
      "לקוחה כותבת בוואטסאפ. העוזר בודק מה פנוי, מציע שעה ורושם אותה ביומן.",
    who: "דנה לוי",
    thread: [
      { text: "היי, יש משהו היום אחרי 5? רק לקצר" },
      { me: true, text: "יש 17:30 אצל נועם, 45 דקות, 90 ש״ח. לרשום אותך?" },
      { text: "כן תודה" },
      { me: true, text: "רשמתי. תזכורת תגיע שעתיים לפני." },
    ],
  },
  {
    clock: "11:05",
    caption:
      "ביטול. השורה נמחקת בקו אדום, כמו ביומן נייר, והשעה חוזרת להיות פנויה.",
    who: "יוסי כהן",
    thread: [
      { text: "אחי לא אגיע ב-1, נפל עליי משהו בעבודה" },
      { me: true, text: "ביטלתי, תודה שעדכנת. לקבוע לך ליום אחר השבוע?" },
    ],
    note: "13:00 התפנה. שלחתי הודעה לשני הממתינים להיום.",
  },
  {
    clock: "11:09",
    caption:
      "מי שחיכה לשעה הזאת קיבל הודעה עם קישור. הראשון שמזמין מקבל את התור.",
    who: "אבי מזרחי",
    thread: [
      {
        me: true,
        text: "שלום אבי, התפנה היום מקום ב-13:00 לתספורת וזקן. מי שמזמין ראשון מקבל: torim.app/b/noam",
      },
      { text: "הזמנתי, תודה!" },
    ],
  },
  {
    clock: "14:30",
    caption:
      "לקוח שלא הגיע פעמיים מתוך ארבעה תורים. העוזר מנסח לו תזכורת אישית, ונועם שולח בלחיצה.",
    who: "עומר דהן",
    thread: [
      {
        me: true,
        text: "עומר, מחכים לך היום ב-16:00. אם משהו השתנה, אפשר להזיז כאן בלחיצה.",
      },
      { text: "אגיע, תודה שהזכרת" },
    ],
    note: "עומר לא הגיע ל-2 מתוך 4 התורים האחרונים. ניסחתי לו תזכורת אישית, מחכה לאישור שלך.",
  },
  {
    clock: "19:40",
    caption: "סוף היום. נועם פתח את היומן פעם אחת, כדי לאשר תזכורת.",
    note: "היום: 2 תורים חדשים, ביטול אחד שהתמלא תוך 4 דקות, תזכורת אישית אחת שאישרת. מחר 6 תורים, הראשון ב-09:30.",
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
    <div className="lp-book" aria-label="יומן התורים של יום ההדגמה">
      <div className="lp-book-head">
        <span>
          <b>המספרה של נועם</b> · יום שלישי
        </span>
        <span className="lp-demo">יום הדגמה, השמות בדויים</span>
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
                  {r.ai && <span className="by-ai"> · {r.ai}</span>}
                  {r.tag && <span className="muted"> · {r.tag}</span>}
                </span>
              </span>
              <span className="side">
                {struck && <span className="lp-cancel">בוטל</span>}
                {risky && <span className="risk high">50% אי-הגעה</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Thread({ m }: { m: Moment }) {
  if (!m.thread) return <div className="lp-thread quiet">אין הודעות חדשות</div>;
  return (
    <div className="lp-thread" key={m.clock}>
      <div className="lp-thread-head">
        וואטסאפ · <b>{m.who}</b>
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
          יום אחד במספרה, מ-08:40 עד 19:40
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
            יום אחד במספרה
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
              <span className="ai-sign">הערת העוזר</span>
              {note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const CATS = [
  { id: "barber", label: "מספרה" },
  { id: "beauty", label: "קוסמטיקה וציפורניים" },
  { id: "clinic", label: "קליניקה" },
  { id: "fitness", label: "סטודיו" },
  { id: "other", label: "אחר" },
];
const DAY = ["שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת", "ראשון"];

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
          ספרו על העסק במשפט או שניים.
        </h2>
        <p>
          העוזר יכתוב לכם רשימת שירותים, מחירים ושעות פעילות. זה לא נשמר עד
          שתאשרו, ואפשר לשנות כל שורה.
        </p>
      </div>
      {!proposal ? (
        <form className="lp-form" onSubmit={write}>
          <div className="field">
            <label htmlFor="lp-name">שם העסק</label>
            <input
              id="lp-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="המספרה של נועם"
              required
              minLength={2}
            />
          </div>
          <fieldset className="field">
            <legend className="label">סוג העסק</legend>
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
            <label htmlFor="lp-about">מה אתם עושים, ומתי</label>
            <textarea
              id="lp-about"
              className="input"
              rows={4}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="ספר בפלורנטין, עובד לבד. תספורת 80 ש״ח, עם זקן 110. א׳ עד ה׳ 10:00 עד 20:00, שישי עד 14:00."
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
              {busy ? "העוזר כותב…" : "לכתוב לי הצעה"}
            </button>
          </div>
        </form>
      ) : (
        <div className="lp-proposal" aria-live="polite">
          <div className="lp-proposal-head">
            <b>{name}</b>
            <span className="ai-sign">
              {proposal.source === "ai" ? "נכתב ע״י העוזר" : "הצעה מתבנית"}
            </span>
          </div>
          {proposal.description && (
            <p className="by-ai">{proposal.description}</p>
          )}
          <ol className="lp-svc">
            {proposal.services.map((s) => (
              <li key={s.name}>
                <span>{s.name}</span>
                <span className="num">{s.duration} דק׳</span>
                <span className="num">{s.price} ש״ח</span>
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
            <a href={SIGNUP} className="btn lg" onClick={keep}>
              לפתוח יומן עם ההצעה
            </a>
            <button className="btn link" onClick={() => setProposal(null)}>
              לשנות את התיאור
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
          TORIM
        </Link>
        <nav className="row">
          <a href="/pro/" className="btn link">
            כניסה ליומן
          </a>
          <a href="#setup" className="btn sm">
            לפתוח יומן
          </a>
        </nav>
      </header>

      <main>
        <section className="lp-open">
          <h1>
            העוזר עונה ללקוחות בוואטסאפ
            <br />
            ורושם את התור ביומן שלך.
          </h1>
          <div className="lp-open-side">
            <p>
              TORIM הוא יומן תורים למספרות, קליניקות וסטודיו. מה שהעוזר כותב
              ביומן מופיע <span className="by-ai">בכחול</span>, כך שתמיד רואים
              מה הוא עשה ומה אתם.
            </p>
            <p className="small muted">
              גללו כדי לעבור על יום עבודה אחד, מהבוקר עד הערב.
            </p>
          </div>
        </section>

        <LiveDay />

        <section className="lp-limits" aria-labelledby="lim-h">
          <h2 id="lim-h" className="lp-h2">
            מה העוזר לא עושה בלי לשאול
          </h2>
          <ol>
            <li>
              <span>
                <b>לא מבטל תור מיוזמתו.</b> רק כשהלקוח מבקש, או כשאתם מבקשים.
              </span>
            </li>
            <li>
              <span>
                <b>לא משנה מחירים ושעות.</b> הוא מציע, אתם מאשרים בלחיצה.
              </span>
            </li>
            <li>
              <span>
                <b>לא שולח הודעה אישית בלי שראיתם.</b> אישורים ותזכורות רגילים
                יוצאים לבד, הודעה שהוא ניסח מחכה לכם.
              </span>
            </li>
            <li>
              <span>
                <b>לא ממציא זמינות.</b> הוא קורא רק מהיומן, וכל תור שהוא רושם
                נבדק מול השעות שהגדרתם.
              </span>
            </li>
          </ol>
        </section>

        <Setup />
      </main>

      <footer className="lp-foot">
        <span>TORIM</span>
        <span>השמות, השעות וההודעות בדף הזה הם דוגמה ולא לקוחות אמיתיים.</span>
        <Link to="/">לקביעת תור כלקוח</Link>
      </footer>
    </div>
  );
}
