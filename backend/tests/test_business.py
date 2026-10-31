"""Signup with AI setup, staff management, business settings, briefing and personal reminders."""
import json
from datetime import date, timedelta

from test_ai import fake, text  # noqa: F401  (fixture + block helper)

from torim.ai import engine


def _signup_body(client, **over):
    proposal = client.post("/api/pro/setup/suggest", json={"name": "הסטודיו של רון", "category": "barber", "description": ""}).json()
    assert proposal["source"] == "template" and proposal["services"] and proposal["days"]
    body = {
        "business_name": "הסטודיו של רון",
        "slug": "ron-studio",
        "category": "barber",
        "description": "מספרה שכונתית",
        "address": "הנביאים 10, חיפה",
        "phone": "04-5550000",
        "accent_color": proposal["accent_color"],
        "owner_name": "רון כהן",
        "email": "ron@example.com",
        "password": "supersecret1",
        "services": proposal["services"],
        "days": proposal["days"],
    }
    body.update(over)
    return body


def test_signup_creates_a_bookable_business(client):
    engine.set_client(None)
    assert client.get("/api/pro/slug-available", params={"slug": "gal-barbers"}).json()["available"] is False
    assert client.get("/api/pro/slug-available", params={"slug": "ron-studio"}).json()["available"] is True
    r = client.post("/api/pro/signup", json=_signup_body(client))
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["me"]["role"] == "owner" and data["business"]["slug"] == "ron-studio"
    h = {"Authorization": f"Bearer {data['token']}"}
    assert client.get("/api/pro/me", headers=h).json()["business"]["name"] == "הסטודיו של רון"

    page = client.get("/api/b/ron-studio").json()
    sid = page["services"][0]["id"]
    found = False
    for i in range(1, 8):
        if client.get("/api/b/ron-studio/slots", params={"service_id": sid, "date": (date.today() + timedelta(days=i)).isoformat()}).json():
            found = True
            break
    assert found, "a new business should be bookable within a week"

    assert client.post("/api/pro/signup", json=_signup_body(client)).status_code == 409  # slug taken
    assert client.post("/api/pro/signup", json=_signup_body(client, slug="ron-two")).status_code == 409  # email taken
    assert client.post("/api/pro/signup", json=_signup_body(client, slug="Bad Slug!", email="x@y.co")).status_code == 422


def test_ai_setup_uses_structured_output_and_cleans_it(client, fake):  # noqa: F811
    proposal = {
        "description": "מספרה חמה בחיפה.",
        "accent_color": "#123456",
        "services": [
            {"name": "תספורת", "description": "", "duration": 40, "price": 100, "buffer_after": 5, "capacity": 1, "requires_confirmation": False},
            {"name": "צבע", "description": "", "duration": 9999, "price": -5, "buffer_after": 0, "capacity": 1, "requires_confirmation": True},
        ],
        "days": [
            {"weekday": 6, "start": "09:00", "end": "18:00", "breaks": [["13:00", "13:30"], ["20:00", "21:00"]]},
            {"weekday": 6, "start": "10:00", "end": "11:00", "breaks": []},
            {"weekday": 2, "start": "25:00", "end": "18:00", "breaks": []},
        ],
        "notes": "הנחתי שסגור בשבת.",
    }

    def step(messages, kw):
        fmt = kw["output_config"]["format"]
        assert fmt["type"] == "json_schema" and fmt["schema"]["additionalProperties"] is False
        assert kw["thinking"] == {"type": "adaptive"} and "מספרה של רון" in messages[0]["content"]
        return "end_turn", [text(json.dumps(proposal, ensure_ascii=False))]

    fake([step])
    r = client.post("/api/pro/setup/suggest", json={"name": "מספרה של רון", "category": "barber", "description": "אני ספר, עובד לבד, ראשון עד חמישי"})
    out = r.json()
    assert out["source"] == "ai"
    assert [s["name"] for s in out["services"]] == ["תספורת", "צבע"]
    assert out["services"][1]["duration"] == 480 and out["services"][1]["price"] == 0
    assert out["days"] == [{"weekday": 6, "start": "09:00", "end": "18:00", "breaks": [["13:00", "13:30"]]}]


