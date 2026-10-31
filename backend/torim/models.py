"""Data model: businesses, staff, services, schedules, bookings, holds,
waitlist, walk-in queue tickets, notifications and AI conversations."""
from __future__ import annotations

import secrets
import uuid
from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Table,
    Column,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, UTCDateTime


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_uid() -> str:
    return uuid.uuid4().hex[:12]


def new_token() -> str:
    return secrets.token_urlsafe(24)


class BookingStatus(str, Enum):
    PENDING = "pending"  # waiting for provider confirmation
    CONFIRMED = "confirmed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


ACTIVE_STATUSES = (BookingStatus.PENDING.value, BookingStatus.CONFIRMED.value)


class TicketStatus(str, Enum):
    WAITING = "waiting"
    CALLED = "called"
    SERVING = "serving"
    DONE = "done"
    LEFT = "left"


provider_services = Table(
    "provider_services",
    Base.metadata,
    Column("provider_id", ForeignKey("providers.id", ondelete="CASCADE"), primary_key=True),
    Column("service_id", ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
)


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(60), default="general")
    description: Mapped[str] = mapped_column(Text, default="")
    address: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(30), default="")
    timezone: Mapped[str] = mapped_column(String(60), default="Asia/Jerusalem")
    slot_step: Mapped[int] = mapped_column(Integer, default=15)
    cancel_window_hours: Mapped[int] = mapped_column(Integer, default=3)
    accent_color: Mapped[str] = mapped_column(String(9), default="#0f766e")

    providers: Mapped[list["Provider"]] = relationship(back_populates="business")
    services: Mapped[list["Service"]] = relationship(back_populates="business")


class Provider(Base):
    __tablename__ = "providers"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(160), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="staff")  # owner | staff
    color: Mapped[str] = mapped_column(String(9), default="#0f766e")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    business: Mapped[Business] = relationship(back_populates="providers")
    services: Mapped[list["Service"]] = relationship(secondary=provider_services, back_populates="providers")
    working_hours: Mapped[list["WorkingHours"]] = relationship(cascade="all, delete-orphan")
    breaks: Mapped[list["Break"]] = relationship(cascade="all, delete-orphan")
    overrides: Mapped[list["DateOverride"]] = relationship(cascade="all, delete-orphan")
    time_off: Mapped[list["TimeOff"]] = relationship(cascade="all, delete-orphan")


class Service(Base):
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    duration: Mapped[int] = mapped_column(Integer)  # minutes
    price: Mapped[float] = mapped_column(Float, default=0)
    buffer_before: Mapped[int] = mapped_column(Integer, default=0)
    buffer_after: Mapped[int] = mapped_column(Integer, default=0)
    min_notice: Mapped[int] = mapped_column(Integer, default=60)  # minutes
    max_days_ahead: Mapped[int] = mapped_column(Integer, default=30)
    capacity: Mapped[int] = mapped_column(Integer, default=1)  # >1 = group session
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    business: Mapped[Business] = relationship(back_populates="services")
    providers: Mapped[list[Provider]] = relationship(secondary=provider_services, back_populates="services")


class WorkingHours(Base):
    __tablename__ = "working_hours"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = Monday
    start: Mapped[str] = mapped_column(String(5))  # "HH:MM" local time
    end: Mapped[str] = mapped_column(String(5))
    __table_args__ = (UniqueConstraint("provider_id", "weekday"),)


class Break(Base):
    __tablename__ = "breaks"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)
    start: Mapped[str] = mapped_column(String(5))
    end: Mapped[str] = mapped_column(String(5))


class DateOverride(Base):
    """Replaces the weekly plan for one date. start/end empty = day off."""

    __tablename__ = "date_overrides"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    end: Mapped[str | None] = mapped_column(String(5), nullable=True)
    __table_args__ = (UniqueConstraint("provider_id", "date"),)


class TimeOff(Base):
    __tablename__ = "time_off"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    start: Mapped[datetime] = mapped_column(UTCDateTime)
    end: Mapped[datetime] = mapped_column(UTCDateTime)
    reason: Mapped[str] = mapped_column(String(200), default="")


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30))
    email: Mapped[str] = mapped_column(String(160), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    __table_args__ = (UniqueConstraint("business_id", "phone"),)


class Booking(Base):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(20), unique=True, default=new_uid)
    manage_token: Mapped[str] = mapped_column(String(64), default=new_token)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    start: Mapped[datetime] = mapped_column(UTCDateTime)
    end: Mapped[datetime] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(20), default=BookingStatus.CONFIRMED.value)
    price: Mapped[float] = mapped_column(Float, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(20), default="online")  # online | provider | waitlist
    cancellation_reason: Mapped[str] = mapped_column(String(300), default="")
    cancelled_by: Mapped[str] = mapped_column(String(20), default="")
    rescheduled_from: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc, onupdate=now_utc)

    service: Mapped[Service] = relationship()
    provider: Mapped[Provider] = relationship()
    customer: Mapped[Customer] = relationship()

    __table_args__ = (Index("ix_booking_provider_start", "provider_id", "start"),)


class SlotHold(Base):
    """A short reservation while the customer fills in the booking form."""

    __tablename__ = "slot_holds"
    id: Mapped[int] = mapped_column(primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, default=new_token)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id", ondelete="CASCADE"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    start: Mapped[datetime] = mapped_column(UTCDateTime)
    end: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class WaitlistEntry(Base):
    __tablename__ = "waitlist"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"))
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"), nullable=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="waiting")  # waiting | notified | booked | removed
    notified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)

    service: Mapped[Service] = relationship()
    customer: Mapped[Customer] = relationship()


class QueueTicket(Base):
    """Walk-in queue: a ticket number for today, served in order."""

    __tablename__ = "queue_tickets"
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(20), unique=True, default=new_uid)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id"))
    provider_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"), nullable=True)
    day: Mapped[date] = mapped_column(Date)
    number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(30), default="")
    status: Mapped[str] = mapped_column(String(20), default=TicketStatus.WAITING.value)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    called_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    service: Mapped[Service] = relationship()
    __table_args__ = (UniqueConstraint("business_id", "day", "number"),)


class Notification(Base):
    """Outbox. A dispatcher sends due rows through a channel adapter."""

    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    booking_id: Mapped[int | None] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="whatsapp")
    to: Mapped[str] = mapped_column(String(60))
    kind: Mapped[str] = mapped_column(String(40))
    body: Mapped[str] = mapped_column(Text)
    send_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued | sent | cancelled | failed
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class OtpCode(Base):
    __tablename__ = "otp_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    phone: Mapped[str] = mapped_column(String(30))
    code: Mapped[str] = mapped_column(String(10))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class AiConversation(Base):
    """One agent conversation. `messages` is the append-only Messages API history."""

    __tablename__ = "ai_conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(40), unique=True, default=new_token)
    business_id: Mapped[int] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    agent: Mapped[str] = mapped_column(String(20))  # receptionist | copilot
    channel: Mapped[str] = mapped_column(String(20), default="web")  # web | whatsapp | telegram
    external_id: Mapped[str] = mapped_column(String(80), default="")  # phone / chat id / provider id
    verified_phone: Mapped[str] = mapped_column(String(30), default="")
    messages: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now_utc, onupdate=now_utc)
