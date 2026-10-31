import { useEffect, useState } from "react";
import { addDays, dayShort, isoDate, money } from "@torim/shared";
import { api } from "../api";

interface Stats {
  bookings: number;
  by_status: Record<string, number>;
  revenue: number;
  expected_revenue: number;
  utilization: number;
  no_show_rate: number;
  cancel_rate: number;
  avg_lead_days: number | null;
  per_day: Record<string, number>;
  per_hour: Record<string, number>;
  top_services: [string, number][];
  per_provider: [string, number][];
  online_share: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function tips(s: Stats): string[] {
  const out: string[] = [];
  if (s.no_show_rate > 0.05) out.push(`${pct(s.no_show_rate)} of clients didn't show up. Add a second reminder an hour before, or take a deposit for long services.`);
  if (s.utilization < 0.6) out.push(`The calendar is ${pct(s.utilization)} full. There is room for a quiet-hours offer, or for shorter shifts.`);
  if (s.utilization > 0.85) out.push(`The calendar is almost full (${pct(s.utilization)}). Open more hours or add someone to the team before the waitlist grows.`);
  const hours = Object.entries(s.per_hour).sort((a, b) => b[1] - a[1]);
  if (hours.length > 2) out.push(`Busiest hours: ${hours.slice(0, 2).map(([h]) => `${h}:00`).join(", ")}. Quietest: ${hours.slice(-2).map(([h]) => `${h}:00`).join(", ")}.`);
  if (s.online_share > 0.6) out.push(`${pct(s.online_share)} of bookings were made online, without a phone call.`);
  return out;
}

export default function Insights() {
  const [range, setRange] = useState(30);
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    setS(null);
    api.get<Stats>("/api/pro/stats", { start: addDays(isoDate(), -range), end: isoDate() }).then(setS);
  }, [range]);

  if (!s) return <div className="spinner" />;
  const days = Object.entries(s.per_day);
  const maxDay = Math.max(1, ...days.map(([, v]) => v));
  const hours = Object.entries(s.per_hour);
  const maxHour = Math.max(1, ...hours.map(([, v]) => v));
  const maxSvc = Math.max(1, ...s.top_services.map(([, v]) => v));
  const maxProv = Math.max(1, ...s.per_provider.map(([, v]) => v));

  return (
    <div className="stack loose">
      <div className="page-head">
        <h1>Insights</h1>
        <div className="tabs">
          {[7, 30, 90].map((r) => (
            <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
              {r} days
            </button>
          ))}
        </div>
      </div>
      <dl className="kpi-line">
        <Kpi v={money(s.revenue)} l="Revenue, completed" />
        <Kpi v={String(s.bookings)} l="Bookings" />
        <Kpi v={pct(s.utilization)} l="Calendar filled" />
        <Kpi v={pct(s.no_show_rate)} l="No-shows" warn={s.no_show_rate > 0.05} />
        <Kpi v={pct(s.cancel_rate)} l="Cancellations" />
        <Kpi v={s.avg_lead_days != null ? `${s.avg_lead_days} days` : "No data"} l="Booked ahead" />
      </dl>
      {tips(s).length > 0 && (
        <section className="card stack tight">
          <h2>What the numbers say</h2>
          <ul className="plain-list">
            {tips(s).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="card stack">
        <h2>Bookings per day</h2>
        <div className="bar-chart">
          {days.map(([d, v]) => (
            <div key={d} className="bar" style={{ height: `${(v / maxDay) * 100}%` }} title={`${dayShort(d).weekday} ${dayShort(d).month} ${dayShort(d).day}: ${v}`} />
          ))}
        </div>
        <div className="row between tiny muted">
          <span>{days[0] && `${dayShort(days[0][0]).month} ${dayShort(days[0][0]).day}`}</span>
          <span>{days.length > 0 && `${dayShort(days[days.length - 1][0]).month} ${dayShort(days[days.length - 1][0]).day}`}</span>
        </div>
      </div>
      <div className="grid two">
        <div className="card stack">
          <h2>By hour of day</h2>
          <div className="bar-chart" style={{ height: 100 }}>
            {hours.map(([h, v]) => (
              <div key={h} className="bar" style={{ height: `${(v / maxHour) * 100}%` }} title={`${h}:00, ${v}`} />
            ))}
          </div>
          <div className="row between tiny muted">
            <span>{hours[0]?.[0]}:00</span>
            <span>{hours[hours.length - 1]?.[0]}:00</span>
          </div>
        </div>
        <div className="card stack tight">
          <h2>Top services</h2>
          {s.top_services.map(([n, v]) => (
            <div key={n} className="hbar">
              <span>{n}</span>
              <div className="track">
                <div className="fill" style={{ width: `${(v / maxSvc) * 100}%` }} />
              </div>
              <b>{v}</b>
            </div>
          ))}
          <h2 style={{ marginTop: "0.75rem" }}>By team member</h2>
          {s.per_provider.map(([n, v]) => (
            <div key={n} className="hbar">
              <span>{n}</span>
              <div className="track">
                <div className="fill" style={{ width: `${(v / maxProv) * 100}%` }} />
              </div>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ v, l, warn }: { v: string; l: string; warn?: boolean }) {
  return (
    <div className="kpi">
      <dt>{l}</dt>
      <dd style={{ color: warn ? "var(--redpen)" : undefined }}>{v}</dd>
    </div>
  );
}
