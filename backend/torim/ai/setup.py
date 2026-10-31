"""AI business setup: a new owner describes the business in their own words and
gets a ready-to-edit proposal (services with durations and prices, weekly
hours with breaks, a short public description and a brand color).

With an API key this is one structured-output call to Claude, so the answer is
always valid JSON in the exact shape the signup screen and `create_business`
expect. Without a key a category template is returned, so signup always works.
"""
from __future__ import annotations

import re

from . import engine
from .engine import obj

CATEGORIES = {
    "barber": "Barbershop",
    "beauty": "Beauty and nails",
    "clinic": "Clinic and treatments",
    "fitness": "Studio and fitness",
    "other": "Other",
}

# weekday: 0 = Monday ... 6 = Sunday (Python convention)
_SUN_THU = [6, 0, 1, 2, 3]


def _week(start: str, end: str, friday: tuple[str, str] | None = ("09:00", "14:00"), lunch: tuple[str, str] | None = None) -> list[dict]:
    days = [{"weekday": d, "start": start, "end": end, "breaks": [list(lunch)] if lunch else []} for d in _SUN_THU]
    if friday:
        days.append({"weekday": 4, "start": friday[0], "end": friday[1], "breaks": []})
    return days


def _svc(name, duration, price, description="", buffer_after=0, capacity=1, requires_confirmation=False) -> dict:
    return {
        "name": name,
        "description": description,
        "duration": duration,
        "price": price,
        "buffer_after": buffer_after,
        "capacity": capacity,
        "requires_confirmation": requires_confirmation,
    }


TEMPLATES: dict[str, dict] = {
    "barber": {
        "services": [_svc("Men's haircut", 30, 90, "Includes wash and styling", 5), _svc("Beard trim", 20, 50), _svc("Cut and beard", 45, 130, "", 5), _svc("Kids cut", 25, 70)],
        "days": _week("09:00", "19:00", ("08:30", "14:00"), ("13:00", "13:45")),
        "accent_color": "#e0336f",
    },
    "beauty": {
        "services": [_svc("Gel manicure", 60, 150, "", 10), _svc("Pedicure", 60, 170, "", 10), _svc("Brow shaping", 20, 70), _svc("Facial", 75, 320, "", 15)],
        "days": _week("10:00", "19:00", ("09:00", "14:00"), ("14:00", "14:30")),
        "accent_color": "#db2777",
    },
    "clinic": {
        "services": [_svc("First assessment", 60, 350, "Getting to know you and an assessment", 10, 1, True), _svc("Treatment", 45, 300, "", 10), _svc("Follow-up", 30, 200, "", 5)],
        "days": _week("08:00", "18:00", None, ("12:30", "13:15")),
        "accent_color": "#2563eb",
    },
    "fitness": {
        "services": [_svc("Group class", 55, 70, "Up to 8 people", 5, 8), _svc("Personal training", 60, 250, "", 10), _svc("Trial class", 55, 0, "For new members", 5, 8, True)],
        "days": _week("07:00", "21:00", ("08:00", "13:00"), ("13:00", "16:00")),
        "accent_color": "#7c3aed",
    },
    "other": {
        "services": [_svc("Appointment", 30, 100), _svc("Long appointment", 60, 180, "", 10)],
        "days": _week("09:00", "18:00", ("09:00", "13:00")),
        "accent_color": "#e0336f",
    },
}

_HHMM = re.compile(r"^([01][0-9]|2[0-3]):[0-5][0-9]$")
_T = {"type": "string", "description": "HH:MM, 24h"}
SCHEMA = obj(
    {
        "description": {"type": "string", "description": "One or two warm sentences for the public booking page"},
        "accent_color": {"type": "string", "description": "Brand color as #rrggbb that fits the business"},
        "services": {
            "type": "array",
            "items": obj(
                {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "duration": {"type": "integer", "description": "minutes, 5-480"},
                    "price": {"type": "number", "description": "ILS"},
                    "buffer_after": {"type": "integer", "description": "cleanup/prep minutes after the service"},
                    "capacity": {"type": "integer", "description": "1 for one-on-one, more for group classes"},
                    "requires_confirmation": {"type": "boolean"},
                }
            ),
        },
        "days": {
            "type": "array",
            "items": obj(
                {
                    "weekday": {"type": "integer", "description": "0=Monday ... 4=Friday, 5=Saturday, 6=Sunday"},
                    "start": _T,
                    "end": _T,
                    "breaks": {"type": "array", "items": {"type": "array", "items": _T}},
                }
            ),
        },
        "notes": {"type": "string", "description": "Short note on assumptions you made, or empty"},
    }
)

