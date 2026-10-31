import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "../api";
import Settings from "./Settings";
import Schedule from "./Schedule";
import Services from "./Services";
import Messages from "./Messages";

/** Everything that is set up once and changed rarely, behind one tab in the top bar. */
export default function SettingsPage() {
  const { data } = useMe();
  const owner = data.me.role === "owner";
  const tabs = [
    ...(owner ? [{ to: "business", label: "Business and team" }] : []),
    { to: "hours", label: "Working hours" },
    { to: "services", label: "Services" },
    { to: "messages", label: "Messages" },
  ];
  return (
    <div className="stack loose">
      <nav className="tabs subnav" aria-label="Settings">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        {owner && <Route path="business" element={<Settings />} />}
        <Route path="hours" element={<Schedule />} />
        <Route path="services" element={<Services />} />
        <Route path="messages" element={<Messages />} />
        <Route path="*" element={<Navigate to={owner ? "business" : "hours"} replace />} />
      </Routes>
    </div>
  );
}