def test_staff_management_and_scope(client, owner):
    services = client.get("/api/pro/me", headers=owner).json()["services"]
    r = client.post(
        "/api/pro/staff",
        headers=owner,
        json={"name": "שני ברק", "title": "ספרית", "email": "shani@barber.demo", "password": "password123", "service_ids": [services[0]["id"]], "copy_hours": True},
    )
    assert r.status_code == 201, r.text
    shani = r.json()
    assert shani["service_ids"] == [services[0]["id"]] and shani["weekdays"]

    tok = client.post("/api/pro/login", json={"email": "shani@barber.demo", "password": "password123"}).json()["token"]
    sh = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/pro/staff", headers=sh).status_code == 403
    assert client.put("/api/pro/business", headers=sh, json={"name": "x" * 5, "cancel_window_hours": 1, "slot_step": 15}).status_code == 403

    # the new staff member shows up for customers on that service
    page = client.get("/api/b/gal-barbers").json()
    assert any(p["name"] == "שני ברק" for p in page["providers"])

    edit = {**shani, "active": False, "password": None}
    assert client.put(f"/api/pro/staff/{shani['id']}", headers=owner, json=edit).status_code == 200
    assert client.post("/api/pro/login", json={"email": "shani@barber.demo", "password": "password123"}).status_code == 401
    me = client.get("/api/pro/me", headers=owner).json()["me"]
    assert client.put(f"/api/pro/staff/{me['id']}", headers=owner, json={**me, "active": False}).status_code == 422


def test_business_settings(client, owner):
    r = client.put(
        "/api/pro/business",
        headers=owner,
        json={"name": "מספרת גל החדשה", "description": "d", "address": "a", "phone": "p", "accent_color": "#ff0000", "cancel_window_hours": 12, "slot_step": 10},
    )
    assert r.status_code == 200, r.text
    assert client.get("/api/b/gal-barbers").json()["business"]["cancel_window_hours"] == 12
    bad = client.put("/api/pro/business", headers=owner, json={"name": "abc", "accent_color": "red", "cancel_window_hours": 1, "slot_step": 15})
    assert bad.status_code == 422


def test_briefing_rules_and_ai(client, owner, fake):  # noqa: F811
    engine.set_client(None)
    from torim.ai import briefing

    briefing._cache.clear()
    r = client.get("/api/pro/briefing", headers=owner).json()
    assert r["source"] == "rules" and r["headline"]
    assert all(i["action"] in briefing.ACTIONS for i in r["items"])

    def step(messages, kw):
        facts = json.loads(messages[0]["content"])
        assert {"today", "no_show_risks", "pending_requests", "waitlist", "free_time_today"} <= set(facts)
        return "end_turn", [text(json.dumps({"headline": "יום עמוס", "items": [{"text": "x", "kind": "risk", "action": "remind", "booking_id": 999999}]}))]

    fake([step])
    r = client.get("/api/pro/briefing", params={"refresh": True}, headers=owner).json()
    assert r["source"] == "ai" and r["headline"] == "יום עמוס"
    assert r["items"][0]["booking_id"] is None and r["items"][0]["action"] == "none"  # unknown ids are dropped


def test_personal_reminder_draft_and_send(client, owner, fake):  # noqa: F811
    engine.set_client(None)
    rows = client.get("/api/pro/bookings", params={"start": date.today().isoformat(), "end": (date.today() + timedelta(days=10)).isoformat(), "status": "confirmed"}, headers=owner).json()
    b = rows[0]
    d = client.post(f"/api/pro/bookings/{b['id']}/reminder/draft", headers=owner).json()
    assert d["source"] == "template" and "/manage/" in d["message"]

    def step(messages, kw):
        facts = json.loads(messages[0]["content"])
        assert "manage_link" in facts and "probability" not in json.dumps(facts)
        return "end_turn", [text(json.dumps({"message": "היי, מחכים לך מחר! תאשר/י בבקשה?"}))]

    fake([step])
    d = client.post(f"/api/pro/bookings/{b['id']}/reminder/draft", headers=owner).json()
    assert d["source"] == "ai" and d["message"].endswith(d["message"].split("\n")[-1]) and "/manage/" in d["message"]

    assert client.post(f"/api/pro/bookings/{b['id']}/reminder/send", headers=owner, json={"message": "היי, מחכים לך!"}).json()["ok"]
    outbox = client.get("/api/pro/notifications", headers=owner).json()
    assert any(n["kind"] == "personal_reminder" and n["body"] == "היי, מחכים לך!" for n in outbox)


def test_offer_free_time_to_waitlist(client, owner):
    r = client.post("/api/pro/waitlist/offer-today", headers=owner)
    assert r.status_code == 200 and isinstance(r.json()["sent"], int)
