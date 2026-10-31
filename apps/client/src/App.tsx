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
          <span className="brand-mark" aria-hidden>
            t
          </span>
          torim
        </Link>
        <Link to="/business" className="for-biz">
          For businesses
        </Link>
      </header>
      <main className="shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/b/:slug" element={<BusinessPage />} />
          <Route path="/manage/:uid" element={<Manage />} />
          <Route path="/me" element={<MyBookings />} />
          <Route path="/ticket/:uid" element={<TicketPage />} />
          <Route path="*" element={<div className="empty">Page not found</div>} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="Main">
        <NavLink to="/" end>
          Businesses
        </NavLink>
        <NavLink to="/me">
          My bookings
        </NavLink>
      </nav>
    </>
  );
}
