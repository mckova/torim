import { useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { translateError } from "@torim/shared";
import { Me, MeContext, api, getToken, setToken } from "./api";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Calendar from "./pages/Calendar";
import Queue from "./pages/Queue";
import Customers from "./pages/Customers";
import Schedule from "./pages/Schedule";
import Services from "./pages/Services";
import Insights from "./pages/Insights";
import Messages from "./pages/Messages";
import Copilot from "./pages/Copilot";

const NAV = [
  { to: "/", label: "היום", icon: "☀️", end: true },
  { to: "/copilot", label: "עוזר AI", icon: "✨" },
  { to: "/calendar", label: "יומן", icon: "📅" },
  { to: "/queue", label: "תור חי", icon: "🎟️" },
  { to: "/customers", label: "לקוחות", icon: "👥" },
  { to: "/schedule", label: "שעות עבודה", icon: "🕘" },
  { to: "/services", label: "שירותים", icon: "✂️" },
  { to: "/insights", label: "תובנות", icon: "📈" },
  { to: "/messages", label: "הודעות", icon: "💬" },
];
const MOBILE = ["/", "/copilot", "/calendar", "/queue", "/insights"];

export default function App() {
  const [data, setData] = useState<Me | null>(null);
  const [token, setTok] = useState(getToken());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!token) return;
    api
      .get<Me>("/api/pro/me")
      .then((d) => {
        setData(d);
        document.documentElement.style.setProperty("--accent", d.business.accent_color);
      })
      .catch((e) => {
        setError(translateError(e));
        setToken(null);
        setTok(null);
      });
  }, [token]);
  useEffect(reload, [reload]);

  if (!token)
    return (
      <Login
        onLogin={(t) => {
          setToken(t);
          setTok(t);
          setError(null);
        }}
        error={error}
      />
    );
  if (!data) return <div className="spinner" />;

  return (
    <MeContext.Provider value={{ data, reload }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <img src="/pro/icon.svg" alt="" /> TORIM Pro
          </div>
          <div className="small" style={{ color: "#94a3b8", padding: "0 0.75rem 0.75rem" }}>
            {data.business.name}
          </div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
          <div className="me stack tight">
            <b>{data.me.name}</b>
            <span style={{ color: "#94a3b8" }}>{data.me.role === "owner" ? "בעלים" : data.me.title}</span>
            <a
              href={`/b/${data.business.slug}`}
              target="_blank"
              rel="noreferrer"
              style={{ padding: 0, color: "#5eead4" }}
            >
              לדף ההזמנות של העסק ↗
            </a>
            <button
              className="btn ghost sm"
              style={{ color: "#e5e7eb", borderColor: "#374151", marginTop: "0.5rem" }}
              onClick={() => {
                setToken(null);
                setTok(null);
                setData(null);
              }}
            >
              יציאה
            </button>
          </div>
        </aside>
        <main className="content">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/services" element={<Services />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <nav className="mobile-nav">
          {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              <span style={{ fontSize: "1.2rem" }}>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </MeContext.Provider>
  );
}
