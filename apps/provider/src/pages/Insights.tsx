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
  if (s.no_show_rate > 0.05) out.push(`שיעור אי-הגעה ${pct(s.no_show_rate)}. כדאי להפעיל תזכורת נוספת שעה לפני, או לגבות מקדמה בשירותים הארוכים.`);
  if (s.utilization < 0.6) out.push(`ניצולת היומן ${pct(s.utilization)}. יש מקום לקמפיין שעות שקטות או לצמצם משמרות.`);
  if (s.utilization > 0.85) out.push(`היומן כמעט מלא (${pct(s.utilization)}). שווה לפתוח שעות נוספות או להוסיף איש צוות, רשימת ההמתנה תגדל.`);
  const hours = Object.entries(s.per_hour).sort((a, b) => b[1] - a[1]);
  if (hours.length > 2) out.push(`שעות השיא: ${hours.slice(0, 2).map(([h]) => `${h}:00`).join(", ")}. השעות החלשות: ${hours.slice(-2).map(([h]) => `${h}:00`).join(", ")}.`);
  if (s.online_share > 0.6) out.push(`${pct(s.online_share)} מהתורים נקבעו אונליין, בלי שיחת טלפון.`);
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
    <div className="stack">
      <div className="page-head">
        <h1>תובנות</h1>
        <div className="tabs" style={{ width: 280 }}>
          {[7, 30, 90].map((r) => (
            <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
              {r} ימים
            </button>
          ))}
        </div>
      </div>
      <div className="grid kpi">
        <Kpi v={money(s.revenue)} l="הכנסות (הושלמו)" />
        <Kpi v={String(s.bookings)} l="תורים" />
        <Kpi v={pct(s.utilization)} l="ניצולת יומן" />
        <Kpi v={pct(s.no_show_rate)} l="לא הגיעו" warn={s.no_show_rate > 0.05} />
        <Kpi v={pct(s.cancel_rate)} l="ביטולים" />
        <Kpi v={s.avg_lead_days != null ? `${s.avg_lead_days} ימים` : "—"} l="זמן הזמנה מראש" />
      </div>
      {tips(s).length > 0 && (
        <div className="card stack tight" style={{ background: "var(--accent-soft)", borderColor: "transparent" }}>
          <h2>💡 המלצות</h2>
          {tips(s).map((t) => (
            <p key={t} className="small">
              • {t}
            </p>
          ))}
        </div>
      )}
      <div className="card stack">
        <h2>תורים ליום</h2>
        <div className="bar-chart">
          {days.map(([d, v]) => (
            <div key={d} className="bar" style={{ height: `${(v / maxDay) * 100}%` }} title={`${dayShort(d).weekday} ${d.slice(8)}/${d.slice(5, 7)}: ${v}`} />
          ))}
        </div>
        <div className="row between tiny muted">
          <span>{days[0]?.[0]}</span>
          <span>{days[days.length - 1]?.[0]}</span>
        </div>
      </div>
      <div className="grid two">
        <div className="card stack">
          <h2>לפי שעה ביום</h2>
          <div className="bar-chart" style={{ height: 100 }}>
            {hours.map(([h, v]) => (
              <div key={h} className="bar" style={{ height: `${(v / maxHour) * 100}%` }} title={`${h}:00 · ${v}`} />
            ))}
          </div>
          <div className="row between tiny muted">
            <span>{hours[0]?.[0]}:00</span>
            <span>{hours[hours.length - 1]?.[0]}:00</span>
          </div>
        </div>
        <div className="card stack tight">
          <h2>שירותים מובילים</h2>
          {s.top_services.map(([n, v]) => (
            <div key={n} className="hbar">
              <span>{n}</span>
              <div className="track">
                <div className="fill" style={{ width: `${(v / maxSvc) * 100}%` }} />
              </div>
              <b>{v}</b>
            </div>
          ))}
          <h2 style={{ marginTop: "0.75rem" }}>לפי איש צוות</h2>
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
    <div className="card kpi-card">
      <div className="value" style={{ color: warn ? "var(--warn)" : undefined }}>
        {v}
      </div>
      <div className="label">{l}</div>
    </div>
  );
}
