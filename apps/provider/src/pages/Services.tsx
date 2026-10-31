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
    <div className="stack loose">
      <div className="page-head">
        <h1>Services</h1>
        {isOwner && (
          <button className="btn" onClick={() => setEdit({ ...EMPTY, provider_ids: [data.me.id] })}>
            New service
          </button>
        )}
      </div>
      <ol className="svc-list panel">
        {data.services.map((s) => (
          <li key={s.id} className={s.active ? "" : "off"}>
            <div className="svc-main">
              <b>{s.name}</b>
              {s.description && <span className="small muted">{s.description}</span>}
              <span className="small ink-2">
                {data.providers
                  .filter((p) => s.provider_ids.includes(p.id))
                  .map((p) => p.name)
                  .join(", ")}
              </span>
            </div>
            <div className="svc-meta small">
              <span className="num-sans">{duration(s.duration)}</span>
              {s.buffer_after > 0 && <span className="muted">+{s.buffer_after} min prep</span>}
              {s.capacity > 1 && <span className="muted">Up to {s.capacity} people</span>}
              {s.requires_confirmation && <span className="chip pending">Needs approval</span>}
              {!s.active && <span className="chip cancelled">Off</span>}
            </div>
            <b className="svc-price">{money(s.price)}</b>
            {isOwner && (
              <button className="btn link sm" onClick={() => setEdit(s)}>
                Edit
              </button>
            )}
          </li>
        ))}
      </ol>
      {edit && (
        <Editor
          value={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
            show("Service saved");
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
    <Modal title={s.id ? "Edit service" : "New service"} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div className="field">
          <label>Name</label>
          <input className="input" required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
        </div>
        <div className="field">
          <label>Description</label>
          <input className="input" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} />
        </div>
        <div className="grid two">
          <div className="field">
            <label>Duration (min)</label>
            <input type="number" className="input" min={5} value={s.duration} onChange={num("duration")} />
          </div>
          <div className="field">
            <label>Price (₪)</label>
            <input type="number" className="input" min={0} value={s.price} onChange={num("price")} />
          </div>
          <div className="field">
            <label>Prep before (min)</label>
            <input type="number" className="input" min={0} value={s.buffer_before} onChange={num("buffer_before")} />
          </div>
          <div className="field">
            <label>Cleanup after (min)</label>
            <input type="number" className="input" min={0} value={s.buffer_after} onChange={num("buffer_after")} />
          </div>
          <div className="field">
            <label>Minimum notice (min)</label>
            <input type="number" className="input" min={0} value={s.min_notice} onChange={num("min_notice")} />
          </div>
          <div className="field">
            <label>Bookable up to (days ahead)</label>
            <input type="number" className="input" min={1} value={s.max_days_ahead} onChange={num("max_days_ahead")} />
          </div>
          <div className="field">
            <label>People per slot</label>
            <input type="number" className="input" min={1} value={s.capacity} onChange={num("capacity")} />
          </div>
        </div>
        <label className="row small">
          <input type="checkbox" checked={s.requires_confirmation} onChange={(e) => setS({ ...s, requires_confirmation: e.target.checked })} /> Every booking needs my approval
        </label>
        <label className="row small">
          <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} /> Active and shown to clients
        </label>
        <div className="field">
          <label>Who offers it</label>
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
        <button className="btn block">Save</button>
      </form>
    </Modal>
  );
}
