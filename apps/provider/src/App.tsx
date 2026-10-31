import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Icon, translateError } from "@torim/shared";
import { Me, MeContext, api, getToken, setToken } from "./api";
import Login from "./pages/Login";
import Today from "./pages/Today";
import Calendar from "./pages/Calendar";
import Queue from "./pages/Queue";
import Customers from "./pages/Customers";
import Insights from "./pages/Insights";
import Copilot from "./pages/Copilot";
import Signup from "./pages/Signup";
import SettingsPage from "./pages/SettingsPage";

const NAV: { to: string; label: string; end?: boolean; mobile?: boolean }[] = [
  { to: "/", label: "Today", end: true, mobile: true },
  { to: "/calendar", label: "Calendar", mobile: true },
  { to: "/queue", label: "Walk-ins", mobile: true },
  { to: "/customers", label: "Clients" },
  { to: "/insights", label: "Insights", mobile: true },
  { to: "/copilot", label: "Assistant", mobile: true },
  { to: "/settings", label: "Settings" },
];

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function UserMenu({ data, onLogout }: { data: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="user-menu" ref={box}>
      <button className="user-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span className="user-dot" style={{ background: `linear-gradient(135deg, #ffc2d6, ${data.me.color})` }} aria-hidden>
          {initials(data.me.name)}
        </span>
        <span className="user-name">{data.me.name.split(" ")[0]}</span>
      </button>
      {open && (
        <div className="user-pop" role="menu">
          <div className="user-pop-head">
            <b>{data.me.name}</b>
            <span className="muted small">
              {data.me.role === "owner" ? "Owner" : data.me.title} · {data.business.name}
            </span>
          </div>
          <a role="menuitem" href={`/b/${data.business.slug}`} target="_blank" rel="noreferrer">
            Public booking page <Icon name="external" />
          </a>
          <button role="menuitem" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<Me | null>(null);
  const [token, setTok] = useState(getToken());
  const [error, setError] = useState<string | null>(null);

  const loc = useLocation();
  const reload = useCallback(() => {
    if (!token) return;
    api
      .get<Me>("/api/pro/me")
      .then(setData)
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
  const logout = () => {
    setToken(null);
    setTok(null);
    setData(null);
  };
  if (!token && loc.pathname.startsWith("/signup")) return <Signup onDone={login} />;
  if (!token) return <Login onLogin={login} error={error} />;
  if (!data) return <div className="spinner" />;

  return (
    <MeContext.Provider value={{ data, reload }}>
      <div className="frame">
        <header className="topbar">
          <NavLink to="/" className="logo" aria-label={`TORIM, ${data.business.name}`}>
            <span className="logo-mark" aria-hidden>
              t
            </span>
            <span className="logo-text">
              torim
              <small>{data.business.name}</small>
            </span>
          </NavLink>
          <nav className="pillnav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <UserMenu data={data} onLogout={logout} />
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/queue" element={<Queue />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/copilot" element={<Copilot />} />
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="/messages" element={<Navigate to="/settings/messages" />} />
            <Route path="/schedule" element={<Navigate to="/settings/hours" />} />
            <Route path="/services" element={<Navigate to="/settings/services" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </MeContext.Provider>
  );
}
