"""No-show risk model, trained per business on its own history.

A logistic regression over a handful of behavioural features. It is small on
purpose: it trains in milliseconds on a few hundred finished bookings, every
prediction comes with the features that pushed it up, and the owner can act on
it (call, ask for a deposit, send an extra reminder). The copilot agent uses it
as a tool, and the agenda shows it as a badge.
"""
from __future__ import annotations

import math
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Booking, Business, now_utc

FEATURES = [
    ("prior_no_show_rate", "היסטוריה של אי-הגעה"),
    ("first_visit", "לקוח חדש"),
    ("log_visits", "לקוח קבוע"),
    ("lead_days", "הוזמן הרבה זמן מראש"),
    ("evening", "שעת ערב"),
    ("morning", "שעת בוקר מוקדמת"),
    ("online", "הוזמן אונליין"),
    ("long_service", "שירות ארוך"),
]


def _features(b: Booking, past: list[Booking], tz: ZoneInfo) -> list[float]:
    finished = [p for p in past if p.status in ("completed", "no_show")]
    ns = sum(1 for p in finished if p.status == "no_show")
    # Laplace smoothing: one imaginary completed visit
    rate = ns / (len(finished) + 2)
    local = b.start.astimezone(tz)
    lead = max(0.0, (b.start - b.created_at).total_seconds() / 86400)
    return [
        rate,
        1.0 if not finished else 0.0,
        math.log1p(len(finished)),
        math.log1p(lead),
        1.0 if local.hour >= 17 else 0.0,
        1.0 if local.hour < 9 else 0.0,
        1.0 if b.source == "online" else 0.0,
        1.0 if b.service.duration >= 60 else 0.0,
    ]


@dataclass
class Model:
    weights: list[float]  # on standardized features
    bias: float
    trained_on: int
    base_rate: float
    mean: list[float]
    std: list[float]

    def z(self, x: list[float]) -> list[float]:
        return [(v - m) / s for v, m, s in zip(x, self.mean, self.std)]

    def predict(self, x: list[float]) -> float:
        z = self.bias + sum(w * v for w, v in zip(self.weights, self.z(x)))
        return 1 / (1 + math.exp(-z))


def _train(rows: list[tuple[list[float], int]], epochs: int = 800, lr: float = 0.5, l2: float = 0.002) -> Model:
    """Plain (unweighted) logistic regression with standardized inputs, so the
    output stays a calibrated probability of a no-show."""
    n_feat = len(FEATURES)
    n = len(rows)
    mean = [sum(x[i] for x, _ in rows) / n for i in range(n_feat)]
    std = [max(1e-6, math.sqrt(sum((x[i] - mean[i]) ** 2 for x, _ in rows) / n)) for i in range(n_feat)]
    data = [([(v - m) / s for v, m, s in zip(x, mean, std)], y) for x, y in rows]
    pos = sum(y for _, y in rows)
    base = pos / n
    w = [0.0] * n_feat
    b = math.log((base + 1e-3) / (1 - base + 1e-3))
    for _ in range(epochs):
        gw = [0.0] * n_feat
        gb = 0.0
        for x, y in data:
            p = 1 / (1 + math.exp(-(b + sum(wi * xi for wi, xi in zip(w, x)))))
            gb += p - y
            for i, xi in enumerate(x):
                gw[i] += (p - y) * xi
        b -= lr * gb / n
        w = [wi - lr * (gi / n + l2 * wi) for wi, gi in zip(w, gw)]
    return Model(w, b, n, base, mean, std)


_cache: dict[int, tuple[float, Model]] = {}


def model_for(db: Session, business: Business, ttl: float = 600) -> Model:
    hit = _cache.get(business.id)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    tz = ZoneInfo(business.timezone)
    rows_db = db.scalars(
        select(Booking).where(Booking.business_id == business.id, Booking.status.in_(["completed", "no_show"])).order_by(Booking.start)
    ).all()
    history: dict[int, list[Booking]] = defaultdict(list)
    rows = []
    for b in rows_db:
        rows.append((_features(b, history[b.customer_id], tz), 1 if b.status == "no_show" else 0))
        history[b.customer_id].append(b)
    m = _train(rows) if len(rows) >= 30 else Model([0.8, 0.3, -0.2, 0.1, 0.1, 0.1, 0.0, 0.0], -2.9, len(rows), 0.05, [0.03, 0.5, 1.0, 1.0, 0.2, 0.1, 0.7, 0.3], [0.05, 0.5, 0.8, 0.8, 0.4, 0.3, 0.45, 0.45])
    _cache[business.id] = (time.time(), m)
    return m


def score(db: Session, booking: Booking) -> dict:
    business = booking.provider.business
    tz = ZoneInfo(business.timezone)
    m = model_for(db, business)
    past = db.scalars(
        select(Booking).where(Booking.customer_id == booking.customer_id, Booking.start < booking.start, Booking.id != booking.id)
    ).all()
    x = _features(booking, list(past), tz)
    p = m.predict(x)
    contrib = sorted(
        ((w * v, label) for (w, v, (_, label)) in zip(m.weights, m.z(x), FEATURES) if w > 0 and v > 0 and w * v > 0.15),
        reverse=True,
    )
    level = "high" if p >= max(0.2, m.base_rate * 2.2) else "medium" if p >= max(0.1, m.base_rate * 1.5) else "low"
    return {"probability": round(p, 3), "level": level, "reasons": [label for _, label in contrib[:3]]}


def upcoming_risks(db: Session, business: Business, start: datetime, end: datetime) -> list[dict]:
    rows = db.scalars(
        select(Booking)
        .where(
            Booking.business_id == business.id,
            Booking.status.in_(["confirmed", "pending"]),
            Booking.start >= max(start, now_utc()),
            Booking.start < end,
        )
        .order_by(Booking.start)
    ).all()
    out = []
    for b in rows:
        s = score(db, b)
        out.append({"booking_id": b.id, "customer": b.customer.name, "phone": b.customer.phone, "start": b.start, **s})
    return sorted(out, key=lambda r: -r["probability"])
