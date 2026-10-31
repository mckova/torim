import { useState } from "react";
import { Service, duration, money } from "@torim/shared";
import { api, useMe } from "../api";
import { ErrorText, Modal, useToast } from "../components";

const EMPTY: Omit<Service, "id"> = {
  name: "",
  description: "",
  duration: 30,
  price: 0,
  buffer_before: 0,
  buffer_after: 0,
  min_notice: 60,
  max_days_ahead: 30,
  capacity: 1,
  requires_confirmation: false,
  active: true,
  provider_ids: [],
};

export default function Services() {
  const { data, reload } = useMe();
  const isOwner = data.me.role === "owner";
  const [edit, setEdit] = useState<(Omit<Service, "id"> & { id?: number }) | null>(null);
  const [toast, show] = useToast();

  return (
    <div className="stack">
      <div className="page-head">
        <h1>שירותים</h1>
        {isOwner && (
          <button className="btn" onClick={() => setEdit({ ...EMPTY, provider_ids: [data.me.id] })}>
            + שירות חדש
          </button>
        )}
      </div>
      <div className="grid two">
        {data.services.map((s) => (
          <div key={s.id} className="card stack tight" style={{ opacity: s.active ? 1 : 0.5 }}>
            <div className="row between">
              <h3>{s.name}</h3>
              <b>{money(s.price)}</b>
            </div>
            <span className="small muted">{s.description}</span>
            <div className="row wrap">
              <span className="chip">{duration(s.duration)}</span>
              {s.buffer_after > 0 && <span className="chip">+{s.buffer_after} דק׳ הכנה</span>}
              {s.capacity > 1 && <span className="chip accent">קבוצה · {s.capacity}</span>}
              {s.requires_confirmation && <span className="chip pending">דורש אישור</span>}
              {!s.active && <span className="chip cancelled">מושבת</span>}
            </div>
            <div className="row">
              {data.providers
                .filter((p) => s.provider_ids.includes(p.id))
                .map((p) => (
                  <span key={p.id} className="tiny row" style={{ gap: 4 }}>
                    <span className="dot" style={{ background: p.color }} />
                    {p.name}
                  </span>
                ))}
            </div>
            {isOwner && (
              <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setEdit(s)}>
                עריכה
              </button>
            )}
          </div>
        ))}
      </div>
      {edit && (
        <Editor
          value={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
            show("השירות נשמר");
          }}
        />
      )}
      {toast}
    </div>
  );
}

function Editor({ value, onClose, onSaved }: { value: Omit<Service, "id"> & { id?: number }; onClose: () => void; onSaved: () => void }) {
  const { data } = useMe();
  const [s, setS] = useState(value);
  const [error, setError] = useState<unknown>(null);
  const num = (k: keyof Service) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (s.id) await api.put(`/api/pro/services/${s.id}`, s);
      else await api.post("/api/pro/services", s);
      onSaved();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={s.id ? "עריכת שירות" : "שירות חדש"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field">
          <label>שם</label>
          <input className="input" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </div>
        <div className="field">
          <label>תיאור</label>
          <input className="input" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
        </div>
        <div className="grid two">
          <div className="field">
            <label>משך (דקות)</label>
            <input type="number" className="input" min={5} value={s.duration} onChange={num("duration")} />
          </div>
          <div className="field">
            <label>מחיר (₪)</label>
            <input type="number" className="input" min={0} value={s.price} onChange={num("price")} />
          </div>
          <div className="field">
            <label>זמן הכנה לפני (דק׳)</label>
            <input type="number" className="input" min={0} value={s.buffer_before} onChange={num("buffer_before")} />
          </div>
          <div className="field">
            <label>זמן ניקיון אחרי (דק׳)</label>
            <input type="number" className="input" min={0} value={s.buffer_after} onChange={num("buffer_after")} />
          </div>
          <div className="field">
            <label>התראה מינימלית (דק׳)</label>
            <input type="number" className="input" min={0} value={s.min_notice} onChange={num("min_notice")} />
          </div>
          <div className="field">
            <label>אפשר להזמין עד (ימים קדימה)</label>
            <input type="number" className="input" min={1} value={s.max_days_ahead} onChange={num("max_days_ahead")} />
          </div>
          <div className="field">
            <label>משתתפים בכל מועד</label>
            <input type="number" className="input" min={1} value={s.capacity} onChange={num("capacity")} />
          </div>
        </div>
        <label className="row small">
          <input type="checkbox" checked={s.requires_confirmation} onChange={(e) => setS({ ...s, requires_confirmation: e.target.checked })} /> כל הזמנה דורשת אישור ידני
        </label>
        <label className="row small">
          <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} /> פעיל ומוצג ללקוחות
        </label>
        <div className="field">
          <label>מי נותן את השירות</label>
          <div className="row wrap">
            {data.providers.map((p) => (
              <label key={p.id} className="chip" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={s.provider_ids.includes(p.id)}
                  onChange={(e) =>
                    setS({ ...s, provider_ids: e.target.checked ? [...s.provider_ids, p.id] : s.provider_ids.filter((x) => x !== p.id) })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
        <ErrorText error={error} />
        <button className="btn block">שמירה</button>
      </form>
    </Modal>
  );
}
