"""Customer-facing API: browse, find slots, book, manage, waitlist, walk-in queue."""
from __future__ import annotations

import os
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import booking as bk
from .. import serialize as ser
from ..auth import CustomerAuth, issue_token
from ..db import get_db
from ..models import Booking, Business, Customer, OtpCode, QueueTicket, Service, now_utc
from ..schemas import BookingIn, HoldIn, ManageIn, OtpIn, OtpVerifyIn, RescheduleIn, TicketIn, WaitlistIn
from ..notifications import notify_text

router = APIRouter(prefix="/api", tags=["public"])


def get_business(slug: str, db: Session) -> Business:
    b = db.scalar(select(Business).where(Business.slug == slug))
    if not b:
        raise HTTPException(404, "business not found")
    return b


def get_service(b: Business, service_id: int, db: Session) -> Service:
    s = db.get(Service, service_id)
    if not s or s.business_id != b.id or not s.active:
        raise HTTPException(404, "service not found")
    return s


@router.get("/businesses")
def list_businesses(db: Session = Depends(get_db)):
    return [ser.business(b) for b in db.scalars(select(Business).order_by(Business.id))]


@router.get("/b/{slug}")
def business_page(slug: str, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    return {
        "business": ser.business(b),
        "services": [ser.service(s) for s in b.services if s.active],
        "providers": [ser.provider(p) for p in b.providers if p.active],
    }


@router.get("/b/{slug}/days")
def available_days(slug: str, service_id: int, provider_id: int | None = None, days: int = 14, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    return bk.next_available_days(db, get_service(b, service_id, db), provider_id, min(days, 31))


@router.get("/b/{slug}/slots")
def available_slots(slug: str, service_id: int, date: date, provider_id: int | None = None, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    s = get_service(b, service_id, db)
    return [
        {"start": ser.local_iso(x.start, b.timezone), "end": ser.local_iso(x.end, b.timezone), "provider_ids": x.provider_ids}
        for x in bk.slots(db, s, date, provider_id)
    ]


@router.post("/b/{slug}/holds")
def hold_slot(slug: str, body: HoldIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    h = bk.hold(db, get_service(b, body.service_id, db), body.start, body.provider_id)
    return {"token": h.token, "provider_id": h.provider_id, "expires_at": ser.local_iso(h.expires_at, b.timezone)}


@router.post("/b/{slug}/bookings", status_code=201)
def book(slug: str, body: BookingIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    s = get_service(b, body.service_id, db)
    customer = bk.upsert_customer(db, b, body.name, body.phone, body.email)
    booking = bk.create_booking(
        db, s, body.start, customer, provider_id=body.provider_id, hold_token=body.hold_token, notes=body.notes
    )
    return ser.booking(booking, with_token=True)


def _managed(uid: str, token: str, db: Session) -> Booking:
    b = db.scalar(select(Booking).where(Booking.uid == uid))
    if not b or not secrets.compare_digest(b.manage_token, token or ""):
        raise HTTPException(404, "booking not found")
    return b


@router.get("/manage/{uid}")
def manage_view(uid: str, t: str, db: Session = Depends(get_db)):
    return ser.booking(_managed(uid, t, db), with_token=True)


@router.post("/manage/{uid}/cancel")
def manage_cancel(uid: str, body: ManageIn, db: Session = Depends(get_db)):
    b = _managed(uid, body.t, db)
    bk.customer_can_change(b)
    return ser.booking(bk.transition(db, b, "cancelled", by="customer", reason=body.reason))


@router.post("/manage/{uid}/reschedule")
def manage_reschedule(uid: str, body: RescheduleIn, db: Session = Depends(get_db)):
    b = _managed(uid, body.t, db)
    bk.customer_can_change(b)
    return ser.booking(bk.reschedule(db, b, body.start, body.provider_id), with_token=True)


@router.post("/b/{slug}/waitlist", status_code=201)
def waitlist(slug: str, body: WaitlistIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    s = get_service(b, body.service_id, db)
    c = bk.upsert_customer(db, b, body.name, body.phone)
    e = bk.join_waitlist(db, s, c, body.date, body.provider_id)
    ahead = sum(
        1
        for x in db.scalars(select(type(e)).where(type(e).service_id == s.id, type(e).date == body.date, type(e).status == "waiting"))
        if x.created_at < e.created_at
    )
    return {"id": e.id, "status": e.status, "date": e.date.isoformat(), "ahead_of_you": ahead}


# ---------------------------------------------------------------- walk-in queue
@router.get("/b/{slug}/queue")
def queue_board(slug: str, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    st = bk.queue_state(db, b)
    return {
        "now_serving": [{"number": t.number, "status": t.status} for t in st["serving"]],
        "waiting_count": len(st["waiting"]),
        "next_eta_minutes": round(st["avg_minutes"] or 0) or None,
    }


@router.post("/b/{slug}/queue", status_code=201)
def take_ticket(slug: str, body: TicketIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    t = bk.take_ticket(db, b, get_service(b, body.service_id, db), body.name, body.phone)
    return ticket_status(t.uid, db)


@router.get("/queue/{uid}")
def ticket_status(uid: str, db: Session = Depends(get_db)):
    t = db.scalar(select(QueueTicket).where(QueueTicket.uid == uid))
    if not t:
        raise HTTPException(404, "ticket not found")
    b = db.get(Business, t.business_id)
    st = bk.queue_state(db, b)
    ids = [x.id for x in st["waiting"]]
    pos = ids.index(t.id) + 1 if t.id in ids else None
    return ser.ticket(t, b.timezone, pos, st["eta"].get(t.id))


@router.post("/queue/{uid}/leave")
def leave_queue(uid: str, db: Session = Depends(get_db)):
    t = db.scalar(select(QueueTicket).where(QueueTicket.uid == uid))
    if not t:
        raise HTTPException(404, "ticket not found")
    bk.advance_ticket(db, t, "left")
    return ticket_status(uid, db)


# ---------------------------------------------------------------- customer sign-in (phone + OTP)
@router.post("/b/{slug}/otp")
def request_otp(slug: str, body: OtpIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    phone = bk.normalize_phone(body.phone)
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(OtpCode(business_id=b.id, phone=phone, code=code, expires_at=now_utc() + timedelta(minutes=10)))
    notify_text(db, b.id, phone, "otp", f"Your sign-in code for {b.name}: {code}")
    db.commit()
    out = {"sent": True}
    if os.environ.get("TORIM_DEV_OTP", "1") == "1":
        out["dev_code"] = code
    return out


@router.post("/b/{slug}/otp/verify")
def verify_otp(slug: str, body: OtpVerifyIn, db: Session = Depends(get_db)):
    b = get_business(slug, db)
    phone = bk.normalize_phone(body.phone)
    otp = db.scalar(
        select(OtpCode)
        .where(OtpCode.business_id == b.id, OtpCode.phone == phone, OtpCode.used.is_(False), OtpCode.expires_at > now_utc())
        .order_by(OtpCode.id.desc())
    )
    if not otp or not secrets.compare_digest(otp.code, body.code.strip()):
        raise HTTPException(401, "wrong or expired code")
    otp.used = True
    c = db.scalar(select(Customer).where(Customer.business_id == b.id, Customer.phone == phone))
    if not c:
        c = Customer(business_id=b.id, name="", phone=phone)
        db.add(c)
    db.commit()
    return {"token": issue_token("customer", c.id, b.id), "customer": {"id": c.id, "name": c.name, "phone": c.phone}}


@router.get("/me/bookings")
def my_bookings(claims: dict = CustomerAuth, db: Session = Depends(get_db)):
    rows = db.scalars(select(Booking).where(Booking.customer_id == claims["sub"]).order_by(Booking.start.desc())).all()
    now = now_utc()
    upcoming = [ser.booking(b, with_token=True) for b in reversed(rows) if b.end >= now and b.status in ("pending", "confirmed")]
    past = [ser.booking(b) for b in rows if not (b.end >= now and b.status in ("pending", "confirmed"))]
    return {"upcoming": upcoming, "past": past}
