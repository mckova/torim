"""Demo data: two businesses, staff, services, schedules and ~6 weeks of bookings.

Run: python -m torim.seed  (drops and recreates the demo database)
Logins: owner@barber.demo / demo1234, dana@barber.demo / demo1234,
        owner@studio.demo / demo1234
"""
from __future__ import annotations

import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from . import availability as av
from . import booking as bk
from .auth import hash_password
from .db import Base, SessionLocal, engine
from .models import (
    Booking,
    Break,
    Business,
    Customer,
    Provider,
    QueueTicket,
    Service,
    WaitlistEntry,
    WorkingHours,
    now_utc,
)

FIRST = ["Noa", "Itai", "Maya", "Yonatan", "Shira", "Omer", "Tamar", "Uri", "Roni", "Daniel", "Lia", "Alon", "Hila", "Guy", "Adi", "Yoav", "Michal", "Nadav", "Avigail", "Roy"]
LAST = ["Cohen", "Levi", "Mizrahi", "Peretz", "Biton", "Avraham", "Friedman", "Shapira", "Dahan", "Azulay"]


def _hours(p: Provider, plan: dict[int, tuple[str, str]], breaks: dict[int, tuple[str, str]] | None = None):
    for wd, (s, e) in plan.items():
        p.working_hours.append(WorkingHours(weekday=wd, start=s, end=e))
    for wd, (s, e) in (breaks or {}).items():
        p.breaks.append(Break(weekday=wd, start=s, end=e))


# Israeli week: Sunday (6) to Thursday (3), short Friday (4)
SUN_THU = {6: ("09:00", "19:00"), 0: ("09:00", "19:00"), 1: ("09:00", "19:00"), 2: ("09:00", "19:00"), 3: ("09:00", "20:00"), 4: ("08:30", "14:00")}
LUNCH = {wd: ("13:00", "13:45") for wd in (6, 0, 1, 2, 3)}


def build(db) -> None:
    pw = hash_password("demo1234")

    barber = Business(
        slug="gal-barbers",
        name="Gal Barbers",
        category="Barbershop",
        description="A barbershop for men and women in the heart of Tel Aviv. Cuts, beards and colour.",
        address="120 Dizengoff St, Tel Aviv",
        phone="03-5551234",
        accent_color="#e0336f",
    )
    studio = Business(
        slug="neshima-studio",
        name="Neshima Studio",
        category="Pilates and physiotherapy",
        description="Small-group Pilates classes and one-to-one physiotherapy.",
        address="45 Herzl St, Ramat Gan",
        phone="03-5559876",
        accent_color="#b2457a",
    )
    db.add_all([barber, studio])
    db.flush()

    gal = Provider(business=barber, name="Gal Avraham", title="Owner, head barber", email="owner@barber.demo", password_hash=pw, role="owner", color="#e0336f")
    dana = Provider(business=barber, name="Dana Sagi", title="Stylist and colour", email="dana@barber.demo", password_hash=pw, color="#e8692c")
    moshe = Provider(business=barber, name="Moshe Levi", title="Barber", email="moshe@barber.demo", password_hash=pw, color="#c99400")
    _hours(gal, SUN_THU, LUNCH)
    _hours(dana, {k: v for k, v in SUN_THU.items() if k != 4}, LUNCH)
    _hours(moshe, {6: ("12:00", "20:00"), 0: ("12:00", "20:00"), 2: ("12:00", "20:00"), 3: ("12:00", "21:00"), 4: ("08:30", "14:00")})

    cut = Service(business=barber, name="Men's haircut", duration=30, price=90, buffer_after=5, min_notice=60, description="Includes wash and styling")
    beard = Service(business=barber, name="Beard trim", duration=20, price=50, min_notice=30)
    combo = Service(business=barber, name="Cut and beard", duration=45, price=130, buffer_after=5)
    women = Service(business=barber, name="Women's cut", duration=60, price=180, buffer_after=10)
    color = Service(business=barber, name="Root colour", duration=90, price=280, buffer_after=15, min_notice=24 * 60, requires_confirmation=True, description="Needs approval, so we can check it suits you")
    cut.providers = [gal, dana, moshe]
    beard.providers = [gal, moshe]
    combo.providers = [gal, moshe]
    women.providers = [dana]
    color.providers = [dana]

    noa = Provider(business=studio, name="Noa Barak", title="Owner, Pilates instructor", email="owner@studio.demo", password_hash=pw, role="owner", color="#b2457a")
    yoni = Provider(business=studio, name="Yoni Katz", title="Physiotherapist", email="yoni@studio.demo", password_hash=pw, color="#e8692c")
    _hours(noa, {6: ("07:00", "21:00"), 0: ("07:00", "21:00"), 1: ("07:00", "21:00"), 2: ("07:00", "21:00"), 3: ("07:00", "21:00"), 4: ("08:00", "12:00")}, {wd: ("12:00", "16:00") for wd in (6, 0, 1, 2, 3)})
    _hours(yoni, {6: ("08:00", "16:00"), 0: ("08:00", "16:00"), 1: ("12:00", "20:00"), 2: ("08:00", "16:00"), 3: ("12:00", "20:00")})
    pilates = Service(business=studio, name="Reformer Pilates (group)", duration=55, price=120, buffer_after=5, capacity=6, min_notice=120, description="Up to 6 people")
    intro = Service(business=studio, name="Private intro session", duration=45, price=150, min_notice=24 * 60)
    physio = Service(business=studio, name="Physiotherapy session", duration=45, price=320, buffer_after=15, requires_confirmation=True)
    pilates.providers = [noa]
    intro.providers = [noa]
    physio.providers = [yoni]

    db.add_all([cut, beard, combo, women, color, pilates, intro, physio])
    db.flush()

    rng = random.Random(7)
    _history(db, barber, rng, per_day=14)
    _history(db, studio, rng, per_day=9)
    _today_queue(db, barber, cut, rng)
    db.commit()


