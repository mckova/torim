import { useEffect, useState } from "react";
import { Provider } from "@torim/shared";
import { api, useMe } from "../api";
import { ErrorText, Modal, useToast } from "../components";

interface StaffRow extends Provider {
  email: string;
  weekdays: number[];
}
type StaffForm = { id?: number; name: string; title: string; email: string; password: string; color: string; service_ids: number[]; active: boolean; copy_hours: boolean };

const DAY_SHORT = ["ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳", "א׳"];
const ORDER = [6, 0, 1, 2, 3, 4, 5];

export default function Settings() {
  const { data, reload } = useMe();
  const b = data.business;
  const [form, setForm] = useState({
    name: b.name,
    description: b.description,
    address: b.address,
    phone: b.phone,
    accent_color: b.accent_color,
    cancel_window_hours: b.cancel_window_hours,
    slot_step: b.slot_step ?? 15,
  });
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [edit, setEdit] = useState<StaffForm | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [toast, show] = useToast();
  const publicUrl = `${window.location.origin}/b/${b.slug}`;

  const loadStaff = () => api.get<StaffRow[]>("/api/pro/staff").then(setStaff);
  useEffect(() => {
    loadStaff();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.put("/api/pro/business", form);
      reload();
      show("פרטי העסק נשמרו");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack loose">
      <div className="page-head">
        <div>
          <h1>העסק והצוות</h1>
          <span className="small muted">איך העסק נראה ללקוחות, ומי עובד בו.</span>
        </div>
      </div>

      <section className="card stack" aria-labelledby="share-h">
        <h2 id="share-h">הקישור להזמנת תורים</h2>
        <div className="input-group" dir="ltr">
          <input className="input" readOnly value={publicUrl} aria-label="קישור לדף ההזמנות" onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn soft sm"
            style={{ borderRadius: 0 }}
            onClick={() => navigator.clipboard?.writeText(publicUrl).then(() => show("הקישור הועתק"))}
          >
            העתקה
          </button>
        </div>
        <span className="hint small muted">שימו בביו באינסטגרם, בסטטוס בוואטסאפ ובגוגל. העוזר עונה ללקוחות שמגיעים משם בכל שעה.</span>
      </section>

      <form className="card stack" onSubmit={save} aria-labelledby="biz-h">
        <h2 id="biz-h">פרטי העסק</h2>
        <div className="grid two">
          <div className="field">
            <label htmlFor="s-name">שם</label>
            <input id="s-name" className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="s-phone">טלפון</label>
            <input id="s-phone" className="input" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="s-addr">כתובת</label>
          <input id="s-addr" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="s-desc">תיאור לדף ההזמנות</label>
          <textarea id="s-desc" className="input" rows={2} maxLength={400} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="s-cancel">אפשר לבטל עד</label>
            <div className="input-group">
              <input id="s-cancel" className="input num" type="number" min={0} max={168} value={form.cancel_window_hours} onChange={(e) => setForm({ ...form, cancel_window_hours: Number(e.target.value) })} />
              <span className="addon">שעות לפני</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-step">מרווח בין שעות מוצעות</label>
            <select id="s-step" className="input" value={form.slot_step} onChange={(e) => setForm({ ...form, slot_step: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  כל {m} דקות
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <label htmlFor="s-color" className="label">
            צבע המותג
          </label>
          <input id="s-color" type="color" value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} />
        </div>
        <ErrorText error={error} />
        <button className="btn" style={{ alignSelf: "flex-start" }}>
          שמירה
        </button>
      </form>

      <section className="stack" aria-labelledby="team-h">
        <div className="section-title">
          <h2 id="team-h">הצוות</h2>
          <button
            className="btn sm"
            onClick={() => setEdit({ name: "", title: "", email: "", password: "", color: "", service_ids: data.services.map((s) => s.id), active: true, copy_hours: true })}
          >
            הוספת איש צוות
          </button>
        </div>
        {!staff ? (
          <div className="stack tight" aria-hidden>
            <div className="skeleton" style={{ height: 64 }} />
            <div className="skeleton" style={{ height: 64 }} />
          </div>
        ) : (
          <div className="grid two">
            {staff.map((p) => (
              <div key={p.id} className="card row" style={{ opacity: p.active ? 1 : 0.55, alignItems: "flex-start" }}>
                <div className="avatar sm" style={{ background: p.color }} aria-hidden>
                  {p.name.slice(0, 1)}
                </div>
                <div className="grow stack tight">
                  <div className="row wrap">
                    <b>{p.name}</b>
                    {p.role === "owner" && <span className="chip accent">בעלים</span>}
                    {!p.active && <span className="chip cancelled">מושבת</span>}
                  </div>
                  <span className="small muted">{p.title || p.email}</span>
                  <div className="row" aria-label="ימי עבודה">
                    {ORDER.map((d) => (
                      <span key={d} className="tiny" style={{ color: p.weekdays.includes(d) ? "var(--ink)" : "#cbd5e1", fontWeight: 600 }}>
                        {DAY_SHORT[d]}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="btn ghost sm"
                  onClick={() => setEdit({ id: p.id, name: p.name, title: p.title, email: p.email, password: "", color: p.color, service_ids: p.service_ids, active: p.active, copy_hours: false })}
                >
                  עריכה
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {edit && (
        <StaffModal
          value={edit}
          isOwnerRow={staff?.find((s) => s.id === edit.id)?.role === "owner"}
          onClose={() => setEdit(null)}
          onSaved={(msg) => {
            setEdit(null);
            loadStaff();
            reload();
            show(msg);
          }}
        />
      )}
      {toast}
    </div>
  );
}

function StaffModal({ value, isOwnerRow, onClose, onSaved }: { value: StaffForm; isOwnerRow: boolean; onClose: () => void; onSaved: (msg: string) => void }) {
  const { data } = useMe();
  const [f, setF] = useState(value);
  const [error, setError] = useState<unknown>(null);
  const isNew = !f.id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...f, password: f.password || null };
      if (isNew) await api.post("/api/pro/staff", body);
      else await api.put(`/api/pro/staff/${f.id}`, body);
      onSaved(isNew ? `${f.name} נוסף/ה לצוות. אפשר להתחבר עם האימייל והסיסמה.` : "נשמר");
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={isNew ? "איש צוות חדש" : f.name} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="grid two">
          <div className="field">
            <label htmlFor="st-name">שם</label>
            <input id="st-name" className="input" required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-title">תפקיד</label>
            <input id="st-title" className="input" placeholder="למשל: ספרית" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
        </div>
        <div className="grid two">
          <div className="field">
            <label htmlFor="st-email">אימייל לכניסה</label>
            <input id="st-email" className="input" dir="ltr" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="st-pw">{isNew ? "סיסמה" : "סיסמה חדשה (לא חובה)"}</label>
            <input id="st-pw" className="input" dir="ltr" type="password" minLength={8} required={isNew} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: "0.4rem" }}>
            שירותים שהוא/היא נותנים
          </legend>
          <div className="row wrap">
            {data.services.map((s) => {
              const on = f.service_ids.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  className={`chip ${on ? "accent" : ""}`}
                  aria-pressed={on}
                  onClick={() => setF({ ...f, service_ids: on ? f.service_ids.filter((x) => x !== s.id) : [...f.service_ids, s.id] })}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        {isNew ? (
          <label className="row small">
            <input type="checkbox" checked={f.copy_hours} onChange={(e) => setF({ ...f, copy_hours: e.target.checked })} /> להעתיק את שעות העבודה שלי (אפשר לשנות אחר כך במסך שעות עבודה)
          </label>
        ) : (
          !isOwnerRow && (
            <label className="row small">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> פעיל/ה (מי שמושבת לא מופיע ללקוחות ולא יכול להתחבר)
            </label>
          )
        )}
        <div className="row">
          <label htmlFor="st-color" className="label">
            צבע ביומן
          </label>
          <input id="st-color" type="color" value={f.color || "#0f766e"} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </div>
        <ErrorText error={error} />
        <button className="btn block">{isNew ? "הוספה לצוות" : "שמירה"}</button>
      </form>
    </Modal>
  );
}
