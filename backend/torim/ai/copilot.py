"""AI copilot for the business owner / staff.

Answers questions from live data ("who is likely to no-show tomorrow?", "how did
October compare to September?", "when is Dana free on Thursday?") and takes
actions in the calendar (book a customer, confirm a request, block time off),
always scoped to what the signed-in provider is allowed to do.
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import availability as av
from .. import booking as bk
from .. import serialize as ser
from ..models import AiConversation, Booking, Customer, Provider, Service, TimeOff, WaitlistEntry, now_utc
from . import risk
from .engine import Tool, TurnResult, enabled, run_turn

NULL_INT = {"type": ["integer", "null"]}
NULL_STR = {"type": ["string", "null"]}


class Copilot:
    def __init__(self, db: Session, me: Provider, conv: AiConversation):
        self.db, self.me, self.conv = db, me, conv
        self.b = me.business
        self.tz = ZoneInfo(self.b.timezone)
        self.owner = me.role == "owner"

    def _providers(self) -> list[Provider]:
        return list(self.b.providers) if self.owner else [self.me]

    def _scope(self, provider_id: int | None) -> int | None:
        if not self.owner:
            return self.me.id
        return provider_id

    def _iso(self, dt):
        return ser.local_iso(dt, self.b.timezone)

    def _booking(self, booking_id: int) -> Booking:
        b = self.db.get(Booking, booking_id)
        if not b or b.business_id != self.b.id or (not self.owner and b.provider_id != self.me.id):
            raise ValueError("booking not found")
        return b

    # ------------------------------------------------------------ read tools
    def list_bookings(self, date_from: str, date_to: str, provider_id: int | None, status: str | None):
        lo, _ = bk.day_bounds(self.b, date.fromisoformat(date_from))
        _, hi = bk.day_bounds(self.b, date.fromisoformat(date_to))
        q = select(Booking).where(Booking.business_id == self.b.id, Booking.start >= lo, Booking.start < hi)
        pid = self._scope(provider_id)
        if pid:
            q = q.where(Booking.provider_id == pid)
        if status:
            q = q.where(Booking.status.in_(status.split(",")))
        rows = self.db.scalars(q.order_by(Booking.start).limit(150)).all()
        return [
            {"id": b.id, "start": self._iso(b.start), "customer": b.customer.name, "phone": b.customer.phone, "service": b.service.name, "provider": b.provider.name, "status": b.status, "price": b.price}
            for b in rows
        ]

    def business_stats(self, date_from: str, date_to: str):
        lo, _ = bk.day_bounds(self.b, date.fromisoformat(date_from))
        _, hi = bk.day_bounds(self.b, date.fromisoformat(date_to))
        provs = self._providers()
        rows = self.db.scalars(
            select(Booking).where(Booking.business_id == self.b.id, Booking.start >= lo, Booking.start < hi, Booking.provider_id.in_([p.id for p in provs]))
        ).all()
        st = Counter(b.status for b in rows)
        kept = [b for b in rows if b.status in ("confirmed", "completed", "pending")]
        work = 0
        d = date.fromisoformat(date_from)
        while d <= date.fromisoformat(date_to):
            for p in provs:
                work += av.working_minutes(bk.build_calendar(self.db, p, d), d)
            d += timedelta(days=1)
        booked = sum((b.end - b.start).total_seconds() / 60 for b in kept)
        fin = st["completed"] + st["no_show"]
        return {
            "bookings": len(rows),
            "by_status": dict(st),
            "revenue_completed": sum(b.price for b in rows if b.status == "completed"),
            "utilization": round(booked / work, 3) if work else None,
            "no_show_rate": round(st["no_show"] / fin, 3) if fin else None,
            "by_service": Counter(b.service.name for b in kept).most_common(),
            "by_provider": Counter(b.provider.name for b in kept).most_common(),
            "by_hour": sorted(Counter(b.start.astimezone(self.tz).hour for b in kept).items()),
            "by_weekday": Counter(b.start.astimezone(self.tz).strftime("%A") for b in kept).most_common(),
        }

    def no_show_risks(self, date_from: str, date_to: str):
        lo, _ = bk.day_bounds(self.b, date.fromisoformat(date_from))
        _, hi = bk.day_bounds(self.b, date.fromisoformat(date_to))
        rows = risk.upcoming_risks(self.db, self.b, lo, hi)
        if not self.owner:
            mine = {b.id for b in self.db.scalars(select(Booking).where(Booking.provider_id == self.me.id))}
            rows = [r for r in rows if r["booking_id"] in mine]
        return [{**r, "start": self._iso(r["start"])} for r in rows[:20]]

    def find_customer(self, query: str):
        rows = self.db.scalars(
            select(Customer).where(Customer.business_id == self.b.id, or_(Customer.name.contains(query), Customer.phone.contains(query))).limit(10)
        ).all()
        out = []
        for c in rows:
            hist = self.db.scalars(select(Booking).where(Booking.customer_id == c.id).order_by(Booking.start.desc())).all()
            st = Counter(b.status for b in hist)
            out.append(
                {
                    "id": c.id, "name": c.name, "phone": c.phone,
                    "visits": st["completed"], "no_shows": st["no_show"], "cancellations": st["cancelled"],
                    "last": [{"start": self._iso(b.start), "service": b.service.name, "status": b.status} for b in hist[:5]],
                }
            )
        return out

    def free_slots(self, service_id: int, day: str, provider_id: int | None):
        s = self.db.get(Service, service_id)
        if not s or s.business_id != self.b.id:
            raise ValueError("service not found")
        return [{"start": self._iso(x.start), "provider_ids": x.provider_ids} for x in bk.slots(self.db, s, date.fromisoformat(day), self._scope(provider_id))]

    def waitlist(self):
        rows = self.db.scalars(
            select(WaitlistEntry).where(WaitlistEntry.business_id == self.b.id, WaitlistEntry.date >= bk.today(self.b), WaitlistEntry.status == "waiting")
        ).all()
        return [{"date": e.date.isoformat(), "service": e.service.name, "customer": e.customer.name, "phone": e.customer.phone} for e in rows]

    # ------------------------------------------------------------ write tools
    def create_booking(self, service_id: int, start: str, provider_id: int | None, customer_name: str, customer_phone: str, notes: str | None):
        s = self.db.get(Service, service_id)
        if not s or s.business_id != self.b.id:
            raise ValueError("service not found")
        dt = datetime.fromisoformat(start)
        c = bk.upsert_customer(self.db, self.b, customer_name, customer_phone)
        try:
            b = bk.create_booking(self.db, s, dt if dt.tzinfo else dt.replace(tzinfo=self.tz), c, provider_id=self._scope(provider_id), notes=notes or "", source="provider", force_confirm=True)
        except HTTPException as e:
            raise ValueError(e.detail)
        return {"id": b.id, "start": self._iso(b.start), "provider": b.provider.name, "_action": {"type": "booking", "booking": ser.booking(b)}}

    def set_booking_status(self, booking_id: int, status: str, reason: str | None):
        b = self._booking(booking_id)
        try:
            b = bk.transition(self.db, b, status, by="provider", reason=reason or "")
        except HTTPException as e:
            raise ValueError(e.detail)
        return {"id": b.id, "status": b.status, "_action": {"type": "booking", "booking": ser.booking(b)}}

    def block_time(self, start: str, end: str, reason: str | None, provider_id: int | None):
        pid = self._scope(provider_id) or self.me.id
        p = self.db.get(Provider, pid)
        if not p or p.business_id != self.b.id:
            raise ValueError("provider not found")
        s, e = datetime.fromisoformat(start), datetime.fromisoformat(end)
        s = s if s.tzinfo else s.replace(tzinfo=self.tz)
        e = e if e.tzinfo else e.replace(tzinfo=self.tz)
        if e <= s:
            raise ValueError("end must be after start")
        self.db.add(TimeOff(provider_id=p.id, start=s, end=e, reason=reason or ""))
        self.db.commit()
        clashes = self.db.scalars(
            select(Booking).where(Booking.provider_id == p.id, Booking.status.in_(["pending", "confirmed"]), Booking.start < e, Booking.end > s)
        ).all()
        return {"blocked": True, "provider": p.name, "existing_bookings_in_range": [{"id": b.id, "customer": b.customer.name, "start": self._iso(b.start)} for b in clashes]}

    def draft_reminder(self, booking_id: int):
        from . import briefing

        b = self._booking(booking_id)
        return {"booking_id": b.id, "customer": b.customer.name, **briefing.reminder_draft(self.db, b)}

    def message_customer(self, booking_id: int, message: str):
        from ..notifications import notify_text

        b = self._booking(booking_id)
        if len(message.strip()) < 5:
            raise ValueError("message too short")
        notify_text(self.db, self.b.id, b.customer.phone, "personal_reminder", message.strip())
        self.db.commit()
        return {"sent_to": b.customer.name, "channel": "whatsapp"}

    def offer_free_time(self, day: str):
        ids = None if self.owner else [self.me.id]
        return {"waitlisted_customers_notified": bk.offer_free_time(self.db, self.b, date.fromisoformat(day), ids)}

    def tools(self) -> list[Tool]:
        rng = {"date_from": {"type": "string"}, "date_to": {"type": "string"}}
        return [
            Tool("list_bookings", "Bookings in a local date range (YYYY-MM-DD, inclusive). status: optional comma list of pending,confirmed,completed,cancelled,no_show.",
                 {**rng, "provider_id": NULL_INT, "status": NULL_STR}, ["date_from", "date_to", "provider_id", "status"], self.list_bookings),
            Tool("business_stats", "KPIs for a date range: bookings, statuses, revenue, utilization, no-show rate, breakdowns by service, staff, hour and weekday.",
                 rng, ["date_from", "date_to"], self.business_stats),
            Tool("no_show_risks", "Upcoming bookings ranked by predicted no-show probability (ML model trained on this business's history), with reasons.",
                 rng, ["date_from", "date_to"], self.no_show_risks),
            Tool("find_customer", "Search customers by name or phone; returns visit history and reliability.", {"query": {"type": "string"}}, ["query"], self.find_customer),
            Tool("free_slots", "Free start times for a service on a date, optionally for one staff member.",
                 {"service_id": {"type": "integer"}, "day": {"type": "string"}, "provider_id": NULL_INT}, ["service_id", "day", "provider_id"], self.free_slots),
            Tool("waitlist", "People currently waiting for a slot.", {}, [], self.waitlist),
            Tool("create_booking", "Book a customer into a free slot (confirmed immediately, customer gets a WhatsApp confirmation).",
                 {"service_id": {"type": "integer"}, "start": {"type": "string"}, "provider_id": NULL_INT, "customer_name": {"type": "string"}, "customer_phone": {"type": "string"}, "notes": NULL_STR},
                 ["service_id", "start", "provider_id", "customer_name", "customer_phone", "notes"], self.create_booking),
            Tool("set_booking_status", "Change a booking's status: confirmed (approve a request), completed, no_show, cancelled. Cancelling notifies the customer and the waitlist.",
                 {"booking_id": {"type": "integer"}, "status": {"type": "string", "enum": ["confirmed", "completed", "no_show", "cancelled"]}, "reason": NULL_STR},
                 ["booking_id", "status", "reason"], self.set_booking_status),
            Tool("block_time", "Block a time range (vacation, errand) so no new bookings land there. Returns existing bookings that clash.",
                 {"start": {"type": "string"}, "end": {"type": "string"}, "reason": NULL_STR, "provider_id": NULL_INT},
                 ["start", "end", "reason", "provider_id"], self.block_time),
            Tool("draft_personal_reminder", "Draft a warm personal WhatsApp reminder for an upcoming booking (use for high no-show risk). Returns the text; does not send.",
                 {"booking_id": {"type": "integer"}}, ["booking_id"], self.draft_reminder),
            Tool("send_customer_message", "Send a WhatsApp message to the customer of a booking. Show the user the exact text and get a yes before sending, unless they already approved it.",
                 {"booking_id": {"type": "integer"}, "message": {"type": "string"}}, ["booking_id", "message"], self.message_customer),
            Tool("offer_free_time_to_waitlist", "Message waitlisted customers for a date (YYYY-MM-DD) about time that is still free, up to 3 per service, in join order.",
                 {"day": {"type": "string"}}, ["day"], self.offer_free_time),
        ]

    def system(self) -> str:
        services = "\n".join(f"- [{s.id}] {s.name} ({s.duration} min, {s.price:g} ILS)" for s in self.b.services)
        staff = "\n".join(f"- [{p.id}] {p.name}, {p.title}" for p in self.b.providers)
        scope = "the whole business (owner)" if self.owner else f"only {self.me.name}'s own calendar (staff member)"
        return f"""You are the operations copilot of "{self.b.name}" inside TORIM Pro. You work for {self.me.name}; your access covers {scope}.