def _customer(db, biz, rng) -> Customer:
    name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
    phone = "05" + str(rng.choice([0, 2, 3, 4, 8])) + "".join(str(rng.randint(0, 9)) for _ in range(7))
    return bk.upsert_customer(db, biz, name, phone)


def _history(db, biz: Business, rng: random.Random, per_day: int) -> None:
    """Fill 35 days back and 10 days ahead by walking real availability."""
    tz = ZoneInfo(biz.timezone)
    now = now_utc()
    today = now.astimezone(tz).date()
    pool = [_customer(db, biz, rng) for _ in range(60)]
    db.flush()
    # some customers are habitually unreliable, so the no-show model has a real signal to learn
    flaky = {c.id: (0.32 if rng.random() < 0.15 else 0.025) for c in pool}
    services = list(biz.services)
    taken: dict[int, list[tuple[datetime, datetime]]] = {}  # past bookings are not "active", so track them here
    for offset in range(-35, 11):
        day = today + timedelta(days=offset)
        target = per_day if offset < 0 else max(2, per_day - offset)  # the future is still filling up
        for _ in range(target * 3):
            if target <= 0:
                break
            s = rng.choice(services)
            p = rng.choice(s.providers)
            cal = bk.build_calendar(db, p, day, now=now)
            # look at availability "as of" the past day, so historic days are fillable
            as_of = min(now, datetime.combine(day, datetime.min.time(), tzinfo=tz).astimezone(av.UTC) - timedelta(days=2))
            rule = bk.service_rule(s)
            rule = av.ServiceRule(rule.id, rule.duration, rule.buffer_before, rule.buffer_after, 0, 400, rule.capacity)
            options = av.slots_for_day(cal, day, rule, as_of, biz.slot_step)
            if offset >= 0:
                options = [o for o in options if o > now + timedelta(minutes=s.min_notice)]
            busy = taken.setdefault(p.id, [])
            span = timedelta(minutes=s.duration + s.buffer_after)
            options = [o for o in options if all(o + span <= a or o >= b for a, b in busy)]
            if not options:
                continue
            start = rng.choice(options)
            c = rng.choice(pool)
            created = start - timedelta(days=rng.uniform(0.2, 9))
            if start < now:
                p_ns = flaky[c.id] + (0.03 if start.astimezone(tz).hour >= 17 else 0) + (0.02 if (start - created).days > 5 else 0)
                r = rng.random()
                status = "no_show" if r < p_ns else "cancelled" if r < p_ns + 0.08 else "completed"
            else:
                status = "pending" if s.requires_confirmation and rng.random() < 0.5 else "confirmed"
            if status != "cancelled":
                busy.append((start, start + span))
            db.add(
                Booking(
                    business_id=biz.id,
                    service_id=s.id,
                    provider_id=p.id,
                    customer_id=c.id,
                    start=start,
                    end=start + timedelta(minutes=s.duration),
                    status=status,
                    price=s.price,
                    source=rng.choices(["online", "provider"], [78, 22])[0],
                    cancelled_by="customer" if status == "cancelled" else "",
                    created_at=min(created, now),
                )
            )
            db.flush()
            target -= 1
    # a couple of people waiting for a fully booked tomorrow
    tomorrow = today + timedelta(days=1)
    for c in pool[:2]:
        db.add(WaitlistEntry(business_id=biz.id, service_id=services[0].id, customer_id=c.id, date=tomorrow))


def _today_queue(db, biz: Business, service: Service, rng: random.Random) -> None:
    today = now_utc().astimezone(ZoneInfo(biz.timezone)).date()
    now = now_utc()
    for i, status in enumerate(["done", "done", "serving", "waiting", "waiting", "waiting"], start=1):
        t = QueueTicket(
            business_id=biz.id,
            service_id=service.id,
            day=today,
            number=i,
            name=f"{rng.choice(FIRST)} {rng.choice(LAST)[0]}.",
            status=status,
            created_at=now - timedelta(minutes=90 - i * 10),
        )
        if status in ("done", "serving"):
            t.called_at = now - timedelta(minutes=80 - i * 12)
        if status == "done":
            t.finished_at = t.called_at + timedelta(minutes=rng.randint(18, 27))
        db.add(t)


def reset_and_seed() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        build(db)


def seed_if_empty() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(Business.id).limit(1)) is None:
            build(db)


if __name__ == "__main__":
    reset_and_seed()
    print("seeded demo data")
