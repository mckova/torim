import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Business } from "@torim/shared";
import { api } from "../api";
import { ErrorBox, Spinner, initials } from "../components";

export default function Home() {
  const [list, setList] = useState<Business[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.get<Business[]>("/api/businesses").then(setList).catch(setError);
  }, []);
  return (
    <div className="stack">
      <section className="hero stack tight">
        <h1>קובעים תור בשניות</h1>
        <p className="muted">בוחרים שירות, בוחרים שעה, מקבלים אישור ותזכורת בוואטסאפ. בלי טלפונים ובלי להמתין על הקו.</p>
      </section>
      <h2>עסקים</h2>
      <ErrorBox error={error} />
      {!list && !error && <Spinner />}
      {list?.map((b) => (
        <Link key={b.id} to={`/b/${b.slug}`} className="option" style={{ color: "inherit" }}>
          <div className="avatar" style={{ background: b.accent_color }}>
            {initials(b.name)}
          </div>
          <div className="grow stack tight">
            <b>{b.name}</b>
            <span className="small muted">
              {b.category} · {b.address}
            </span>
          </div>
          <span className="muted">‹</span>
        </Link>
      ))}
    </div>
  );
}
