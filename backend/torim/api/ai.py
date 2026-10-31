"""AI endpoints: receptionist chat, inbound messaging webhook, owner copilot, no-show risk."""
from __future__ import annotations

import os
import secrets
from datetime import date, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import booking as bk
from ..ai import copilot as cp
from ..ai import engine
from ..ai import receptionist as rc
from ..ai import briefing, risk
from ..auth import ProviderAuth, read_token
from ..db import get_db
from ..models import Booking, Business, Provider
from ..notifications import notify_text

router = APIRouter(prefix="/api", tags=["ai"])


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = None


class InboundIn(BaseModel):
    business: str  # slug
    channel: str = "whatsapp"  # whatsapp | telegram | sms
    sender: str  # phone number (WhatsApp/SMS) or chat id (Telegram)
    text: str = Field(min_length=1, max_length=2000)


def _need_ai():
    if not engine.enabled():
        raise HTTPException(503, "AI is not configured on this server (set ANTHROPIC_API_KEY)")


def _ai_error(exc: Exception):
    import anthropic

    if isinstance(exc, anthropic.RateLimitError):
        raise HTTPException(429, "AI is busy, try again in a moment")
    if isinstance(exc, anthropic.APIStatusError):
        raise HTTPException(502, f"AI service error ({exc.status_code})")
    if isinstance(exc, anthropic.APIConnectionError):
        raise HTTPException(502, "AI service unreachable")
    raise exc


@router.get("/ai/status")
def status():
    return {"enabled": engine.enabled(), "model": engine.MODEL}


@router.post("/b/{slug}/assistant")
def receptionist_chat(slug: str, body: ChatIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    _need_ai()
    b = db.scalar(select(Business).where(Business.slug == slug))
    if not b:
        raise HTTPException(404, "business not found")
    verified = ""
    if authorization and authorization.lower().startswith("bearer "):
        claims = read_token(authorization.split(" ", 1)[1])
        if claims["k"] == "customer" and claims["biz"] == b.id:
            from ..models import Customer

            c = db.get(Customer, claims["sub"])
            verified = c.phone if c else ""
    conv = rc.conversation(db, b, body.conversation_id, verified_phone=verified)
    try:
        result = rc.Receptionist(db, b, conv).turn(body.message)
    except Exception as exc:
        _ai_error(exc)
    return {"conversation_id": conv.uid, "reply": result.reply, "actions": result.actions, "tools_used": result.tool_calls}


@router.post("/webhooks/inbound")
def inbound_message(body: InboundIn, x_torim_webhook_secret: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Generic inbound-message hook. Point a WhatsApp Business / Twilio / Telegram
    bridge (or an n8n flow) here; the reply is returned and also queued in the
    outbox so the same channel adapter sends it back."""
    expected = os.environ.get("TORIM_WEBHOOK_SECRET", "")
    if expected and not secrets.compare_digest(x_torim_webhook_secret or "", expected):
        raise HTTPException(401, "bad webhook secret")
    _need_ai()
    b = db.scalar(select(Business).where(Business.slug == body.business))
    if not b:
        raise HTTPException(404, "business not found")
    phone = bk.normalize_phone(body.sender) if body.channel in ("whatsapp", "sms") else ""
    conv = rc.conversation(db, b, None, channel=body.channel, external_id=body.sender, verified_phone=phone)
    try:
        result = rc.Receptionist(db, b, conv).turn(body.text)
    except Exception as exc:
        _ai_error(exc)
    notify_text(db, b.id, body.sender, "ai_reply", result.reply)
    db.commit()
    return {"reply": result.reply, "actions": result.actions}


@router.post("/pro/copilot")
def copilot_chat(body: ChatIn, claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    _need_ai()
    me = db.get(Provider, claims["sub"])
    if not me or not me.active:
        raise HTTPException(401, "provider not found")
    conv = cp.conversation(db, me, body.conversation_id)
    try:
        result = cp.Copilot(db, me, conv).turn(body.message)
    except Exception as exc:
        _ai_error(exc)
    return {"conversation_id": conv.uid, "reply": result.reply, "actions": result.actions, "tools_used": result.tool_calls}


@router.get("/pro/risk")
def no_show_risk(start: date | None = None, days: int = 7, claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    """Works without an API key: the model is a local logistic regression."""
    me = db.get(Provider, claims["sub"])
    b = me.business
    start = start or bk.today(b)
    lo, _ = bk.day_bounds(b, start)
    _, hi = bk.day_bounds(b, start + timedelta(days=max(0, days - 1)))
    rows = risk.upcoming_risks(db, b, lo, hi)
    if me.role != "owner":
        rows = [r for r in rows if db.get(Booking, r["booking_id"]).provider_id == me.id]
    m = risk.model_for(db, b)
    from ..serialize import local_iso

    return {
        "model": {"trained_on": m.trained_on, "base_rate": round(m.base_rate, 3)},
        "bookings": [{**r, "start": local_iso(r["start"], b.timezone)} for r in rows],
    }


# ---------------------------------------------------------------- briefing & personal reminders
class ReminderIn(BaseModel):
    message: str = Field(min_length=5, max_length=1000)


def _pro(claims: dict, db: Session):
    from .provider import Ctx

    return Ctx(db, claims)


@router.get("/pro/briefing")
def morning_briefing(refresh: bool = False, claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    """Prioritized "what matters today" list. Claude writes it; rules fill in without a key."""
    c = _pro(claims, db)
    try:
        return briefing.briefing(db, c.me, refresh=refresh)
    except Exception as exc:
        _ai_error(exc)


@router.post("/pro/bookings/{booking_id}/reminder/draft")
def reminder_draft(booking_id: int, claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    c = _pro(claims, db)
    b = c.booking(booking_id)
    if b.status not in ("pending", "confirmed"):
        raise HTTPException(422, "booking is not upcoming")
    try:
        return briefing.reminder_draft(db, b)
    except Exception as exc:
        _ai_error(exc)


@router.post("/pro/bookings/{booking_id}/reminder/send")
def reminder_send(booking_id: int, body: ReminderIn, claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    c = _pro(claims, db)
    b = c.booking(booking_id)
    notify_text(db, b.business_id, b.customer.phone, "personal_reminder", body.message.strip())
    db.commit()
    return {"ok": True}


@router.post("/pro/waitlist/offer-today")
def offer_today(claims: dict = ProviderAuth, db: Session = Depends(get_db)):
    c = _pro(claims, db)
    ids = None if c.is_owner else [c.me.id]
    return {"sent": bk.offer_free_time(db, c.business, bk.today(c.business), ids)}
