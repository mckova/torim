"""AI receptionist: books, moves and cancels appointments in a natural conversation.

Runs on the web chat in the client app and on inbound WhatsApp / Telegram
messages (via the generic webhook). Every action goes through the same booking
engine as the regular UI, so availability, holds, buffers and the double-booking
guard all still apply. The model can only see or change bookings that belong to
the phone number the conversation is verified for.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import booking as bk
from .. import serialize as ser
from ..models import AiConversation, Booking, Business, Customer, Service, now_utc
from .engine import Tool, TurnResult, run_turn

NULL_INT = {"type": ["integer", "null"]}
NULL_STR = {"type": ["string", "null"]}


def system_prompt(b: Business) -> str:
    services = "\n".join(
        f"- [{s.id}] {s.name}: {s.duration} min, {s.price:g} ILS"
        + (f", group of up to {s.capacity}" if s.capacity > 1 else "")
        + (", needs the business to approve" if s.requires_confirmation else "")
        + (f". {s.description}" if s.description else "")
        for s in b.services
        if s.active
    )
    staff = "\n".join(f"- [{p.id}] {p.name} ({p.title})" for p in b.providers if p.active)
    return f"""You are the virtual receptionist of "{b.name}" ({b.category}), {b.address}, phone {b.phone}.
You talk with customers in English, or in the customer's own language when they write in another one (Hebrew is common), in a warm, short, WhatsApp-style tone. No markdown tables. Use plain punctuation (commas and periods), never an em dash.

What you can do with your tools: find free times, book, look up the customer's bookings, reschedule, cancel, and add the customer to the waitlist for a full day.

How to work:
- Always use find_available_slots before offering times. Never invent availability. Offer 3-4 concrete options, not a long list.
- Before book_appointment, confirm service, date, time and (if relevant) staff member with the customer, and make sure you have their name and mobile number.
- Times you send to tools are ISO 8601 with the offset exactly as find_available_slots returned them.
- If a day is full, suggest the nearest days with availability, and offer the waitlist.
- Cancelling and rescheduling are allowed up to {b.cancel_window_hours} hours before the appointment. Confirm with the customer before cancelling.
- You can only see bookings of a verified phone number. If get_my_bookings says the phone is not verified, ask the customer to use the link in their confirmation message instead.
- If asked something you cannot do (prices not listed, medical advice, complaints), say so and give the business phone number.
- Business hours, services and staff below are facts; anything else comes from tools.

Services (id in brackets):
{services}

