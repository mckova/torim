import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Business } from "@torim/shared";
import { api } from "../api";
import { ErrorBox } from "../components";

export default function Home() {
  const [list, setList] = useState<Business[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api.get<Business[]>("/api/businesses").then(setList).catch(setError);
  }, []);
  return (
    <div className="stack loose">
      <section className="home-head">
        <h1>קביעת תור</h1>
        <p className="ink-2">בוחרים עסק, שירות ושעה. אפשר גם לכתוב לעוזר של העסק במילים שלכם, או להקליט. האישור מגיע בוואטסאפ.</p>
      </section>
      <section aria-labelledby="biz-h">
        <h2 id="biz-h" className="list-title">
          עסקים
        </h2>
        <ErrorBox error={error} />
        {!list && !error && (
          <div className="stack tight" aria-hidden>
            <div className="skeleton" style={{ height: 58 }} />
            <div className="skeleton" style={{ height: 58 }} />
          </div>
        )}
        {list?.length === 0 && <p className="muted">עוד אין עסקים פתוחים להזמנה.</p>}
        <ul className="biz-list">
          {list?.map((b) => (
            <li key={b.id}>
              <Link to={`/b/${b.slug}`}>
                <span className="grow">
                  <b>{b.name}</b>
                  <span className="small muted">
                    {b.category}
                    {b.address && ` · ${b.address}`}
                  </span>
                </span>
                <span className="go small">לקבוע</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <p className="small muted">
        יש לכם עסק? <Link to="/business">ככה נראה יום עבודה עם TORIM</Link>
      </p>
    </div>
  );
}
