"""Business lifecycle: self-serve signup with AI setup, business settings, staff management."""
from __future__ import annotations

import re
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import setup as ai_setup
from ..auth import hash_password, issue_token
from ..db import get_db
from ..models import Break, Business, Provider, Service, WorkingHours
from .ai import _ai_error
from .provider import Ctx, ctx, me_payload

router = APIRouter(prefix="/api/pro", tags=["business"])

SLUG = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$")
HHMM = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
PALETTE = ["#2f6f62", "#9a6a16", "#7a3e5c", "#5b6b2f", "#9b4a2c", "#4a5a78", "#6b5b4a", "#3e6b7a"]

# ---------------------------------------------------------------- rate limit for public AI setup
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(request: Request, per_minute: int = 6) -> None:
    ip = request.client.host if request.client else "?"
    q, now = _hits[ip], time.time()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        raise HTTPException(429, "too many requests, try again in a minute")
    q.append(now)


# ---------------------------------------------------------------- schemas
class SetupIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    category: str = "other"
    description: str = Field(default="", max_length=3000)


class SetupService(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    duration: int = Field(ge=5, le=480)
    price: float = Field(ge=0)
    buffer_after: int = Field(ge=0, le=120, default=0)
    capacity: int = Field(ge=1, le=100, default=1)
    requires_confirmation: bool = False


class SetupDay(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str
    end: str
    breaks: list[list[str]] = []


class SignupIn(BaseModel):
    business_name: str = Field(min_length=2, max_length=120)
    slug: str
    category: str = "other"
    description: str = Field(default="", max_length=400)
    address: str = ""
    phone: str = ""
    accent_color: str = "#0f766e"
    owner_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=8, max_length=200)
    services: list[SetupService] = Field(min_length=1, max_length=30)
    days: list[SetupDay] = Field(min_length=1, max_length=7)


class BusinessIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=400)
    address: str = ""
    phone: str = ""
    accent_color: str = "#0f766e"
    cancel_window_hours: int = Field(ge=0, le=168)
    slot_step: int = Field(ge=5, le=60)


class StaffIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    title: str = ""
    email: str = Field(min_length=5, max_length=160)
    password: str | None = Field(default=None, min_length=8, max_length=200)
    color: str = ""
    service_ids: list[int] = []
    active: bool = True
    copy_hours: bool = True


# ---------------------------------------------------------------- helpers
def _days(p: Provider, days: list[SetupDay]) -> None:
    seen = set()
    for d in days:
        if d.weekday in seen:
            raise HTTPException(422, "each weekday may appear once")
        seen.add(d.weekday)
        if not (HHMM.match(d.start) and HHMM.match(d.end)) or d.start >= d.end:
            raise HTTPException(422, f"bad hours for weekday {d.weekday}")
        p.working_hours.append(WorkingHours(weekday=d.weekday, start=d.start, end=d.end))
        for br in d.breaks:
            if len(br) != 2 or not all(HHMM.match(x) for x in br) or not (d.start <= br[0] < br[1] <= d.end):
                raise HTTPException(422, f"bad break for weekday {d.weekday}")
            p.breaks.append(Break(weekday=d.weekday, start=br[0], end=br[1]))


def _email(db: Session, email: str, exclude: int | None = None) -> str:
    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "invalid email")
    other = db.scalar(select(Provider).where(Provider.email == email))
    if other and other.id != exclude:
        raise HTTPException(409, "email already registered")
    return email


# ---------------------------------------------------------------- signup
@router.post("/setup/suggest")
def suggest_setup(body: SetupIn, request: Request):
    """AI proposal for services + hours from a free-text description (template without a key)."""
    _rate_limit(request)
    try:
        return ai_setup.suggest(body.name, body.category, body.description)
    except Exception as exc:
        _ai_error(exc)


@router.get("/slug-available")
def slug_available(slug: str, db: Session = Depends(get_db)):
    slug = slug.strip().lower()
    return {"slug": slug, "valid": bool(SLUG.match(slug)), "available": bool(SLUG.match(slug)) and not db.scalar(select(Business.id).where(Business.slug == slug))}


