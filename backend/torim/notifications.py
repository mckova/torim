"""Notification outbox, message templates and channel adapters.

Rows are written in the same transaction as the booking change that caused
them (transactional outbox), so a message is never sent for a booking that
rolled back. A background dispatcher sends rows whose `send_at` has passed.

Channels: `console` (default, logs), `webhook` (POSTs JSON to
TORIM_WEBHOOK_URL, which is how n8n / Make / a WhatsApp Business gateway or a
Telegram bot plugs in).
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .models import Booking, Notification, now_utc

log = logging.getLogger("torim.notify")
PUBLIC_URL = os.environ.get("TORIM_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:5173"

REMINDERS = (("reminder_24h", timedelta(hours=24)), ("reminder_2h", timedelta(hours=2)))


def _local(booking: Booking) -> str:
    tz = ZoneInfo(booking.provider.business.timezone)
    return booking.start.astimezone(tz).strftime("%d/%m %H:%M")


def manage_link(booking: Booking) -> str:
    return f"{PUBLIC_URL}/manage/{booking.uid}?t={booking.manage_token}"


TEMPLATES = {
    "booked": "Hi {name}, you're booked for {service} with {provider} on {when}. Manage it here: {link}",
    "pending": "Hi {name}, we got your request for {service} on {when}. It's waiting for approval and we'll update you soon.",
    "confirmed": "Hi {name}, your {service} on {when} is confirmed. Manage it here: {link}",
    "cancelled": "Hi {name}, your {service} on {when} was cancelled.",
    "rescheduled": "Hi {name}, your appointment moved to {when} ({service} with {provider}). {link}",
    "reminder_24h": "Reminder: tomorrow at {when} you have {service} with {provider}. To change or cancel: {link}",
    "reminder_2h": "Reminder: your {service} is in two hours ({when}). See you soon!",
    "provider_new": "New booking: {name}, {service}, {when}.",
}


def render(kind: str, booking: Booking) -> str:
    return TEMPLATES[kind].format(
        name=booking.customer.name,
        service=booking.service.name,
        provider=booking.provider.name,
        when=_local(booking),
        link=manage_link(booking),
    )


def enqueue(db: Session, booking: Booking, kind: str, send_at: datetime | None = None, to: str | None = None) -> None:
    db.add(
        Notification(
            business_id=booking.business_id,
            booking_id=booking.id,
            to=to or booking.customer.phone,
            kind=kind,
            body=render(kind, booking),
            send_at=send_at or now_utc(),
        )
    )


def schedule_reminders(db: Session, booking: Booking) -> None:
    now = now_utc()
    for kind, before in REMINDERS:
        at = booking.start - before
        if at > now:
            enqueue(db, booking, kind, send_at=at)


def cancel_pending(db: Session, booking: Booking) -> None:
    """Drop reminders that have not been sent yet (on cancel / reschedule)."""
    db.execute(
        update(Notification)
        .where(
            Notification.booking_id == booking.id,
            Notification.status == "queued",
            Notification.kind.in_([k for k, _ in REMINDERS]),
        )
        .values(status="cancelled")
    )


def notify_text(db: Session, business_id: int, to: str, kind: str, body: str) -> None:
    db.add(Notification(business_id=business_id, to=to, kind=kind, body=body))


# ---------------------------------------------------------------- dispatch
def send(n: Notification) -> None:
    channel = os.environ.get("TORIM_CHANNEL", "console")
    if channel == "webhook" and os.environ.get("TORIM_WEBHOOK_URL"):
        data = json.dumps({"to": n.to, "kind": n.kind, "body": n.body, "channel": n.channel}).encode()
        req = urllib.request.Request(
            os.environ["TORIM_WEBHOOK_URL"], data=data, headers={"Content-Type": "application/json"}
        )
        urllib.request.urlopen(req, timeout=10).read()
    else:
        log.info("[%s -> %s] %s", n.kind, n.to, n.body)


def dispatch_due(db: Session, now: datetime | None = None, limit: int = 100) -> int:
    now = now or now_utc()
    due = db.scalars(
        select(Notification)
        .where(Notification.status == "queued", Notification.send_at <= now)
        .order_by(Notification.send_at)
        .limit(limit)
    ).all()
    for n in due:
        try:
            send(n)
            n.status, n.sent_at = "sent", now
        except Exception as exc:  # keep the outbox moving
            n.status = "failed"
            n.meta = {**(n.meta or {}), "error": str(exc)}
    db.commit()
    return len(due)
