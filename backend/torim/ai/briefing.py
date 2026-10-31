"""Morning briefing and personal reminders.

The briefing turns the day's raw state (agenda, approvals waiting, no-show
risk, waitlist, empty time, walk-in queue) into a short prioritized list with
one-tap actions. Claude writes it with structured output so every item maps to
a concrete action in the app; without an API key the same facts are ranked by
rules, so the panel is never empty.

Personal reminders: for a booking with a high no-show risk, Claude drafts a
short, warm WhatsApp message that fits this customer (first visit,
regular, past no-shows) and the business tone. The owner edits and sends.
"""
from __future__ import annotations

import time
from datetime import timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import booking as bk
from ..models import Booking, Provider, WaitlistEntry, now_utc
from ..notifications import manage_link
from . import engine, risk
from .engine import obj

ACTIONS = ["remind", "confirm", "offer_slot", "open_booking", "none"]

SCHEMA = obj(
    {
        "headline": {"type": "string", "description": "One short sentence: the state of the day"},
        "items": {
            "type": "array",
            "description": "At most 5 items, most important first",
            "items": obj(
                {
                    "text": {"type": "string", "description": "One sentence, specific (names, times)"},
                    "kind": {"type": "string", "enum": ["risk", "approval", "waitlist", "gap", "queue", "tip"]},
                    "action": {"type": "string", "enum": ACTIONS},
                    "booking_id": {"type": ["integer", "null"]},
                }
            ),
        },
    }
)

SYSTEM = """You are the operations assistant inside TORIM, a booking app for small Israeli service
businesses. Each morning you brief the owner (or a staff member) about their day in English. Use plain punctuation (commas and periods), never an em dash.
You get today's facts as JSON. Produce a headline and at most five items, most valuable first:
money at risk (likely no-shows, unconfirmed requests), opportunities (people on the waitlist while
there is free time, empty stretches worth filling), and one practical tip when the data supports it.
Be specific: use names and times from the data, never invent facts, and keep each item to one
sentence a busy person reads in two seconds. Choose an action per item:
remind = send the customer a personal reminder (needs booking_id),
confirm = approve a pending request (needs booking_id),
offer_slot = message waitlisted people about free time,
open_booking = open the booking (needs booking_id), none = informational.
Use booking_id only with ids that appear in the facts."""


def _facts(db: Session, me: Provider) -> dict:
    b = me.business
    tz = ZoneInfo(b.timezone)
    day = bk.today(b)
    lo, hi = bk.day_bounds(b, day)
    owner = me.role == "owner"
    provs = [p for p in b.providers if p.active and (owner or p.id == me.id)]
    pids = [p.id for p in provs]
    rows = db.scalars(
        select(Booking).where(Booking.business_id == b.id, Booking.start >= lo, Booking.start < hi, Booking.provider_id.in_(pids)).order_by(Booking.start)
    ).all()
    live = [x for x in rows if x.status in ("pending", "confirmed")]
    t = lambda dt: dt.astimezone(tz).strftime("%H:%M")  # noqa: E731

    risks = [r for r in risk.upcoming_risks(db, b, lo, hi + timedelta(days=1)) if r["level"] != "low"]
    risks = [r for r in risks if db.get(Booking, r["booking_id"]).provider_id in pids][:6]
    pending = db.scalars(
        select(Booking).where(Booking.business_id == b.id, Booking.status == "pending", Booking.start >= lo, Booking.provider_id.in_(pids)).order_by(Booking.start).limit(6)
    ).all()
    waitlist = db.scalars(
        select(WaitlistEntry).where(WaitlistEntry.business_id == b.id, WaitlistEntry.status == "waiting", WaitlistEntry.date >= day, WaitlistEntry.date <= day + timedelta(days=2))
    ).all()

    shortest = min((s for s in b.services if s.active and s.capacity == 1), key=lambda s: s.duration, default=None)
    free = []
    if shortest:
        for p in provs:
            if shortest in p.services:
                n = len(bk.slots(db, shortest, day, p.id))
                if n:
                    free.append({"provider": p.name, "free_slots_of_shortest_service": n, "service": shortest.name})
    q = bk.queue_state(db, b)
    return {
        "business": b.name,
        "viewer": {"name": me.name, "role": me.role},
        "now": now_utc().astimezone(tz).strftime("%A %d/%m %H:%M"),
        "today": {
            "bookings": len(live),
            "expected_revenue": sum(x.price for x in live),
            "first": t(live[0].start) if live else None,
            "last": t(live[-1].start) if live else None,
            "agenda": [{"id": x.id, "time": t(x.start), "customer": x.customer.name, "service": x.service.name, "provider": x.provider.name, "status": x.status} for x in live[:25]],
        },
        "no_show_risks": [
            {"booking_id": r["booking_id"], "customer": r["customer"], "when": r["start"].astimezone(tz).strftime("%d/%m %H:%M"), "probability": r["probability"], "reasons": r["reasons"]}
            for r in risks
        ],
        "pending_requests": [{"booking_id": x.id, "customer": x.customer.name, "service": x.service.name, "when": x.start.astimezone(tz).strftime("%d/%m %H:%M")} for x in pending],
        "waitlist": [{"customer": w.customer.name, "service": w.service.name, "date": w.date.isoformat()} for w in waitlist],
        "free_time_today": free,
        "walk_in_queue": {"waiting": len(q["waiting"])},
    }