Staff:
{staff}
"""


class Receptionist:
    def __init__(self, db: Session, business: Business, conv: AiConversation):
        self.db, self.b, self.conv = db, business, conv
        self.tz = ZoneInfo(business.timezone)

    # ------------------------------------------------------------ helpers
    def _service(self, service_id: int) -> Service:
        s = self.db.get(Service, service_id)
        if not s or s.business_id != self.b.id or not s.active:
            raise ValueError(f"no active service with id {service_id}")
        return s

    def _mine(self, uid: str) -> Booking:
        if not self.conv.verified_phone:
            raise ValueError("phone not verified in this conversation")
        b = self.db.scalar(select(Booking).where(Booking.uid == uid, Booking.business_id == self.b.id))
        if not b or b.customer.phone != self.conv.verified_phone:
            raise ValueError("no such booking for this customer")
        return b

    def _iso(self, dt: datetime) -> str:
        return ser.local_iso(dt, self.b.timezone)

    # ------------------------------------------------------------ tools
    def find_available_slots(self, service_id: int, date_from: str, days: int | None, provider_id: int | None):
        s = self._service(service_id)
        start = date.fromisoformat(date_from)
        out = []
        for i in range(min(max(days or 1, 1), 7)):
            d = start + timedelta(days=i)
            slots = bk.slots(self.db, s, d, provider_id)
            if slots:
                out.append(
                    {
                        "date": d.isoformat(),
                        "weekday": d.strftime("%A"),
                        "slots": [
                            {"start": self._iso(x.start), "provider_ids": x.provider_ids} for x in slots[:24]
                        ],
                        "more": max(0, len(slots) - 24),
                    }
                )
        return {"service": s.name, "duration_min": s.duration, "days": out or "no availability in this range"}

    def book_appointment(self, service_id: int, start: str, provider_id: int | None, name: str, phone: str, notes: str | None):
        s = self._service(service_id)
        dt = datetime.fromisoformat(start)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=self.tz)
        customer = bk.upsert_customer(self.db, self.b, name, phone)
        try:
            b = bk.create_booking(self.db, s, dt, customer, provider_id=provider_id, notes=notes or "", source="ai")
        except HTTPException as e:
            raise ValueError(e.detail)
        if not self.conv.verified_phone and self.conv.channel == "web":
            # the person who just booked on this device may manage that booking here
            self.conv.verified_phone = customer.phone
        data = ser.booking(b, with_token=True)
        return {
            "status": b.status,
            "uid": b.uid,
            "start": data["start"],
            "provider": b.provider.name,
            "service": s.name,
            "manage_link_sent": True,
            "_action": {"type": "booking", "booking": data},
        }

    def get_my_bookings(self):
        if not self.conv.verified_phone:
            return {"error": "phone not verified"}
        c = self.db.scalar(
            select(Customer).where(Customer.business_id == self.b.id, Customer.phone == self.conv.verified_phone)
        )
        if not c:
            return {"bookings": []}
        rows = self.db.scalars(
            select(Booking)
            .where(Booking.customer_id == c.id, Booking.status.in_(["pending", "confirmed"]), Booking.end >= now_utc())
            .order_by(Booking.start)
        ).all()
        return {
            "customer": c.name,
            "bookings": [
                {"uid": b.uid, "service": b.service.name, "service_id": b.service_id, "start": self._iso(b.start), "provider": b.provider.name, "status": b.status}
                for b in rows
            ],
        }

    def reschedule_booking(self, uid: str, new_start: str):
        b = self._mine(uid)
        try:
            bk.customer_can_change(b)
            dt = datetime.fromisoformat(new_start)
            b = bk.reschedule(self.db, b, dt if dt.tzinfo else dt.replace(tzinfo=self.tz))
        except HTTPException as e:
            raise ValueError(e.detail)
        return {"uid": b.uid, "start": self._iso(b.start), "provider": b.provider.name, "_action": {"type": "booking", "booking": ser.booking(b, with_token=True)}}

    def cancel_booking(self, uid: str, reason: str | None):
        b = self._mine(uid)
        try:
            bk.customer_can_change(b)
            b = bk.transition(self.db, b, "cancelled", by="customer", reason=reason or "via AI receptionist")
        except HTTPException as e:
            raise ValueError(e.detail)
        return {"uid": b.uid, "status": b.status, "_action": {"type": "booking", "booking": ser.booking(b)}}

    def join_waitlist(self, service_id: int, day: str, provider_id: int | None, name: str, phone: str):
        s = self._service(service_id)
        c = bk.upsert_customer(self.db, self.b, name, phone)
        e = bk.join_waitlist(self.db, s, c, date.fromisoformat(day), provider_id)
        return {"waitlist_id": e.id, "date": day, "status": e.status}

    def tools(self) -> list[Tool]:
        return [
            Tool(
                "find_available_slots",
                "Free start times for a service, from date_from (YYYY-MM-DD, business local date) for `days` days (1-7). "
                "Optionally only for one staff member. Returns ISO start times with offset and which staff are free.",
                {"service_id": {"type": "integer"}, "date_from": {"type": "string"}, "days": NULL_INT, "provider_id": NULL_INT},
                ["service_id", "date_from", "days", "provider_id"],
                self.find_available_slots,
            ),
            Tool(
                "book_appointment",
                "Book a confirmed time. Call only after the customer agreed to the exact time. provider_id null = any free staff member. "
                "Sends a WhatsApp confirmation with a manage link to the phone.",
                {
                    "service_id": {"type": "integer"},
                    "start": {"type": "string", "description": "ISO start exactly as returned by find_available_slots"},
                    "provider_id": NULL_INT,
                    "name": {"type": "string"},
                    "phone": {"type": "string"},
                    "notes": NULL_STR,
                },
                ["service_id", "start", "provider_id", "name", "phone", "notes"],
                self.book_appointment,
            ),
            Tool("get_my_bookings", "Upcoming bookings of the verified customer in this conversation.", {}, [], self.get_my_bookings),
            Tool(
                "reschedule_booking",
                "Move one of the customer's bookings (uid from get_my_bookings) to a new free start time.",
                {"uid": {"type": "string"}, "new_start": {"type": "string"}},
                ["uid", "new_start"],
                self.reschedule_booking,
            ),
            Tool(
                "cancel_booking",
                "Cancel one of the customer's bookings after they confirmed they want to cancel.",
                {"uid": {"type": "string"}, "reason": NULL_STR},
                ["uid", "reason"],
                self.cancel_booking,
            ),
            Tool(
                "join_waitlist",
                "Put the customer on the waitlist for a full day; they get a message if a slot opens.",
                {"service_id": {"type": "integer"}, "day": {"type": "string"}, "provider_id": NULL_INT, "name": {"type": "string"}, "phone": {"type": "string"}},
                ["service_id", "day", "provider_id", "name", "phone"],
                self.join_waitlist,
            ),
        ]

    def turn(self, text: str) -> TurnResult:
        now = now_utc().astimezone(self.tz)
        stamped = f"[{now.strftime('%A %Y-%m-%d %H:%M')} Israel time]\n{text}"
        result = run_turn(
            system=system_prompt(self.b),
            tools=self.tools(),
            history=self.conv.messages or [],
            user_text=stamped,
            effort="medium",
        )
        self.conv.messages = result.messages
        self.db.commit()
        return result


def conversation(db: Session, business: Business, uid: str | None, channel: str = "web", external_id: str = "", verified_phone: str = "") -> AiConversation:
    conv = None
    if uid:
        conv = db.scalar(select(AiConversation).where(AiConversation.uid == uid, AiConversation.business_id == business.id))
    elif external_id:
        conv = db.scalar(
            select(AiConversation).where(
                AiConversation.business_id == business.id,
                AiConversation.channel == channel,
                AiConversation.external_id == external_id,
                AiConversation.agent == "receptionist",
            )
        )
    if conv is None:
        conv = AiConversation(business_id=business.id, agent="receptionist", channel=channel, external_id=external_id, verified_phone=verified_phone, messages=[])
        db.add(conv)
        db.flush()
    elif verified_phone and not conv.verified_phone:
        conv.verified_phone = verified_phone
    return conv