@router.post("/signup", status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db)):
    slug = body.slug.strip().lower()
    if not SLUG.match(slug):
        raise HTTPException(422, "link name must be 3-40 latin letters, digits or dashes")
    if db.scalar(select(Business.id).where(Business.slug == slug)):
        raise HTTPException(409, "this link name is taken")
    email = _email(db, body.email)
    biz = Business(
        slug=slug,
        name=body.business_name.strip(),
        category=ai_setup.CATEGORIES.get(body.category, body.category)[:60],
        description=body.description.strip(),
        address=body.address.strip(),
        phone=body.phone.strip(),
        accent_color=body.accent_color if COLOR.match(body.accent_color) else "#0f766e",
    )
    owner = Provider(business=biz, name=body.owner_name.strip(), title="בעלים", email=email, password_hash=hash_password(body.password), role="owner", color=biz.accent_color)
    _days(owner, body.days)
    db.add_all([biz, owner])
    for s in body.services:
        db.add(Service(business=biz, providers=[owner], min_notice=60, max_days_ahead=30, **s.model_dump()))
    db.commit()
    db.refresh(owner)
    return {"token": issue_token("provider", owner.id, biz.id), **me_payload(owner)}


# ---------------------------------------------------------------- business settings
@router.put("/business")
def update_business(body: BusinessIn, c: Ctx = Depends(ctx)):
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    if not COLOR.match(body.accent_color):
        raise HTTPException(422, "color must be #rrggbb")
    for k, v in body.model_dump().items():
        setattr(c.business, k, v.strip() if isinstance(v, str) else v)
    c.db.commit()
    return me_payload(c.me)


# ---------------------------------------------------------------- staff
def _staff_row(p: Provider) -> dict:
    from .. import serialize as ser

    return {**ser.provider(p), "email": p.email, "weekdays": sorted(w.weekday for w in p.working_hours)}


@router.get("/staff")
def list_staff(c: Ctx = Depends(ctx)):
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    return [_staff_row(p) for p in c.business.providers]


def _assign(c: Ctx, p: Provider, service_ids: list[int]) -> None:
    p.services = [s for s in c.business.services if s.id in service_ids]


@router.post("/staff", status_code=201)
def add_staff(body: StaffIn, c: Ctx = Depends(ctx)):
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    if not body.password:
        raise HTTPException(422, "a password of at least 8 characters is required")
    used = {p.color for p in c.business.providers}
    color = body.color if COLOR.match(body.color or "") else next((x for x in PALETTE if x not in used), PALETTE[0])
    p = Provider(business_id=c.business.id, name=body.name.strip(), title=body.title.strip(), email=_email(c.db, body.email), password_hash=hash_password(body.password), role="staff", color=color)
    c.db.add(p)
    if body.copy_hours:
        for w in c.me.working_hours:
            p.working_hours.append(WorkingHours(weekday=w.weekday, start=w.start, end=w.end))
        for br in c.me.breaks:
            p.breaks.append(Break(weekday=br.weekday, start=br.start, end=br.end))
    _assign(c, p, body.service_ids)
    c.db.commit()
    c.db.refresh(c.business)
    return _staff_row(p)


@router.put("/staff/{provider_id}")
def edit_staff(provider_id: int, body: StaffIn, c: Ctx = Depends(ctx)):
    p = c.provider(provider_id)
    if not c.is_owner:
        raise HTTPException(403, "owner only")
    if p.role == "owner" and not body.active:
        raise HTTPException(422, "the owner account cannot be deactivated")
    p.name, p.title, p.active = body.name.strip(), body.title.strip(), body.active
    p.email = _email(c.db, body.email, exclude=p.id)
    if COLOR.match(body.color or ""):
        p.color = body.color
    if body.password:
        p.password_hash = hash_password(body.password)
    _assign(c, p, body.service_ids)
    c.db.commit()
    return _staff_row(p)

