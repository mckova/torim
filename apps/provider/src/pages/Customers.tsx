import { useEffect, useState } from "react";
import { Booking, STATUS_LABEL, dayLong, money, phoneDisplay, time } from "@torim/shared";
import { api } from "../api";
import { Modal } from "../components";

interface Row {
  id: number;
  name: string;
  phone: string;
  visits: number;
  no_shows: number;
  cancellations: number;
  spent: number;
  last_visit: string | null;
}

export default function Customers() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<{ name: string; phone: string; bookings: Booking[] } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => api.get<Row[]>("/api/pro/customers", { q }).then(setRows), 200);
    return () => clearTimeout(id);
  }, [q]);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>לקוחות</h1>
        <input className="input" style={{ maxWidth: 280 }} placeholder="חיפוש לפי שם או טלפון" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        {!rows ? (
          <div className="spinner" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>שם</th>
                <th>טלפון</th>
                <th>ביקורים</th>
                <th>לא הגיע</th>
                <th>ביטולים</th>
                <th>סה״כ</th>
                <th>ביקור אחרון</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: "pointer" }} onClick={() => api.get<NonNullable<typeof open>>(`/api/pro/customers/${r.id}`).then(setOpen)}>
                  <td>
                    <b>{r.name}</b>
                    {r.visits >= 5 && <span className="chip accent" style={{ marginInlineStart: 6 }}>קבוע</span>}
                    {r.no_shows >= 2 && <span className="chip no_show" style={{ marginInlineStart: 6 }}>סיכון</span>}
                  </td>
                  <td dir="ltr" style={{ textAlign: "end" }}>
                    {phoneDisplay(r.phone)}
                  </td>
                  <td>{r.visits}</td>
                  <td>{r.no_shows}</td>
                  <td>{r.cancellations}</td>
                  <td>{money(r.spent)}</td>
                  <td className="small muted">{r.last_visit ? dayLong(r.last_visit) : "עוד לא ביקר"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}>
          <span className="muted small" dir="ltr">
            {phoneDisplay(open.phone)}
          </span>
          <div className="stack tight">
            {open.bookings.map((b) => (
              <div key={b.id} className="row between" style={{ borderBottom: "1px solid #f3f4f6", padding: "0.4rem 0" }}>
                <div className="stack tight">
                  <b className="small">{b.service.name}</b>
                  <span className="tiny muted">
                    {dayLong(b.start)} {time(b.start)} · {b.provider.name}
                  </span>
                </div>
                <span className={`chip ${b.status}`}>{STATUS_LABEL[b.status]}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
