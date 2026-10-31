import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import BusinessPage from "./pages/BusinessPage";
import Manage from "./pages/Manage";
import MyBookings from "./pages/MyBookings";
import TicketPage from "./pages/TicketPage";
import Landing from "./pages/Landing";

export default function App() {
  const loc = useLocation();
  if (loc.pathname === "/business") return <Landing />;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          TORIM
        </Link>
        <Link to="/business" className="small">
          לבעלי עסקים
        </Link>
      </header>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/b/:slug" element={<BusinessPage />} />
          <Route path="/manage/:uid" element={<Manage />} />
          <Route path="/me" element={<MyBookings />} />
          <Route path="/ticket/:uid" element={<TicketPage />} />
          <Route path="*" element={<div className="empty">העמוד לא נמצא</div>} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="ניווט">
        <NavLink to="/" end>
          עסקים
        </NavLink>
        <NavLink to="/me">
          התורים שלי
        </NavLink>
      </nav>
    </>
  );
}