def _rules(f: dict) -> dict:
    items = []
    for r in f["no_show_risks"][:2]:
        items.append({"kind": "risk", "action": "remind", "booking_id": r["booking_id"], "text": f"{r['customer']} ({r['when']}) might not show up ({round(r['probability'] * 100)}%). A personal reminder could help."})
    for p in f["pending_requests"][:2]:
        items.append({"kind": "approval", "action": "confirm", "booking_id": p["booking_id"], "text": f"{p['customer']} is waiting for approval: {p['service']}, {p['when']}."})
    if f["waitlist"] and f["free_time_today"]:
        items.append({"kind": "waitlist", "action": "offer_slot", "booking_id": None, "text": f"{len(f['waitlist'])} people are on the waitlist and there is free time today. Offer it to them."})
    for g in f["free_time_today"][:1]:
        items.append({"kind": "gap", "action": "none", "booking_id": None, "text": f"{g['provider']} has {g['free_slots_of_shortest_service']} open slots today."})
    if f["walk_in_queue"]["waiting"]:
        items.append({"kind": "queue", "action": "none", "booking_id": None, "text": f"{f['walk_in_queue']['waiting']} waiting in the walk-in queue."})
    n = f["today"]["bookings"]
    head = f"{n} appointments today, {f['today']['first']} to {f['today']['last']}." if n else "No appointments today yet."
    return {"headline": head, "items": items[:5]}


_cache: dict[tuple[int, str], tuple[float, dict]] = {}


def briefing(db: Session, me: Provider, refresh: bool = False) -> dict:
    f = _facts(db, me)
    key = (me.id, f["now"][:-6])
    hit = _cache.get(key)
    if hit and not refresh and time.time() - hit[0] < 1800:
        return hit[1]
    valid_ids = {r["booking_id"] for r in f["no_show_risks"]} | {p["booking_id"] for p in f["pending_requests"]} | {a["id"] for a in f["today"]["agenda"]}
    out = None
    if engine.enabled():
        import json

        try:
            out = engine.structured(system=SYSTEM, user_text=json.dumps(f, ensure_ascii=False, default=str), schema=SCHEMA, effort="low", max_tokens=4000)
        except engine.AIUnavailable:
            out = None
    if out is not None:
        for it in out["items"]:
            if it.get("booking_id") not in valid_ids:
                it["booking_id"] = None
                if it["action"] in ("remind", "confirm", "open_booking"):
                    it["action"] = "none"
        out = {"source": "ai", "headline": out["headline"], "items": out["items"][:5]}
    else:
        out = {"source": "rules", **_rules(f)}
    _cache[key] = (time.time(), out)
    return out


# ---------------------------------------------------------------- personal reminder
REMINDER_SCHEMA = obj({"message": {"type": "string", "description": "The WhatsApp message, 2-3 short sentences, in the language of the customer's name (English by default, Hebrew for a Hebrew name)"}})

REMINDER_SYSTEM = """You write a short personal WhatsApp reminder from a small Israeli business
to a customer with an upcoming appointment. Warm, natural and brief (2-3 sentences, at most one emoji),
in the voice of the business. Mention the service, day and time. Ask the customer to confirm by
replying, and include the manage link given to you exactly once so they can reschedule or cancel
easily. Never guilt or threaten, never mention risk scores or past no-shows directly; for a first
visit you may add a short practical detail (address) if given. Use plain punctuation (commas and periods), never an em dash."""


def reminder_draft(db: Session, booking: Booking) -> dict:
    b = booking.provider.business
    tz = ZoneInfo(b.timezone)
    local = booking.start.astimezone(tz)
    days = (local.date() - bk.today(b)).days
    when = {0: "today", 1: "tomorrow"}.get(days, local.strftime("%d/%m"))
    link = manage_link(booking)
    past = db.scalars(select(Booking).where(Booking.customer_id == booking.customer_id, Booking.start < booking.start, Booking.status.in_(["completed", "no_show"]))).all()
    if engine.enabled():
        import json

        facts = {
            "business": b.name,
            "address": b.address,
            "customer_first_name": booking.customer.name.split()[0],
            "service": booking.service.name,
            "provider": booking.provider.name,
            "day": when,
            "time": local.strftime("%H:%M"),
            "first_visit": not past,
            "visits_before": len(past),
            "manage_link": link,
        }
        try:
            msg = engine.structured(system=REMINDER_SYSTEM, user_text=json.dumps(facts, ensure_ascii=False), schema=REMINDER_SCHEMA, effort="low", max_tokens=2000)["message"]
        except engine.AIUnavailable:
            msg = None
        if msg:
            if link not in msg:
                msg = f"{msg}\n{link}"
            return {"source": "ai", "message": msg}
    first = booking.customer.name.split()[0]
    msg = f"Hi {first}, a reminder that you're booked {when} at {local.strftime('%H:%M')} for {booking.service.name} at {b.name}. Reply to confirm, or change or cancel here: {link}"
    return {"source": "template", "message": msg}