SYSTEM = """You set up an online booking page for a small Israeli service business.
From the owner's description (English or Hebrew, sometimes messy or partial), propose:
- The services they offer, with realistic durations and Israeli market prices in ILS when not stated.
  Keep the owner's own service names. Use capacity > 1 only for group classes. Use buffer_after for
  cleanup/prep time when the trade needs it. Use requires_confirmation only for services the owner
  would want to screen (first consultations, long or expensive treatments).
- Weekly opening hours. The Israeli work week is Sunday to Thursday, Friday is usually short, and most
  businesses are closed on Saturday unless the owner says otherwise. Add a lunch break when typical.
  Weekday numbers: 0=Monday, 1=Tuesday, 2=Wednesday, 3=Thursday, 4=Friday, 5=Saturday, 6=Sunday.
- A one or two sentence public description in natural English, and a fitting brand color.
Respect everything the owner states explicitly; fill only what is missing, and mention the main
assumptions in `notes` (one sentence). Write all customer-facing text in English; keep the owner's own service names as they wrote them. Use plain punctuation (commas and periods), never an em dash."""


def _clean(p: dict) -> dict:
    """Clamp model output to what the database accepts (defensive, schema already holds)."""
    services = []
    for s in p.get("services", [])[:12]:
        if not s.get("name"):
            continue
        services.append(
            {
                **s,
                "name": s["name"][:120],
                "duration": max(5, min(480, int(s["duration"]))),
                "price": max(0.0, float(s["price"])),
                "buffer_after": max(0, min(120, int(s["buffer_after"]))),
                "capacity": max(1, min(100, int(s["capacity"]))),
            }
        )
    seen, days = set(), []
    for d in p.get("days", []):
        ok = all(_HHMM.match(t) for t in (d["start"], d["end"]))
        if not ok or d["weekday"] in seen or not (0 <= d["weekday"] <= 6) or d["start"] >= d["end"]:
            continue
        seen.add(d["weekday"])
        days.append({**d, "breaks": [b[:2] for b in d.get("breaks", []) if len(b) >= 2 and all(_HHMM.match(t) for t in b[:2]) and d["start"] <= b[0] < b[1] <= d["end"]]})
    color = p.get("accent_color", "")
    return {
        "description": p.get("description", "")[:400],
        "accent_color": color if re.fullmatch(r"#[0-9a-fA-F]{6}", color or "") else "#e0336f",
        "services": services,
        "days": sorted(days, key=lambda d: (d["weekday"] - 6) % 7),
        "notes": p.get("notes", ""),
    }


def template(category: str) -> dict:
    t = TEMPLATES.get(category, TEMPLATES["other"])
    return {"description": "", "notes": "", **t}


def suggest(name: str, category: str, description: str) -> dict:
    if not engine.enabled() or not description.strip():
        return {"source": "template", **template(category)}
    text = f"Business name: {name}\nCategory: {CATEGORIES.get(category, category)}\n\nOwner's description:\n{description.strip()[:3000]}"
    try:
        proposal = _clean(engine.structured(system=SYSTEM, user_text=text, schema=SCHEMA, effort="medium"))
    except engine.AIUnavailable:
        return {"source": "template", **template(category)}
    if not proposal["services"]:
        proposal["services"] = template(category)["services"]
    if not proposal["days"]:
        proposal["days"] = template(category)["days"]
    return {"source": "ai", **proposal}