Answer in English (or in the language the user writes in), concisely, like a sharp business manager: lead with the answer, then the 2-3 numbers that support it, then a concrete suggestion when useful. Short bullet lists are fine; no tables wider than 3 columns. Use plain punctuation (commas and periods), never an em dash.
Use tools for every fact about bookings, customers and numbers; never guess. Dates are business-local (Asia/Jerusalem).
Before cancelling bookings or blocking time that clashes with existing bookings, state what will happen and ask for confirmation, unless the user already explicitly asked for exactly that.
When you see high no-show risk, suggest a specific action, and offer to draft and send a personal reminder.
When the day has free time and people are on the waitlist, offer to message them.

Services:
{services}

Staff:
{staff}
"""

    def turn(self, text: str) -> TurnResult:
        if not enabled():
            from . import demo

            return demo.copilot_turn(self, text)
        now = now_utc().astimezone(self.tz)
        result = run_turn(
            system=self.system(),
            tools=self.tools(),
            history=self.conv.messages or [],
            user_text=f"[{now.strftime('%A %Y-%m-%d %H:%M')}]\n{text}",
            effort="high",
        )
        self.conv.messages = result.messages
        self.db.commit()
        return result


def conversation(db: Session, me: Provider, uid: str | None) -> AiConversation:
    conv = None
    if uid:
        conv = db.scalar(select(AiConversation).where(AiConversation.uid == uid, AiConversation.external_id == str(me.id), AiConversation.agent == "copilot"))
    if conv is None:
        conv = AiConversation(business_id=me.business_id, agent="copilot", channel="web", external_id=str(me.id), messages=[])
        db.add(conv)
        db.flush()
    return conv
