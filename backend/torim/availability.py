"""Slot engine: pure functions that turn a provider's schedule into bookable slots.

Built on plain interval arithmetic so that every step is testable on its own:

    working window (weekly plan, or a date override)
      - breaks
      - time off
      - existing bookings, expanded by their service buffers
      - active slot holds of other customers
    = free intervals  ->  candidate starts every `step` minutes
      -> keep starts where [start - buffer_before, end + buffer_after] fits
      -> drop starts earlier than now + minimum notice, or past the booking horizon

Group services (capacity > 1) are handled by `seat` bookings: bookings of the
same service at the same start do not block that start until the seats run out.

Everything here is timezone aware. Local wall-clock rules (working hours) are
expanded in the business timezone and converted to UTC, so daylight-saving
transitions are handled by `zoneinfo` instead of by hand.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

UTC = timezone.utc
Interval = tuple[datetime, datetime]


# ---------------------------------------------------------------- interval math
def merge(intervals: Iterable[Interval]) -> list[Interval]:
    """Sort and merge overlapping or touching intervals."""
    out: list[Interval] = []
    for start, end in sorted(i for i in intervals if i[0] < i[1]):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def subtract(free: Iterable[Interval], busy: Iterable[Interval]) -> list[Interval]:
    """Remove every busy interval from the free intervals."""
    result = merge(free)
    for b_start, b_end in merge(busy):
        nxt: list[Interval] = []
        for f_start, f_end in result:
            if b_end <= f_start or b_start >= f_end:
                nxt.append((f_start, f_end))
                continue
            if b_start > f_start:
                nxt.append((f_start, b_start))
            if b_end < f_end:
                nxt.append((b_end, f_end))
        result = nxt
    return result


def contains(intervals: Sequence[Interval], start: datetime, end: datetime) -> bool:
    return any(s <= start and end <= e for s, e in intervals)


# ---------------------------------------------------------------- inputs
@dataclass(frozen=True)
class DayRule:
    """Wall-clock working window for one day, with optional breaks."""

    start: time
    end: time
    breaks: tuple[tuple[time, time], ...] = ()


@dataclass(frozen=True)
class ExistingBooking:
    start: datetime
    end: datetime
    service_id: int
    buffer_before: int = 0
    buffer_after: int = 0

    def blocked(self) -> Interval:
        return (
            self.start - timedelta(minutes=self.buffer_before),
            self.end + timedelta(minutes=self.buffer_after),
        )


@dataclass(frozen=True)
class ServiceRule:
    id: int
    duration: int
    buffer_before: int = 0
    buffer_after: int = 0
    min_notice: int = 0  # minutes
    max_days_ahead: int = 60
    capacity: int = 1


@dataclass
class ProviderCalendar:
    timezone: str
    weekly: dict[int, DayRule]  # 0 = Monday ... 6 = Sunday
    overrides: dict[date, DayRule | None] = field(default_factory=dict)  # None = day off
    time_off: list[Interval] = field(default_factory=list)
    bookings: list[ExistingBooking] = field(default_factory=list)
    holds: list[Interval] = field(default_factory=list)


# ---------------------------------------------------------------- engine
def working_intervals(cal: ProviderCalendar, day: date) -> list[Interval]:
    """The provider's working time on a local date, in UTC, breaks removed."""
    rule = cal.overrides[day] if day in cal.overrides else cal.weekly.get(day.weekday())
    if rule is None:
        return []
    tz = ZoneInfo(cal.timezone)

    def at(t: time) -> datetime:
        return datetime.combine(day, t, tzinfo=tz).astimezone(UTC)

    window = [(at(rule.start), at(rule.end))]
    breaks = [(at(s), at(e)) for s, e in rule.breaks]
    return subtract(window, breaks)


def free_intervals(cal: ProviderCalendar, day: date, service: ServiceRule) -> list[Interval]:
    """Working time minus everything that blocks a new booking of `service`."""
    busy: list[Interval] = list(cal.time_off) + list(cal.holds)
    for b in cal.bookings:
        # Seats of the same group service do not block each other; counted separately.
        if service.capacity > 1 and b.service_id == service.id:
            continue
        busy.append(b.blocked())
    return subtract(working_intervals(cal, day), busy)


def slots_for_day(
    cal: ProviderCalendar,
    day: date,
    service: ServiceRule,
    now: datetime,
    step: int = 15,
) -> list[datetime]:
    """Bookable start times (UTC) for a service on a local date."""
    tz = ZoneInfo(cal.timezone)
    today_local = now.astimezone(tz).date()
    if day < today_local or day > today_local + timedelta(days=service.max_days_ahead):
        return []

    earliest = now + timedelta(minutes=service.min_notice)
    duration = timedelta(minutes=service.duration)
    before = timedelta(minutes=service.buffer_before)
    after = timedelta(minutes=service.buffer_after)
    working = working_intervals(cal, day)
    free = free_intervals(cal, day, service)

    slots: list[datetime] = []
    for w_start, w_end in working:
        cursor = w_start
        while cursor + duration <= w_end:
            end = cursor + duration
            if (
                cursor >= earliest
                and _buffers_fit_at_edges(working, free, cursor, end, before, after)
                and _seats_left(cal, service, cursor, end) > 0
            ):
                slots.append(cursor)
            cursor += timedelta(minutes=step)
    return slots


def _buffers_fit_at_edges(
    working: Sequence[Interval],
    free: Sequence[Interval],
    start: datetime,
    end: datetime,
    before: timedelta,
    after: timedelta,
) -> bool:
    """Buffers may hang outside working hours (the first client of the day needs
    no prep time before opening), but must never overlap another booking."""
    if not contains(free, start, end):
        return False
    lo = start - before
    hi = end + after
    for w_start, w_end in working:
        if w_start <= start and end <= w_end:
            lo = max(lo, w_start)
            hi = min(hi, w_end)
    return contains(free, lo, hi)


def _seats_left(cal: ProviderCalendar, service: ServiceRule, start: datetime, end: datetime) -> int:
    if service.capacity <= 1:
        return 1
    taken = sum(1 for b in cal.bookings if b.service_id == service.id and b.start == start)
    overlapping_other_start = any(
        b.service_id == service.id and b.start != start and b.start < end and start < b.end
        for b in cal.bookings
    )
    if overlapping_other_start:
        return 0
    return service.capacity - taken


def is_bookable(
    cal: ProviderCalendar,
    service: ServiceRule,
    start: datetime,
    now: datetime,
    step: int = 15,
) -> bool:
    """Server-side check used inside the booking transaction."""
    day = start.astimezone(ZoneInfo(cal.timezone)).date()
    return start in slots_for_day(cal, day, service, now, step)


def working_minutes(cal: ProviderCalendar, day: date) -> int:
    return int(sum((e - s).total_seconds() for s, e in working_intervals(cal, day)) // 60)
