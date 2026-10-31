import { Link, NavLink, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import BusinessPage from "./pages/BusinessPage";
import Manage from "./pages/Manage";
import MyBookings from "./pages/MyBookings";
import TicketPage from "./pages/TicketPage";

const Icon = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6h-6v6H4a1 1 0 01-1-1z" />,
  cal: <path d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />,
};

function Svg({ d }: { d: JSX.Element }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

export default function App() {
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" />
          TORIM
        </Link>
        <Link to="/me" className="small">
          התורים שלי
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
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <Svg d={Icon.home} />
          עסקים
        </NavLink>
        <NavLink to="/me">
          <Svg d={Icon.cal} />
          התורים שלי
        </NavLink>
      </nav>
    </>
  );
}
