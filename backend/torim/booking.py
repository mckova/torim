"""Booking service layer: availability lookup, slot holds, the booking
lifecycle, the waitlist and the walk-in queue.

Concurrency: every write that could double-book runs under `_write_lock` and
re-checks availability inside the transaction. With SQLite and one API process
this is a complete guard. On Postgres the same check would be backed by an
exclusion constraint (`EXCLUDE USING gist (provider_id WITH =, tstzrange(start,
end) WITH &&) WHERE status IN ('pending','confirmed')`).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import availability as av
from . import notifications as nt
from .models import (
    ACTIVE_STATUSES,
    Booking,
    BookingStatus,
    Business,
    Customer,
    DateOverride,
    Provider,
    QueueTicket,
    Service,
    SlotHold,
    TicketStatus,
    TimeOff,
    WaitlistEntry,
    now_utc,
)

_write_lock = threading.RLock()
HOLD_MINUTES = 7


def _t(text: str) -> time:
    h, m = text.split(":")
    return time(int(h), int(m))


def service_rule(s: Service) -> av.ServiceRule:
    return av.ServiceRule(
        id=s.id,
        duration=s.duration,
        buffer_before=s.buffer_before,
        buffer_after=s.buffer_after,
        min_notice=s.min_notice,
        max_days_ahead=s.max_days_ahead,
        capacity=s.capacity,
    )


def day_bounds(business: Business, day: date) -> tuple[datetime, datetime]:
    tz = ZoneInfo(business.timezone)
    start = datetime.combine(day, time(0), tzinfo=tz)
    return start.astimezone(av.UTC), (start + timedelta(days=1)).astimezone(av.UTC)


def build_calendar(
    db: Session,
    provider: Provider,
    day: date,
    *,
    exclude_booking_id: int | None = None,
    exclude_hold: str | None = None,
    now: datetime | None = None,
) -> av.ProviderCalendar:
    business = provider.business
    lo, hi = day_bounds(business, day)
    lo, hi = lo - timedelta(hours=6), hi + timedelta(hours=6)  # bookings whose buffers reach in
    breaks: dict[int, list[tuple[time, time]]] = {}
    for b in provider.breaks:
        breaks.setdefault(b.weekday, []).append((_t(b.start), _t(b.end)))
    weekly = {
        w.weekday: av.DayRule(_t(w.start), _t(w.end), tuple(breaks.get(w.weekday, ())))
        for w in provider.working_hours
    }
    overrides: dict[date, av.DayRule | None] = {}
    for o in db.scalars(select(DateOverride).where(DateOverride.provider_id == provider.id, DateOverride.date == day)):
        overrides[o.date] = av.DayRule(_t(o.start), _t(o.end)) if o.start and o.end else None

    q = select(Booking).where(
        Booking.provider_id == provider.id,
        Booking.status.in_(ACTIVE_STATUSES),
        Booking.start < hi,
        Booking.end > lo,
    )
    if exclude_booking_id:
        q = q.where(Booking.id != exclude_booking_id)
    bookings = [
        av.ExistingBooking(b.start, b.end, b.service_id, b.service.buffer_before, b.service.buffer_after)
        for b in db.scalars(q)
    ]
    time_off = [
        (t.start, t.end)
        for t in db.scalars(select(TimeOff).where(TimeOff.provider_id == provider.id, TimeOff.start < hi, TimeOff.end > lo))
    ]
    hq = select(SlotHold).where(
        SlotHold.provider_id == provider.id,
        SlotHold.expires_at > (now or now_utc()),
        SlotHold.start < hi,
        SlotHold.end > lo,
    )
    if exclude_hold:
        hq = hq.where(SlotHold.token != exclude_hold)
    holds = [(h.start, h.end) for h in db.scalars(hq)]
    return av.ProviderCalendar(business.timezone, weekly, overrides, time_off, bookings, holds)


def eligible_providers(service: Service, provider_id: int | None) -> list[Provider]:
    providers = [p for p in service.providers if p.active]
    if provider_id is not None:
        providers = [p for p in providers if p.id == provider_id]
        if not providers:
            raise HTTPException(404, "provider does not offer this service")
    return providers


@dataclass
class Slot:
    start: datetime
    end: datetime
    provider_ids: list[int]


def slots(
    db: Session, service: Service, day: date, provider_id: int | None = None, now: datetime | None = None
) -> list[Slot]:
    now = now or now_utc()
    rule = service_rule(service)
    by_start: dict[datetime, list[int]] = {}
    for p in eligible_providers(service, provider_id):
        cal = build_calendar(db, p, day, now=now)
        for s in av.slots_for_day(cal, day, rule, now, service.business.slot_step):
            by_start.setdefault(s, []).append(p.id)
    return [Slot(s, s + timedelta(minutes=service.duration), pids) for s, pids in sorted(by_start.items())]


def next_available_days(db: Session, service: Service, provider_id: int | None, days: int = 14) -> list[dict]:
    tz = ZoneInfo(service.business.timezone)
    today = now_utc().astimezone(tz).date()
    out = []
    for i in range(min(days, service.max_days_ahead + 1)):
        d = today + timedelta(days=i)
        out.append({"date": d.isoformat(), "slots": len(slots(db, service, d, provider_id))})
    return out


def _bookable(db: Session, provider: Provider, service: Service, start: datetime, **exclude) -> bool:
    tz = ZoneInfo(provider.business.timezone)
    day = start.astimezone(tz).date()
    now = now_utc()
    cal = build_calendar(db, provider, day, now=now, **exclude)
    return av.is_bookable(cal, service_rule(service), start, now, provider.business.slot_step)


def pick_provider(db: Session, service: Service, start: datetime, provider_id: int | None, **exclude) -> Provider:
    """'Any provider' = the free provider with the fewest bookings that day."""
    candidates = [p for p in eligible_providers(service, provider_id) if _bookable(db, p, service, start, **exclude)]
    if not candidates:
        raise HTTPException(409, "slot is no longer available")
    if len(candidates) == 1:
        return candidates[0]
    lo, hi = day_bounds(service.business, start.astimezone(ZoneInfo(service.business.timezone)).date())
    load = dict(
        db.execute(
            select(Booking.provider_id, func.count())
            .where(Booking.status.in_(ACTIVE_STATUSES), Booking.start >= lo, Booking.start < hi)
            .group_by(Booking.provider_id)
        ).all()
    )
    return min(candidates, key=lambda p: (load.get(p.id, 0), p.id))


# ---------------------------------------------------------------- holds
def hold(db: Session, service: Service, start: datetime, provider_id: int | None) -> SlotHold:
    with _write_lock:
        db.query(SlotHold).filter(SlotHold.expires_at <= now_utc()).delete()
        provider = pick_provider(db, service, start, provider_id)
        h = SlotHold(
            provider_id=provider.id,
            service_id=service.id,
            start=start,
            end=start + timedelta(minutes=service.duration),
            expires_at=now_utc() + timedelta(minutes=HOLD_MINUTES),
        )
        db.add(h)
        db.commit()
        return h


# ---------------------------------------------------------------- customers
def upsert_customer(db: Session, business: Business, name: str, phone: str, email: str = "") -> Customer:
    phone = normalize_phone(phone)
    c = db.scalar(select(Customer).where(Customer.business_id == business.id, Customer.phone == phone))
    if c is None:
        c = Customer(business_id=business.id, name=name, phone=phone, email=email)
        db.add(c)
        db.flush()
    else:
        if name:
            c.name = name
        if email:
            c.email = email
    return c


def normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if digits.startswith("0") and len(digits) == 10:  # Israeli mobile 05X-XXXXXXX
        digits = "+972" + digits[1:]
    return digits


# ---------------------------------------------------------------- lifecycle
def create_booking(
    db: Session,
    service: Service,
    start: datetime,
    customer: Customer,
    *,
    provider_id: int | None = None,
    hold_token: str | None = None,
    notes: str = "",
    source: str = "online",
    force_confirm: bool = False,
) -> Booking:
    with _write_lock:
        h = None
        if hold_token:
            h = db.scalar(select(SlotHold).where(SlotHold.token == hold_token))
            if h and h.expires_at > now_utc() and h.start == start and h.service_id == service.id:
                provider_id = h.provider_id
            else:
                h = None
        provider = pick_provider(db, service, start, provider_id, exclude_hold=hold_token if h else None)
        status = (
            BookingStatus.PENDING.value
            if service.requires_confirmation and not force_confirm
            else BookingStatus.CONFIRMED.value
        )
        b = Booking(
            business_id=service.business_id,
            service_id=service.id,
            provider_id=provider.id,
            customer_id=customer.id,
            start=start,
            end=start + timedelta(minutes=service.duration),
            status=status,
            price=service.price,
            notes=notes,
            source=source,
        )
        db.add(b)
        if h:
            db.delete(h)
        db.flush()
        db.refresh(b)
        if status == BookingStatus.PENDING.value:
            nt.enqueue(db, b, "pending")
        else:
            nt.enqueue(db, b, "booked")
            nt.schedule_reminders(db, b)
        if provider.email:
            nt.enqueue(db, b, "provider_new", to=provider.email)
        _mark_waitlist_booked(db, b)
        db.commit()
        return b


ALLOWED = {
    BookingStatus.PENDING.value: {"confirmed", "cancelled"},
    BookingStatus.CONFIRMED.value: {"completed", "cancelled", "no_show"},
    BookingStatus.COMPLETED.value: set(),
    BookingStatus.CANCELLED.value: set(),
    BookingStatus.NO_SHOW.value: {"completed"},
}


def transition(db: Session, b: Booking, to: str, *, by: str, reason: str = "") -> Booking:
    if to not in ALLOWED.get(b.status, set()):
        raise HTTPException(409, f"cannot move booking from {b.status} to {to}")
    with _write_lock:
        b.status = to
        if to == "confirmed":
            nt.enqueue(db, b, "confirmed")
            nt.schedule_reminders(db, b)
        elif to == "cancelled":
            b.cancellation_reason, b.cancelled_by = reason, by
            nt.cancel_pending(db, b)
            nt.enqueue(db, b, "cancelled")
            _offer_freed_slot(db, b)
        db.commit()
        return b


def customer_can_change(b: Booking) -> None:
    if b.status not in ACTIVE_STATUSES:
        raise HTTPException(409, "booking is not active")
    window = timedelta(hours=b.provider.business.cancel_window_hours)
    if b.start - now_utc() < window:
        raise HTTPException(
            409, f"changes are possible up to {b.provider.business.cancel_window_hours} hours before the appointment"
        )


def reschedule(db: Session, b: Booking, new_start: datetime, provider_id: int | None = None) -> Booking:
    with _write_lock:
        provider = pick_provider(db, b.service, new_start, provider_id or b.provider_id, exclude_booking_id=b.id)
        nt.cancel_pending(db, b)
        old_day = b.start
        b.start, b.end = new_start, new_start + timedelta(minutes=b.service.duration)
        b.provider_id = provider.id
        db.flush()
        db.refresh(b)
        nt.enqueue(db, b, "rescheduled")
        if b.status == BookingStatus.CONFIRMED.value:
            nt.schedule_reminders(db, b)
        _offer_freed_slot(db, b, freed_start=old_day)
        db.commit()
        return b


# ---------------------------------------------------------------- waitlist
def join_waitlist(db: Session, service: Service, customer: Customer, day: date, provider_id: int | None) -> WaitlistEntry:
    existing = db.scalar(
        select(WaitlistEntry).where(
            WaitlistEntry.customer_id == customer.id,
            WaitlistEntry.service_id == service.id,
            WaitlistEntry.date == day,
            WaitlistEntry.status.in_(["waiting", "notified"]),
        )
    )
    if existing:
        return existing
    e = WaitlistEntry(
        business_id=service.business_id,
        service_id=service.id,
        provider_id=provider_id,
        customer_id=customer.id,
        date=day,
    )
    db.add(e)
    db.commit()
    return e


def _offer_freed_slot(db: Session, b: Booking, freed_start: datetime | None = None) -> None:
    """A cancellation frees time: tell the people waiting for that day, in the order they joined."""
    tz = ZoneInfo(b.provider.business.timezone)
    day = (freed_start or b.start).astimezone(tz).date()
    entries = db.scalars(
        select(WaitlistEntry)
        .where(
            WaitlistEntry.service_id == b.service_id,
            WaitlistEntry.date == day,
            WaitlistEntry.status == "waiting",
            (WaitlistEntry.provider_id.is_(None)) | (WaitlistEntry.provider_id == b.provider_id),
        )
        .order_by(WaitlistEntry.created_at)
        .limit(3)
    ).all()
    for e in entries:
        e.status, e.notified_at = "notified", now_utc()
        nt.notify_text(
            db,
            b.business_id,
            e.customer.phone,
            "waitlist_offer",
            f"שלום {e.customer.name}, התפנה מקום ל{e.service.name} בתאריך {day.strftime('%d/%m')}. "
            f"מי שמזמין ראשון מקבל: {nt.PUBLIC_URL}/b/{b.provider.business.slug}?service={b.service_id}&date={day}",
        )



def offer_free_time(db: Session, business: Business, day: date, provider_ids: list[int] | None = None) -> int:
    """Tell waitlisted customers for `day` about time that is still free (up to 3 per service)."""
    sent = 0
    by_service: dict[int, int] = {}
    entries = db.scalars(
        select(WaitlistEntry)
        .where(WaitlistEntry.business_id == business.id, WaitlistEntry.date == day, WaitlistEntry.status == "waiting")
        .order_by(WaitlistEntry.created_at)
    ).all()
    free_cache: dict[tuple[int, int | None], bool] = {}
    for e in entries:
        pid = e.provider_id
        if provider_ids is not None and pid is not None and pid not in provider_ids:
            continue
        key = (e.service_id, pid)
        if key not in free_cache:
            free_cache[key] = bool(slots(db, e.service, day, pid))
        if not free_cache[key] or by_service.get(e.service_id, 0) >= 3:
            continue
        by_service[e.service_id] = by_service.get(e.service_id, 0) + 1
        e.status, e.notified_at = "notified", now_utc()
        nt.notify_text(
            db,
            business.id,
            e.customer.phone,
            "waitlist_offer",
            f"שלום {e.customer.name}, יש מקום פנוי ל{e.service.name} בתאריך {day.strftime('%d/%m')}. "
            f"מי שמזמין ראשון מקבל: {nt.PUBLIC_URL}/b/{business.slug}?service={e.service_id}&date={day}",
        )
        sent += 1
    db.commit()
    return sent

def _mark_waitlist_booked(db: Session, b: Booking) -> None:
    tz = ZoneInfo(b.provider.business.timezone)
    for e in db.scalars(
        select(WaitlistEntry).where(
            WaitlistEntry.customer_id == b.customer_id,
            WaitlistEntry.service_id == b.service_id,
            WaitlistEntry.date == b.start.astimezone(tz).date(),
            WaitlistEntry.status.in_(["waiting", "notified"]),
        )
    ):
        e.status = "booked"


# ---------------------------------------------------------------- walk-in queue
def today(business: Business) -> date:
    return now_utc().astimezone(ZoneInfo(business.timezone)).date()


def take_ticket(db: Session, business: Business, service: Service, name: str, phone: str) -> QueueTicket:
    with _write_lock:
        d = today(business)
        last = db.scalar(
            select(func.max(QueueTicket.number)).where(QueueTicket.business_id == business.id, QueueTicket.day == d)
        )
        t = QueueTicket(
            business_id=business.id,
            service_id=service.id,
            day=d,
            number=(last or 0) + 1,
            name=name,
            phone=normalize_phone(phone) if phone else "",
        )
        db.add(t)
        db.commit()
        return t


def queue_state(db: Session, business: Business) -> dict:
    d = today(business)
    tickets = db.scalars(
        select(QueueTicket).where(QueueTicket.business_id == business.id, QueueTicket.day == d).order_by(QueueTicket.number)
    ).all()
    waiting = [t for t in tickets if t.status == TicketStatus.WAITING.value]
    serving = [t for t in tickets if t.status in (TicketStatus.CALLED.value, TicketStatus.SERVING.value)]
    staff = max(1, sum(1 for p in business.providers if p.active))
    done = [t for t in tickets if t.status == TicketStatus.DONE.value and t.called_at and t.finished_at]
    if done:
        avg = sum((t.finished_at - t.called_at).total_seconds() for t in done) / len(done) / 60
    else:
        avg = None
    eta: dict[int, int] = {}
    elapsed = 0.0
    for i, t in enumerate(waiting):
        minutes = avg if avg is not None else t.service.duration
        eta[t.id] = round(elapsed / staff)
        elapsed += minutes
    return {"tickets": tickets, "waiting": waiting, "serving": serving, "eta": eta, "avg_minutes": avg}


def advance_ticket(db: Session, t: QueueTicket, to: str, provider_id: int | None = None) -> QueueTicket:
    order = {"waiting": {"called", "left"}, "called": {"serving", "left", "waiting"}, "serving": {"done"}}
    if to not in order.get(t.status, set()):
        raise HTTPException(409, f"cannot move ticket from {t.status} to {to}")
    t.status = to
    if to == "called":
        t.called_at, t.provider_id = now_utc(), provider_id
        if t.phone:
            nt.notify_text(db, t.business_id, t.phone, "queue_called", f"{t.name}, הגיע תורך! מספר {t.number}.")
    if to in ("done", "left"):
        t.finished_at = now_utc()
    db.commit()
    return t
