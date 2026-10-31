"""Service-provider API: agenda, booking actions, services, schedules, queue, insights."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import availability as av
from .. import booking as bk
from .. import serialize as ser
from ..auth import ProviderAuth, issue_token, verify_password
from ..db import get_db
from ..models import (
    Booking,
    Break,
    Business,
    Customer,
    DateOverride,
    Notification,
    Provider,
    QueueTicket,
    Service,
    TimeOff,
    WaitlistEntry,
    WorkingHours,
)
from ..schemas import (
    LoginIn,
    OverrideIn,
    ProviderBookingIn,
    RescheduleIn,
    ScheduleIn,
    ServiceIn,
    StatusIn,
    TicketActionIn,
    TimeOffIn,
)

router = APIRouter(prefix="/api/pro", tags=["provider"])


class Ctx:
    def __init__(self, db: Session, claims: dict):
        self.db = db
        self.me: Provider = db.get(Provider, claims["sub"])
        if not self.me or not self.me.active:
            raise HTTPException(401, "provider not found")
        self.business: Business = self.me.business

    @property
    def is_owner(self) -> bool:
        return self.me.role == "owner"

    def provider(self, provider_id: int | None) -> Provider:
        if provider_id is None or provider_id == self.me.id:
            return self.me
        if not self.is_owner:
            raise HTTPException(403, "only the business owner can manage other providers")
        p = self.db.get(Provider, provider_id)
        if not p or p.business_id != self.business.id:
            raise HTTPException(404, "provider not found")
        return p

    def booking(self, booking_id: int) -> Booking:
        b = self.db.get(Booking, booking_id)
        if not b or b.business_id != self.business.id:
            raise HTTPException(404, "booking not found")
        if not self.is_owner and b.provider_id != self.me.id:
            raise HTTPException(403, "not your booking")
        return b

    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.business.timezone)


def ctx(claims: dict = ProviderAuth, db: Session = Depends(get_db)) -> Ctx:
    return Ctx(db, claims)


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    p = db.scalar(select(Provider).where(Provider.email == body.email.strip().lower()))
    if not p or not p.active or not verify_password(body.password, p.password_hash):
        raise HTTPException(401, "wrong email or password")
    return {"token": issue_token("provider", p.id, p.business_id), **me_payload(p)}


def me_payload(p: Provider) -> dict:
    biz = p.business
    return {
        "me": {**ser.provider(p), "email": p.email},
        "business": ser.business(biz),
        "providers": [ser.provider(x) for x in biz.providers],
        "services": [ser.service(s) for s in biz.services],
    }


@router.get("/me")
def me(c: Ctx = Depends(ctx)):
    return me_payload(c.me)


# ---------------------------------------------------------------- agenda
@router.get("/bookings")
def bookings(
    start: date,
    end: date,
    provider_id: int | None = None,
    status: str | None = None,
    c: Ctx = Depends(ctx),
):
    lo, _ = bk.day_bounds(c.business, start)
    _, hi = bk.day_bounds(c.business, end)
    q = select(Booking).where(Booking.business_id == c.business.id, Booking.start >= lo, Booking.start < hi)
    if not c.is_owner:
        q = q.where(Booking.provider_id == c.me.id)
    elif provider_id:
        q = q.where(Booking.provider_id == provider_id)
    if status:
        q = q.where(Booking.status.in_(status.split(",")))
    return [ser.booking(b) for b in c.db.scalars(q.order_by(Booking.start))]


@router.post("/bookings", status_code=201)
def create(body: ProviderBookingIn, c: Ctx = Depends(ctx)):
    s = c.db.get(Service, body.service_id)
    if not s or s.business_id != c.business.id:
        raise HTTPException(404, "service not found")
    provider_id = body.provider_id if c.is_owner else c.me.id
    customer = bk.upsert_customer(c.db, c.business, body.name, body.phone)
    b = bk.create_booking(
        c.db, s, body.start, customer, provider_id=provider_id, notes=body.notes, source="provider", force_confirm=True
    )
    return ser.booking(b)


@router.post("/bookings/{booking_id}/status")
def set_status(booking_id: int, body: StatusIn, c: Ctx = Depends(ctx)):
    return ser.booking(bk.transition(c.db, c.booking(booking_id), body.status, by="provider", reason=body.reason))


@router.post("/bookings/{booking_id}/reschedule")
def move(booking_id: int, body: RescheduleIn, c: Ctx = Depends(ctx)):
    return ser.booking(bk.reschedule(c.db, c.booking(booking_id), body.start, body.provider_id))


@router.get("/slots")
def slots(service_id: int, date: date, provider_id: int | None = None, c: Ctx = Depends(ctx)):
    s = c.db.get(Service, service_id)
    if not s or s.business_id != c.business.id:
        raise HTTPException(404, "service not found")
    return [
        {"start": ser.local_iso(x.start, c.business.timezone), "provider_ids": x.provider_ids}
        for x in bk.slots(c.db, s, date, provider_id)
    ]


# ---------------------------------------------------------------- services
def _apply_service(c: Ctx, s: Service, body: ServiceIn) -> Service:
    for k, v in body.model_dump(exclude={"provider_ids"}).items():
        setattr(s, k, v)
    ids = body.provider_ids or [c.me.id]
    s.providers = [p for p in c.business.providers if p.id in ids]
    return s


@router.post("/services", status_code=201)
def add_service(body: ServiceIn, c: Ctx = Depends(ctx)):
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    s = _apply_service(c, Service(business_id=c.business.id), body)
    c.db.add(s)
    c.db.commit()
    return ser.service(s)


@router.put("/services/{service_id}")
def edit_service(service_id: int, body: ServiceIn, c: Ctx = Depends(ctx)):
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    s = c.db.get(Service, service_id)
    if not s or s.business_id != c.business.id:
        raise HTTPException(404, "service not found")
    _apply_service(c, s, body)
    c.db.commit()
    return ser.service(s)


# ---------------------------------------------------------------- schedule
@router.get("/schedule")
def get_schedule(provider_id: int | None = None, c: Ctx = Depends(ctx)):
    p = c.provider(provider_id)
    breaks = defaultdict(list)
    for b in p.breaks:
        breaks[b.weekday].append((b.start, b.end))
    today = bk.today(c.business)
    return {
        "provider_id": p.id,
        "days": [
            {"weekday": w.weekday, "start": w.start, "end": w.end, "breaks": breaks[w.weekday]}
            for w in sorted(p.working_hours, key=lambda w: w.weekday)
        ],
        "overrides": [
            {"id": o.id, "date": o.date.isoformat(), "start": o.start, "end": o.end}
            for o in sorted(p.overrides, key=lambda o: o.date)
            if o.date >= today
        ],
        "time_off": [
            {
                "id": t.id,
                "start": ser.local_iso(t.start, c.business.timezone),
                "end": ser.local_iso(t.end, c.business.timezone),
                "reason": t.reason,
            }
            for t in sorted(p.time_off, key=lambda t: t.start)
        ],
    }


def _hhmm(text: str) -> str:
    try:
        h, m = text.split(":")
        time(int(h), int(m))
    except Exception:
        raise HTTPException(422, f"bad time {text!r}, expected HH:MM")
    return f"{int(h):02d}:{int(m):02d}"


@router.put("/schedule")
def put_schedule(body: ScheduleIn, provider_id: int | None = None, c: Ctx = Depends(ctx)):
    p = c.provider(provider_id)
    p.working_hours.clear()
    p.breaks.clear()
    c.db.flush()
    for d in body.days:
        if _hhmm(d.start) >= _hhmm(d.end):
            raise HTTPException(422, "day must end after it starts")
        p.working_hours.append(WorkingHours(weekday=d.weekday, start=_hhmm(d.start), end=_hhmm(d.end)))
        for s, e in d.breaks:
            p.breaks.append(Break(weekday=d.weekday, start=_hhmm(s), end=_hhmm(e)))
    c.db.commit()
    return get_schedule(p.id, c)


@router.post("/overrides", status_code=201)
def add_override(body: OverrideIn, provider_id: int | None = None, c: Ctx = Depends(ctx)):
    p = c.provider(provider_id)
    for o in list(p.overrides):
        if o.date == body.date:
            p.overrides.remove(o)
    c.db.flush()
    p.overrides.append(
        DateOverride(
            date=body.date,
            start=_hhmm(body.start) if body.start else None,
            end=_hhmm(body.end) if body.end else None,
        )
    )
    c.db.commit()
    return get_schedule(p.id, c)


@router.delete("/overrides/{override_id}")
def delete_override(override_id: int, c: Ctx = Depends(ctx)):
    o = c.db.get(DateOverride, override_id)
    if not o:
        raise HTTPException(404, "not found")
    p = c.provider(o.provider_id)
    c.db.delete(o)
    c.db.commit()
    return get_schedule(p.id, c)


@router.post("/time-off", status_code=201)
def add_time_off(body: TimeOffIn, provider_id: int | None = None, c: Ctx = Depends(ctx)):
    p = c.provider(provider_id)
    if body.start.tzinfo is None or body.end.tzinfo is None or body.end <= body.start:
        raise HTTPException(422, "time off needs an aware start before its end")
    p.time_off.append(TimeOff(start=body.start, end=body.end, reason=body.reason))
    c.db.commit()
    return get_schedule(p.id, c)


@router.delete("/time-off/{item_id}")
def delete_time_off(item_id: int, c: Ctx = Depends(ctx)):
    t = c.db.get(TimeOff, item_id)
    if not t:
        raise HTTPException(404, "not found")
    p = c.provider(t.provider_id)
    c.db.delete(t)
    c.db.commit()
    return get_schedule(p.id, c)


# ---------------------------------------------------------------- customers
@router.get("/customers")
def customers(q: str = "", c: Ctx = Depends(ctx)):
    stmt = select(Customer).where(Customer.business_id == c.business.id)
    if q:
        stmt = stmt.where(or_(Customer.name.contains(q), Customer.phone.contains(q)))
    rows = c.db.scalars(stmt.order_by(Customer.name).limit(100)).all()
    out = []
    for cu in rows:
        hist = c.db.scalars(select(Booking).where(Booking.customer_id == cu.id)).all()
        st = Counter(b.status for b in hist)
        out.append(
            {
                "id": cu.id,
                "name": cu.name,
                "phone": cu.phone,
                "visits": st["completed"],
                "no_shows": st["no_show"],
                "cancellations": st["cancelled"],
                "spent": sum(b.price for b in hist if b.status == "completed"),
                "last_visit": max((ser.local_iso(b.start, c.business.timezone) for b in hist if b.status == "completed"), default=None),
            }
        )
    return out


@router.get("/customers/{customer_id}")
def customer_detail(customer_id: int, c: Ctx = Depends(ctx)):
    cu = c.db.get(Customer, customer_id)
    if not cu or cu.business_id != c.business.id:
        raise HTTPException(404, "not found")
    hist = c.db.scalars(select(Booking).where(Booking.customer_id == cu.id).order_by(Booking.start.desc())).all()
    return {"id": cu.id, "name": cu.name, "phone": cu.phone, "email": cu.email, "bookings": [ser.booking(b) for b in hist]}


# ---------------------------------------------------------------- queue & waitlist
@router.get("/queue")
def queue(c: Ctx = Depends(ctx)):
    st = bk.queue_state(c.db, c.business)
    tz = c.business.timezone
    waiting_ids = [t.id for t in st["waiting"]]
    return {
        "tickets": [
            ser.ticket(t, tz, waiting_ids.index(t.id) + 1 if t.id in waiting_ids else None, st["eta"].get(t.id))
            for t in st["tickets"]
        ],
        "avg_minutes": st["avg_minutes"],
    }


@router.post("/queue/{ticket_id}/status")
def queue_action(ticket_id: int, body: TicketActionIn, c: Ctx = Depends(ctx)):
    t = c.db.get(QueueTicket, ticket_id)
    if not t or t.business_id != c.business.id:
        raise HTTPException(404, "ticket not found")
    bk.advance_ticket(c.db, t, body.status, c.me.id)
    return queue(c)


@router.post("/queue/call-next")
def call_next(c: Ctx = Depends(ctx)):
    st = bk.queue_state(c.db, c.business)
    if not st["waiting"]:
        raise HTTPException(409, "nobody is waiting")
    bk.advance_ticket(c.db, st["waiting"][0], "called", c.me.id)
    return queue(c)


@router.get("/waitlist")
def waitlist(c: Ctx = Depends(ctx)):
    rows = c.db.scalars(
        select(WaitlistEntry)
        .where(WaitlistEntry.business_id == c.business.id, WaitlistEntry.date >= bk.today(c.business))
        .order_by(WaitlistEntry.date, WaitlistEntry.created_at)
    ).all()
    return [
        {
            "id": e.id,
            "date": e.date.isoformat(),
            "status": e.status,
            "service": e.service.name,
            "customer": {"name": e.customer.name, "phone": e.customer.phone},
            "provider_id": e.provider_id,
        }
        for e in rows
    ]


@router.get("/notifications")
def outbox(limit: int = 50, c: Ctx = Depends(ctx)):
    rows = c.db.scalars(
        select(Notification).where(Notification.business_id == c.business.id).order_by(Notification.id.desc()).limit(limit)
    ).all()
    tz = c.business.timezone
    return [
        {
            "id": n.id,
            "kind": n.kind,
            "to": n.to,
            "body": n.body,
            "status": n.status,
            "send_at": ser.local_iso(n.send_at, tz),
            "sent_at": ser.local_iso(n.sent_at, tz),
        }
        for n in rows
    ]


# ---------------------------------------------------------------- insights
@router.get("/stats")
def stats(start: date, end: date, c: Ctx = Depends(ctx)):
    lo, _ = bk.day_bounds(c.business, start)
    _, hi = bk.day_bounds(c.business, end)
    q = select(Booking).where(Booking.business_id == c.business.id, Booking.start >= lo, Booking.start < hi)
    providers = c.business.providers if c.is_owner else [c.me]
    q = q.where(Booking.provider_id.in_([p.id for p in providers]))
    rows = c.db.scalars(q).all()
    tz = c.tz()

    by_status = Counter(b.status for b in rows)
    kept = [b for b in rows if b.status in ("confirmed", "completed", "pending")]
    booked_minutes = sum((b.end - b.start).total_seconds() / 60 for b in kept)
    work_minutes = 0
    d = start
    while d <= end:
        for p in providers:
            work_minutes += av.working_minutes(bk.build_calendar(c.db, p, d), d)
        d += timedelta(days=1)

    finished = by_status["completed"] + by_status["no_show"]
    per_day = Counter(b.start.astimezone(tz).date().isoformat() for b in kept)
    per_hour = Counter(b.start.astimezone(tz).hour for b in kept)
    per_service = Counter(b.service.name for b in kept)
    per_provider = Counter(b.provider.name for b in kept)
    lead_days = [(b.start - b.created_at).total_seconds() / 86400 for b in rows if b.source == "online"]
    return {
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "bookings": len(rows),
        "by_status": dict(by_status),
        "revenue": sum(b.price for b in rows if b.status == "completed"),
        "expected_revenue": sum(b.price for b in kept),
        "utilization": round(booked_minutes / work_minutes, 3) if work_minutes else 0,
        "no_show_rate": round(by_status["no_show"] / finished, 3) if finished else 0,
        "cancel_rate": round(by_status["cancelled"] / len(rows), 3) if rows else 0,
        "avg_lead_days": round(sum(lead_days) / len(lead_days), 1) if lead_days else None,
        "per_day": dict(sorted(per_day.items())),
        "per_hour": {str(h): per_hour[h] for h in sorted(per_hour)},
        "top_services": per_service.most_common(5),
        "per_provider": per_provider.most_common(),
        "online_share": round(sum(1 for b in rows if b.source == "online") / len(rows), 3) if rows else 0,
    }
