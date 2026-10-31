from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .models import Booking, Business, Provider, QueueTicket, Service


def local_iso(dt: datetime | None, tz: str) -> str | None:
    return dt.astimezone(ZoneInfo(tz)).isoformat() if dt else None


def business(b: Business) -> dict:
    return {
        "id": b.id,
        "slug": b.slug,
        "name": b.name,
        "category": b.category,
        "description": b.description,
        "address": b.address,
        "phone": b.phone,
        "timezone": b.timezone,
        "cancel_window_hours": b.cancel_window_hours,
        "accent_color": b.accent_color,
    }


def provider(p: Provider) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "title": p.title,
        "color": p.color,
        "role": p.role,
        "active": p.active,
        "service_ids": [s.id for s in p.services],
    }


def service(s: Service) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "duration": s.duration,
        "price": s.price,
        "buffer_before": s.buffer_before,
        "buffer_after": s.buffer_after,
        "min_notice": s.min_notice,
        "max_days_ahead": s.max_days_ahead,
        "capacity": s.capacity,
        "requires_confirmation": s.requires_confirmation,
        "active": s.active,
        "provider_ids": [p.id for p in s.providers if p.active],
    }


def booking(b: Booking, *, with_token: bool = False) -> dict:
    tz = b.provider.business.timezone
    out = {
        "id": b.id,
        "uid": b.uid,
        "status": b.status,
        "start": local_iso(b.start, tz),
        "end": local_iso(b.end, tz),
        "price": b.price,
        "notes": b.notes,
        "source": b.source,
        "cancellation_reason": b.cancellation_reason,
        "cancelled_by": b.cancelled_by,
        "service": {"id": b.service.id, "name": b.service.name, "duration": b.service.duration},
        "provider": {"id": b.provider.id, "name": b.provider.name, "color": b.provider.color},
        "customer": {"id": b.customer.id, "name": b.customer.name, "phone": b.customer.phone},
        "business": {"slug": b.provider.business.slug, "name": b.provider.business.name},
        "created_at": local_iso(b.created_at, tz),
    }
    if with_token:
        out["manage_token"] = b.manage_token
    return out


def ticket(t: QueueTicket, tz: str, position: int | None = None, eta: int | None = None) -> dict:
    return {
        "id": t.id,
        "uid": t.uid,
        "number": t.number,
        "name": t.name,
        "status": t.status,
        "service": {"id": t.service.id, "name": t.service.name},
        "provider_id": t.provider_id,
        "created_at": local_iso(t.created_at, tz),
        "called_at": local_iso(t.called_at, tz),
        "position": position,
        "eta_minutes": eta,
    }
