import { Fragment, useCallback, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import Signup from "./pages/Signup";
import Settings from "./pages/Settings";

const NAV: { to: string; label: string; end?: boolean; owner?: boolean; group?: string }[] = [
  { to: "/", label: "היום", end: true },
  { to: "/calendar", label: "יומן" },
  { to: "/queue", label: "תור חי" },
  { to: "/copilot", label: "העוזר" },
  { to: "/customers", label: "לקוחות", group: "העסק" },
  { to: "/insights", label: "תובנות" },
  { to: "/messages", label: "הודעות שנשלחו" },
  { to: "/schedule", label: "שעות עבודה", group: "הגדרות" },
  { to: "/services", label: "שירותים" },
  { to: "/settings", label: "העסק והצוות", owner: true },
];
const MOBILE = ["/", "/copilot", "/calendar", "/queue", "/insights"];

export default function App() {
  const [data, setData] = useState<Me | null>(null);
  const [token, setTok] = useState(getToken());
  const [error, setError] = useState<string | null>(null);

  const loc = useLocation();
  const reload = useCallback(() => {
    if (!token) return;
    api
      .get<Me>("/api/pro/me")
      .then((d) => {
        setData(d);
      })
      .catch((e) => {
        setError(translateError(e));
        setToken(null);
        setTok(null);
      });
  }, [token]);
  useEffect(reload, [reload]);

  const login = (t: string) => {
    setToken(t);
    setTok(t);
    setError(null);
  };
  if (!token && loc.pathname.startsWith("/signup")) return <Signup onDone={login} />;
  if (!token)
    return (
      <Login
        onLogin={login}
        error={error}
      />
    );
  if (!data) return <div className="spinner" />;

  return (
    <MeContext.Provider value={{ data, reload }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
            <b>TORIM</b>
            <span>לעסק</span>
          </div>
          <div className="biz">{data.business.name}</div>
          <nav aria-label="ניווט ראשי">
            {NAV.filter((n) => !n.owner || data.me.role === "owner").map((n) => (
              <Fragment key={n.to}>
                {n.group && <div className="group">{n.group}</div>}
                <NavLink to={n.to} end={n.end} className={n.to === "/copilot" ? "ai-link" : undefined}>
                  {n.label}
                </NavLink>
              </Fragment>
            ))}
          </nav>
          <div className="me">
            <b>{data.me.name}</b>
            <span className="muted">{data.me.role === "owner" ? "בעלים" : data.me.title}</span>
            <a href={`/b/${data.business.slug}`} target="_blank" rel="noreferrer">
              דף ההזמנות של העסק
            </a>
            <button
              className="btn ghost sm logout"
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
            <Route path="/settings" element={data.me.role === "owner" ? <Settings /> : <Navigate to="/" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
        <nav className="mobile-nav" aria-label="ניווט">
          {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </MeContext.Provider>
  );
}
