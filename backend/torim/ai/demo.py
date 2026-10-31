"""Offline demo mode for the two assistants.

With no ANTHROPIC_API_KEY the receptionist and the copilot still answer, from
the real calendar: free slots, prices, opening hours, bookings, numbers. This is
a small rule-based dialogue, not a language model, and every reply is labelled
"demo mode" in the UI. It books and cancels through the same booking engine the
model-driven agent uses, so the flow can be shown end to end without a key.

Set TORIM_AI_DEMO=0 to turn it off and get the old "assistant is off" behaviour.
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta

from .engine import TurnResult

_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
_STATE: dict[str, dict] = {}  # per conversation, in memory: a demo does not need more


def allowed() -> bool:
    return os.environ.get("TORIM_AI_DEMO", "1") != "0"


def _remember(conv, user: str, reply: str) -> None:
    conv.messages = list(conv.messages or []) + [{"role": "user", "content": user}, {"role": "assistant", "content": reply}]


def _has(text: str, *words: str) -> bool:
    return any(re.search(rf"\b{re.escape(w)}", text) for w in words)


def _parse_day(text: str, today: date) -> tuple[date, int]:
    """(first day to look at, number of days to scan)."""
    m = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if m:
        return date.fromisoformat(m.group()), 1
    if _has(text, "tomorrow", "tmrw"):
        return today + timedelta(days=1), 1
    if _has(text, "today", "tonight"):
        return today, 1
    for i, w in enumerate(_WEEKDAYS):
        if re.search(rf"\b{w[:3]}\w*", text) and (w in text or re.search(rf"\b{w[:3]}\b", text)):
            return today + timedelta(days=(i - today.weekday()) % 7 or 7), 1
    return today, 7


def _parse_window(text: str) -> tuple[int, int]:
    """Minutes from midnight: (not before, not after)."""
    lo, hi = 0, 24 * 60
    m = re.search(r"after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text)
    if m:
        h = int(m.group(1))
        if m.group(3) == "pm" and h < 12 or (not m.group(3) and 1 <= h <= 8):
            h += 12
        lo = h * 60 + int(m.group(2) or 0)
    m = re.search(r"before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", text)
    if m:
        h = int(m.group(1))
        if m.group(3) == "pm" and h < 12:
            h += 12
        hi = h * 60 + int(m.group(2) or 0)
    if _has(text, "morning"):
        hi = min(hi, 12 * 60)
    if _has(text, "afternoon"):
        lo, hi = max(lo, 12 * 60), min(hi, 17 * 60)
    if _has(text, "evening"):
        lo = max(lo, 17 * 60)
    return lo, hi


def _pick_service(b, text: str):
    services = [s for s in b.services if s.active]
    syn = {"cut": ["cut", "haircut", "trim"], "beard": ["beard", "shave"], "colour": ["colour", "color", "dye", "root"], "pilates": ["pilates", "class", "reformer"]}
    best, score = None, 0
    for s in services:
        name = s.name.lower()
        sc = sum(2 for w in re.findall(r"[a-z']+", name) if len(w) > 2 and w in text)
        for key, words in syn.items():
            if key in name or any(w in name for w in words):
                sc += sum(1 for w in words if w in text)
        if "women" in name and _has(text, "women", "woman", "ladies", "her"):
            sc += 3
        if "men's" in name and _has(text, "men", "man", "guy", "his"):
            sc += 2
        if sc > score:
            best, score = s, sc
    return best if score else None


def _fmt_day(d: date, today: date) -> str:
    if d == today:
        return "Today"
    if d == today + timedelta(days=1):
        return "Tomorrow"
    return d.strftime("%a %b ") + str(d.day)


def _hours_line(b) -> str:
    by_day: dict[int, tuple[str, str]] = {}
    for p in b.providers:
        if not p.active:
            continue
        for h in p.working_hours:
            lo, hi = by_day.get(h.weekday, (h.start, h.end))
            by_day[h.weekday] = (min(lo, h.start), max(hi, h.end))
    if not by_day:
        return "I don't have opening hours on file."
    groups: list[list] = []
    for d in range(7):
        if d not in by_day:
            continue
        if groups and groups[-1][2] == by_day[d] and groups[-1][1] == d - 1:
            groups[-1][1] = d
        else:
            groups.append([d, d, by_day[d]])
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    parts = [f"{names[a] if a == z else names[a] + ' to ' + names[z]} {h[0]} to {h[1]}" for a, z, h in groups]
    closed = [names[d] for d in range(7) if d not in by_day]
    return "We're open " + ", ".join(parts) + (f". Closed {', '.join(closed)}." if closed else ".")


class DemoReceptionist:
    """Rule-based stand-in for the model-driven receptionist."""

    def __init__(self, rc):
        self.rc = rc  # a Receptionist: its tool methods do the real work
        self.b = rc.b
        self.st = _STATE.setdefault(rc.conv.uid, {})

    # -------------------------------------------------------------- replies
    def services_text(self) -> str:
        lines = [f"{s.name}: {s.duration} min, ₪{s.price:g}" + (" (needs the business to approve)" if s.requires_confirmation else "") for s in self.b.services if s.active]
        return "Here's what we offer:\n" + "\n".join(f"- {x}" for x in lines)

    def offer(self, text: str, service) -> tuple[str, list]:
        rc = self.rc
        today = rc.tz and datetime.now(rc.tz).date()
        start, days = _parse_day(text, today)
        lo, hi = _parse_window(text)
        data = rc.find_available_slots(service.id, start.isoformat(), days, None)
        opts = []
        if isinstance(data["days"], list):
            for d in data["days"]:
                for s in d["slots"]:
                    t = datetime.fromisoformat(s["start"])
                    mins = t.hour * 60 + t.minute
                    if lo <= mins < hi:
                        opts.append({"start": s["start"], "providers": s["provider_ids"], "day": date.fromisoformat(d["date"])})
        if not opts and days == 1:
            # nothing that day: look a week ahead instead of giving up
            return self.offer_range(service, start + timedelta(days=1), lo, hi, f"Nothing free {_fmt_day(start, today).lower()}. ")
        if not opts:
            return f"I don't see free {service.name.lower()} times in the next week{' in that window' if (lo, hi) != (0, 1440) else ''}. I can put you on the waitlist if you tell me a day.", []
        return self.present(service, opts[:4], today, "")

    def offer_range(self, service, start: date, lo: int, hi: int, prefix: str):
        rc = self.rc
        today = datetime.now(rc.tz).date()
        data = rc.find_available_slots(service.id, start.isoformat(), 7, None)
        opts = []
        if isinstance(data["days"], list):
            for d in data["days"]:
                for s in d["slots"]:
                    t = datetime.fromisoformat(s["start"])
                    if lo <= t.hour * 60 + t.minute < hi:
                        opts.append({"start": s["start"], "providers": s["provider_ids"], "day": date.fromisoformat(d["date"])})
        if not opts:
            return prefix + "And I don't see anything in the following week either. Want me to add you to the waitlist?", []
        return self.present(service, opts[:4], today, prefix)

    def present(self, service, opts: list, today: date, prefix: str):
        self.st.update(service_id=service.id, options=opts, chosen=None)
        lines = [f"- {_fmt_day(o['day'], today)}, {datetime.fromisoformat(o['start']).strftime('%H:%M')}" for o in opts]
        return (
            f"{prefix}For {service.name} ({service.duration} min, ₪{service.price:g}) I have:\n" + "\n".join(lines) + "\nWhich one works? Tell me the time, or say \"first\".",
            [],
        )

    def choose(self, text: str):
        opts = self.st.get("options") or []
        picked = None
        m = re.search(r"\b(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?\b", text)
        if _has(text, "first", "earliest", "yes", "ok", "okay", "sure", "that one", "sounds good") and not m:
            picked = opts[0]
        elif _has(text, "second") and len(opts) > 1:
            picked = opts[1]
        elif _has(text, "third") and len(opts) > 2:
            picked = opts[2]
        elif _has(text, "last") and opts:
            picked = opts[-1]
        elif m:
            h, mi = int(m.group(1)), int(m.group(2) or 0)
            for o in opts:
                t = datetime.fromisoformat(o["start"])
                if t.minute == mi and (t.hour == h or (t.hour - 12 == h and not m.group(3)) or (m.group(3) == "pm" and t.hour == h + 12)):
                    picked = o
                    break
        return picked

    def reply(self, text: str) -> tuple[str, list]:
        t = text.lower().strip()
        rc, st, b = self.rc, self.st, self.b
        today = datetime.now(rc.tz).date()

        # 1. we are waiting for contact details to finish a booking
        if st.get("chosen"):
            phone = re.sub(r"[^\d+]", "", " ".join(re.findall(r"\+?\d[\d\s\-]{7,}", text)))
            name = re.sub(r"\+?\d[\d\s\-]{7,}", "", text)
            name = re.sub(r"(?i)\b(my name is|i'?m|i am|name|phone|mobile|number|is|and)\b|[:,.]", " ", name).strip()
            phone = phone or rc.conv.verified_phone
            if _has(t, "cancel", "never mind", "stop"):
                st.update(chosen=None, options=[])
                return "No problem, I haven't booked anything. Anything else?", []
            if len(name) < 2 or len(phone) < 9:
                return "I need your name and mobile number to book it, for example: \"Dana, 052-1234567\".", []
            o = st["chosen"]
            pid = o["providers"][0] if o.get("providers") else None
            try:
                r = rc.book_appointment(st["service_id"], o["start"], pid, name.title(), phone, None)
            except ValueError as e:
                st.update(chosen=None, options=[])
                return f"Sorry, that time just went: {e}. Want me to look again?", []
            st.update(chosen=None, options=[])
            when = datetime.fromisoformat(r["start"])
            extra = " It's waiting for the business to approve it." if r["status"] == "pending" else ""
            return f"Done. {r['service']} with {r['provider'].split()[0]}, {_fmt_day(when.date(), today).lower()} at {when.strftime('%H:%M')}.{extra} A confirmation with a manage link is on its way to {phone}.", [r["_action"]]

        # 2. choosing among offered times
        if st.get("options"):
            picked = self.choose(t)
            if picked:
                st["chosen"] = picked
                when = datetime.fromisoformat(picked["start"])
                return f"{_fmt_day(when.date(), today)} at {when.strftime('%H:%M')}, great. What's your name and mobile number?", []

        # 3. confirming a cancellation
        if st.get("cancel_uid"):
            uid = st.pop("cancel_uid")
            if _has(t, "yes", "yep", "sure", "cancel it", "please", "confirm"):
                try:
                    r = rc.cancel_booking(uid, "via demo assistant")
                except ValueError as e:
                    return f"I couldn't cancel it: {e}.", []
                return "It's cancelled, and the time is free again. Want to book another?", [r["_action"]]
            return "OK, I've left your booking as it is.", []

        # 4. intents
        if _has(t, "cancel"):
            data = rc.get_my_bookings()
            if data.get("error") or not data.get("bookings"):
                return "I can only see bookings for a verified phone number. Open the link in your confirmation message, or sign in under My bookings, and I can cancel it for you.", []
            first = data["bookings"][0]
            st["cancel_uid"] = first["uid"]
            when = datetime.fromisoformat(first["start"])
            return f"Your next booking is {first['service']} with {first['provider'].split()[0]}, {_fmt_day(when.date(), today).lower()} at {when.strftime('%H:%M')}. Cancel it?", []
        if _has(t, "my booking", "my appointment", "my bookings", "what do i have"):
            data = rc.get_my_bookings()
            if data.get("error"):
                return "I can only see bookings for a verified phone number. Sign in under My bookings and ask me again.", []
            if not data["bookings"]:
                return "You don't have anything upcoming. Want to book something?", []
            lines = [f"- {x['service']}, {datetime.fromisoformat(x['start']).strftime('%a %b %d at %H:%M')}, with {x['provider'].split()[0]}" for x in data["bookings"]]
            return "Your upcoming bookings:\n" + "\n".join(lines), []
        if _has(t, "hour", "open", "close", "closing", "when are you"):
            return _hours_line(b), []
        if _has(t, "price", "cost", "how much", "service", "menu", "offer", "charge"):
            one = _pick_service(b, t)
            if one:
                return f"{one.name} is ₪{one.price:g} and takes {one.duration} min. Want me to find a time?", []
            return self.services_text(), []
        if _has(t, "address", "where", "location", "phone", "call"):
            return f"{b.name} is at {b.address}. Phone: {b.phone}.", []
        service = _pick_service(b, t)
        if service or _has(t, "book", "appointment", "slot", "available", "availability", "free", "earliest", "tomorrow", "today", "after", "before", "evening", "morning", "time"):
            if not service:
                active = [s for s in b.services if s.active]
                if len(active) == 1:
                    service = active[0]
                elif st.get("service_id"):
                    service = rc._service(st["service_id"])
                else:
                    return "Happy to. Which service?\n" + "\n".join(f"- {s.name} ({s.duration} min, ₪{s.price:g})" for s in active), []
            return self.offer(t, service)
        if _has(t, "hi", "hello", "hey", "good morning", "good evening"):
            return f"Hi, this is the {b.name} assistant. I can check free times, book, and answer questions about prices and hours. What do you need?", []
        if _has(t, "thank", "thanks"):
            return "Any time.", []
        return f"I can help with free times, booking, prices and opening hours. For anything else, call {b.name} on {b.phone}.", []


def receptionist_turn(rc, text: str) -> TurnResult:
    reply, actions = DemoReceptionist(rc).reply(text)
    _remember(rc.conv, text, reply)
    rc.db.commit()
    return TurnResult(reply=reply, messages=rc.conv.messages, actions=actions, tool_calls=[])


# ------------------------------------------------------------------ copilot
def copilot_turn(cp, text: str) -> TurnResult:
    t = text.lower()
    tz = cp.tz
    today = datetime.now(tz).date()
    iso = today.isoformat()
    actions: list = []

    def money(x):
        return f"₪{x:,.0f}"

    if _has(t, "no-show", "no show", "noshow", "risk", "might not", "reliable"):
        rows = cp.no_show_risks(iso, (today + timedelta(days=7)).isoformat())
        high = [r for r in rows if r.get("level") == "high"] or rows[:3]
        if not high:
            reply = "No upcoming booking looks risky this week."
        else:
            lines = [f"- {r.get('customer', 'Client')}, {datetime.fromisoformat(r['start']).strftime('%a %H:%M')}: {round(r['probability'] * 100)}% chance of not showing" + (f" ({'; '.join(r['reasons'][:2])})" if r.get("reasons") else "") for r in high[:4]]
            reply = "These bookings are most likely to no-show:\n" + "\n".join(lines) + "\nA personal reminder usually helps. Open the booking and tap Remind."
    elif _has(t, "waitlist", "waiting list", "waiting"):
        rows = cp.waitlist()
        reply = "Nobody is on the waitlist right now." if not rows else f"{len(rows)} on the waitlist:\n" + "\n".join(f"- {r['customer']}, {r['service']}, {r['date']}" for r in rows[:6])
    elif _has(t, "pending", "approve", "approval", "request"):
        rows = cp.list_bookings(iso, (today + timedelta(days=30)).isoformat(), None, "pending")
        reply = "Nothing is waiting for approval." if not rows else f"{len(rows)} waiting for your approval:\n" + "\n".join(f"- {r['customer']}, {r['service']}, {datetime.fromisoformat(r['start']).strftime('%a %b %d %H:%M')}" for r in rows[:6]) + "\nYou can approve them from Today."
    elif _has(t, "free", "gap", "open slot", "available", "empty"):
        svc = next((s for s in cp.b.services if s.active), None)
        out = []
        for i in range(3):
            d = (today + timedelta(days=i)).isoformat()
            sl = cp.free_slots(svc.id, d, None) if svc else []
            out.append(f"- {_fmt_day(today + timedelta(days=i), today)}: {len(sl)} free start times for {svc.name}" if svc else "")
        reply = "Open capacity:\n" + "\n".join(x for x in out if x)
    elif _has(t, "week", "revenue", "money", "earn", "stats", "numbers", "busy", "how are we", "how am i", "doing"):
        lo = (today - timedelta(days=6)).isoformat()
        s = cp.business_stats(lo, iso)
        top = s["by_service"][0] if s["by_service"] else None
        reply = (
            f"Last 7 days: {s['bookings']} bookings, {money(s['revenue_completed'])} from completed ones"
            + (f", utilization {round(s['utilization'] * 100)}%" if s["utilization"] is not None else "")
            + (f", no-show rate {round(s['no_show_rate'] * 100)}%" if s["no_show_rate"] is not None else "")
            + "."
            + (f" Most booked: {top[0]} ({top[1]})." if top else "")
        )
    elif _has(t, "today", "schedule", "agenda", "next", "who"):
        rows = [r for r in cp.list_bookings(iso, iso, None, "pending,confirmed,completed")]
        now = datetime.now(tz)
        later = [r for r in rows if datetime.fromisoformat(r["start"]) > now]
        if not rows:
            reply = "Nothing is booked today."
        else:
            nxt = later[0] if later else None
            reply = f"Today has {len(rows)} bookings worth {money(sum(r['price'] for r in rows))}." + (f" Next up: {nxt['customer']} at {datetime.fromisoformat(nxt['start']).strftime('%H:%M')} ({nxt['service']}, {nxt['provider'].split()[0]})." if nxt else " That's everyone for today.")
    elif _has(t, "book", "cancel", "block", "message", "send", "move"):
        reply = "In demo mode I can look things up. To change the calendar, use New booking on Today or open a booking. With a Claude key connected I can also do it from here."
    else:
        reply = "In demo mode I can answer from your live calendar. Try: \"How's today?\", \"Who might not show up this week?\", \"How are we doing this week?\", \"Who is on the waitlist?\" or \"Anything waiting for approval?\""
    _remember(cp.conv, text, reply)
    cp.db.commit()
    return TurnResult(reply=reply, messages=cp.conv.messages, actions=actions, tool_calls=[])
