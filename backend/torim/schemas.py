from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator


class _Aware(BaseModel):
    @field_validator("start", check_fields=False)
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("start must include a UTC offset, e.g. 2026-11-02T09:30:00+02:00")
        return v


class HoldIn(_Aware):
    service_id: int
    start: datetime
    provider_id: int | None = None


class BookingIn(_Aware):
    service_id: int
    start: datetime
    provider_id: int | None = None
    hold_token: str | None = None
    name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=7, max_length=30)
    email: str = ""
    notes: str = Field(default="", max_length=1000)


class ManageIn(BaseModel):
    t: str
    reason: str = ""


class RescheduleIn(_Aware):
    t: str = ""
    start: datetime
    provider_id: int | None = None


class WaitlistIn(BaseModel):
    service_id: int
    date: date
    provider_id: int | None = None
    name: str = Field(min_length=2)
    phone: str = Field(min_length=7)


class TicketIn(BaseModel):
    service_id: int
    name: str = Field(min_length=2)
    phone: str = ""


class OtpIn(BaseModel):
    phone: str


class OtpVerifyIn(BaseModel):
    phone: str
    code: str


class LoginIn(BaseModel):
    email: str
    password: str


class StatusIn(BaseModel):
    status: str
    reason: str = ""


class ProviderBookingIn(_Aware):
    service_id: int
    start: datetime
    provider_id: int | None = None
    name: str
    phone: str
    notes: str = ""


class ServiceIn(BaseModel):
    name: str
    description: str = ""
    duration: int = Field(gt=0, le=600)
    price: float = Field(ge=0, default=0)
    buffer_before: int = Field(ge=0, default=0)
    buffer_after: int = Field(ge=0, default=0)
    min_notice: int = Field(ge=0, default=60)
    max_days_ahead: int = Field(ge=1, le=365, default=30)
    capacity: int = Field(ge=1, le=100, default=1)
    requires_confirmation: bool = False
    active: bool = True
    provider_ids: list[int] = []


class DayPlan(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start: str
    end: str
    breaks: list[tuple[str, str]] = []


class ScheduleIn(BaseModel):
    days: list[DayPlan]


class OverrideIn(BaseModel):
    date: date
    start: str | None = None
    end: str | None = None


class TimeOffIn(BaseModel):
    start: datetime
    end: datetime
    reason: str = ""


class TicketActionIn(BaseModel):
    status: str
