import { Booking, Provider, time } from "@torim/shared";

const PX = 68; // pixels per hour
export const minutesOf = (iso: string) => {
  const s = new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });
  return +s.slice(11, 13) * 60 + +s.slice(14, 16);
};
const freeLabel = (m: number) => (m < 120 ? `${m} min free` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ""}free`);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

export type RiskMap = Record<number, { level: string; probability: number; reasons: string[] }>;

/** Staff tints come from each person's colour, mixed into white so every column stays in the same warm family. */
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, white)`;
const deep = (c: string) => `color-mix(in srgb, ${c} 78%, #2a1530)`;

interface Gap {
  provider: number;
  start: number;
  end: number;
}

/**
 * One day, one column per staff member (the layout salons already use on paper).
 * Bookings are blocks in the person's tint; the assistant's
 * bookings, likely no-shows and requests waiting for approval are marked on the block.
 * Free hours between bookings are drawn as open slots that can be offered to the waitlist.
 */
export function DayBoard({
  staff,
  bookings,
  risk,
  isToday,
  waiting,
  onOpen,
  onCreate,
  onOffer,
}: {
  staff: Provider[];
  bookings: Booking[];
  risk: RiskMap;
  isToday: boolean;
  waiting: number;
  onOpen: (b: Booking) => void;
  onCreate: (providerId: number) => void;
  onOffer: () => void;
}) {
  const live = bookings.filter((b) => b.status !== "cancelled" && b.status !== "no_show");
  const from = Math.min(9, ...live.map((b) => Math.floor(minutesOf(b.start) / 60)));
  const to = Math.max(19, ...live.map((b) => Math.ceil(minutesOf(b.end) / 60)));
  const nowMin = minutesOf(new Date().toISOString());
  const y = (m: number) => ((m - from * 60) / 60) * PX;

  const gaps: Gap[] = [];
  for (const p of staff) {
    const own = live.filter((b) => b.provider.id === p.id).sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 1; i < own.length; i++) {
      // only the part of a gap that is still ahead is worth offering, rounded up to the next quarter hour
      const s = isToday ? Math.max(minutesOf(own[i - 1].end), Math.ceil(nowMin / 15) * 15) : minutesOf(own[i - 1].end);
      const e = minutesOf(own[i].start);
      if (e - s >= 60) gaps.push({ provider: p.id, start: s, end: e });
    }
  }

  return (
    <div className="board" style={{ ["--cols" as string]: staff.length }}>
      <div className="board-head">
        <div />
        {staff.map((p) => {
          const n = live.filter((b) => b.provider.id === p.id).length;
          return (
            <div key={p.id} className="board-staff">
              <span className="staff-dot" style={{ background: `linear-gradient(135deg, ${tint(p.color, 25)}, ${tint(p.color, 60)})`, color: deep(p.color) }} aria-hidden>
                {p.name[0]}
              </span>
              <div>
                <b>{p.name.split(" ")[0]}</b>
                <span>
                  {n} {n === 1 ? "client" : "clients"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="board-body" style={{ height: (to - from) * PX }}>
        <div className="board-hours" aria-hidden>
          {Array.from({ length: to - from }, (_, i) => (
            <span key={i} style={{ top: i * PX }}>
              {hourLabel(from + i)}
            </span>
          ))}
        </div>
        {staff.map((p) => (
          <div key={p.id} className="board-col" style={{ ["--px" as string]: `${PX}px` }} onDoubleClick={() => onCreate(p.id)}>
            {gaps
              .filter((g) => g.provider === p.id)
              .map((g) => (
                <div key={g.start} className="board-free" style={{ top: y(g.start) + 2, height: y(g.end) - y(g.start) - 4 }}>
                  <span>{freeLabel(g.end - g.start)}</span>
                  {isToday && waiting > 0 ? (
                    <button className="free-act" onClick={onOffer}>
                      Offer to {waiting} waiting
                    </button>
                  ) : (
                    <button className="free-act soft" onClick={() => onCreate(p.id)}>
                      Book
                    </button>
                  )}
                </div>
              ))}
            {live
              .filter((b) => b.provider.id === p.id)
              .map((b) => {
                const s = minutesOf(b.start);
                const e = minutesOf(b.end);
                const h = Math.max(26, y(e) - y(s) - 4);
                const r = risk[b.id];
                const now = isToday && s <= nowMin && nowMin < e;
                const tall = h >= 47;
                const badge =
                  b.status === "pending" ? (
                    <span className="tag wait">Needs approval</span>
                  ) : r && r.level === "high" ? (
                    <span className="tag risk" title={r.reasons.join(", ")}>
                      Might not show
                    </span>
                  ) : b.source === "ai" ? (
                    <span className="tag ai">AI booked</span>
                  ) : null;
                return (
                  <button
                    key={b.id}
                    className={`bblock ${now ? "now" : ""} ${b.status} ${isToday && e <= nowMin ? "past" : ""}`}
                    style={{
                      top: y(s) + 2,
                      height: h,
                      background: now ? undefined : tint(b.provider.color, 20),
                      color: now ? undefined : deep(b.provider.color),
                    }}
                    onClick={() => onOpen(b)}
                    aria-label={`${time(b.start)} ${b.customer.name}, ${b.service.name}`}
                  >
                    <span className="bblock-row">
                      <b>{b.customer.name}</b>
                      {badge}
                    </span>
                    {tall && (
                      <small>
                        {time(b.start)} · {b.service.name}
                      </small>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
        {isToday && nowMin > from * 60 && nowMin < to * 60 && <div className="board-now" style={{ top: y(nowMin) }} aria-hidden />}
      </div>
    </div>
  );
}
