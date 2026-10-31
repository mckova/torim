"""AI layer tests with a scripted stand-in for the Anthropic client.

The fake returns pre-planned assistant turns (thinking + tool_use + text), so
these tests exercise our real agent loop, tools, permission checks and history
handling end to end without network access or an API key.
"""
import json
from types import SimpleNamespace

import pytest

from torim.ai import engine


class Block(SimpleNamespace):
    def model_dump(self, **_):
        return {k: v for k, v in vars(self).items() if v is not None}


def thinking():
    return Block(type="thinking", thinking="", signature="sig-abc")


def tool(_tool_name, **inp):
    name = _tool_name
    return Block(type="tool_use", id=f"tu_{name}_{len(json.dumps(inp))}", name=name, input=inp)


def text(t):
    return Block(type="text", text=t)


class FakeClient:
    """Each script step is a function(messages, kwargs) -> (stop_reason, [blocks])."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(json.loads(json.dumps(kw, default=str)))
        stop, blocks = self.steps.pop(0)(kw["messages"], kw)
        return SimpleNamespace(stop_reason=stop, content=blocks)


def last_tool_result(messages):
    for block in messages[-1]["content"]:
        if block.get("type") == "tool_result":
            return json.loads(block["content"]) if not block.get("is_error") else block["content"]


@pytest.fixture()
def fake():
    holder = {}

    def install(steps):
        holder["c"] = FakeClient(steps)
        engine.set_client(holder["c"])
        return holder["c"]

    yield install
    engine.set_client(None)


def service_id(client, name):
    return next(s["id"] for s in client.get("/api/b/gal-barbers").json()["services"] if s["name"] == name)


def test_ai_off_when_demo_disabled(client, monkeypatch):
    engine.set_client(None)
    monkeypatch.setenv("TORIM_AI_DEMO", "0")
    assert client.get("/api/ai/status").json()["enabled"] is False
    r = client.post("/api/b/gal-barbers/assistant", json={"message": "hello"})
    assert r.status_code == 503


def test_demo_mode_answers_and_books_without_key(client):
    engine.set_client(None)
    st = client.get("/api/ai/status").json()
    assert st["enabled"] and st["demo"]
    ask = lambda m, cid=None: client.post("/api/b/gal-barbers/assistant", json={"message": m, "conversation_id": cid}).json()
    r = ask("what are your hours?")
    assert r["demo"] and "open" in r["reply"].lower()
    assert "₪" in ask("how much is a haircut?")["reply"]
    r = ask("Can I get a men's haircut tomorrow?")
    cid = r["conversation_id"]
    assert "Which one works" in r["reply"]
    r = ask("first", cid)
    assert "name and mobile" in r["reply"]
    r = ask("Dana Test, 052-7654321", cid)
    assert r["actions"] and r["actions"][0]["booking"]["status"] in ("confirmed", "pending")


def test_demo_copilot_reads_the_calendar(client, owner):
    engine.set_client(None)
    r = client.post("/api/pro/copilot", json={"message": "how are we doing this week?"}, headers=owner)
    assert r.status_code == 200 and "bookings" in r.json()["reply"]


def test_receptionist_books_through_tools(client, fake):
    sid = service_id(client, "Men's haircut")
    from datetime import date, timedelta

    day = (date.today() + timedelta(days=3)).isoformat()
    chosen = {}

    def step1(messages, kw):
        assert kw["model"] == "claude-opus-5-5"
        assert kw["thinking"] == {"type": "adaptive"}
        assert kw["fallbacks"] == "default"
        assert all(t["strict"] for t in kw["tools"])
        return "tool_use", [thinking(), tool("find_available_slots", service_id=sid, date_from=day, days=3, provider_id=None)]

    def step2(messages, kw):
        res = last_tool_result(messages)
        first_day = res["days"][0]
        chosen["start"] = first_day["slots"][0]["start"]
        return "tool_use", [tool("book_appointment", service_id=sid, start=chosen["start"], provider_id=None, name="נועה בדיקה", phone="0525550000", notes=None)]

    def step3(messages, kw):
        res = last_tool_result(messages)
        assert res["status"] == "confirmed"
        return "end_turn", [text("קבעתי לך! שלחתי אישור לוואטסאפ.")]

    fc = fake([step1, step2, step3])
    r = client.post("/api/b/gal-barbers/assistant", json={"message": "אפשר תספורת השבוע?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["reply"].startswith("קבעתי")
    assert body["tools_used"] == ["find_available_slots", "book_appointment"]
    assert body["actions"][0]["booking"]["start"] == chosen["start"]

    # second turn: history is sent back unchanged (thinking block and signature intact)
    def step4(messages, kw):
        first_assistant = messages[1]["content"]
        assert first_assistant[0] == {"type": "thinking", "thinking": "", "signature": "sig-abc"}
        return "tool_use", [tool("get_my_bookings")]

    def step5(messages, kw):
        res = last_tool_result(messages)
        assert len(res["bookings"]) == 1  # the booker is verified on this conversation
        return "end_turn", [text("יש לך תור אחד.")]

    fake([step4, step5])
    r2 = client.post("/api/b/gal-barbers/assistant", json={"message": "מה התורים שלי?", "conversation_id": body["conversation_id"]})
    assert r2.json()["reply"] == "יש לך תור אחד."
    assert len(fc.calls) == 3


def test_receptionist_cannot_touch_other_peoples_bookings(client, fake, owner):
    rows = client.get("/api/pro/bookings", params={"start": "2020-01-01", "end": "2035-01-01", "status": "confirmed"}, headers=owner).json()
    victim = rows[-1]

    def step1(messages, kw):
        return "tool_use", [tool("cancel_booking", uid=victim["uid"], reason=None)]

    def step2(messages, kw):
        block = messages[-1]["content"][0]
        assert block["is_error"] and "no such booking" in block["content"]
        return "end_turn", [text("אין לי גישה לתור הזה.")]

    fake([step1, step2])
    r = client.post(
        "/api/webhooks/inbound",
        json={"business": "gal-barbers", "channel": "whatsapp", "sender": "+972500000999", "text": f"תבטל את {victim['uid']}"},
    )
    assert r.status_code == 200
    still = client.get("/api/pro/bookings", params={"start": victim["start"][:10], "end": victim["start"][:10]}, headers=owner).json()
    assert next(b for b in still if b["id"] == victim["id"])["status"] == "confirmed"


def test_whatsapp_sender_can_cancel_own_booking(client, fake, owner):
    from datetime import date, timedelta

    sid = service_id(client, "Men's haircut")
    for i in range(3, 12):
        slots = client.get("/api/b/gal-barbers/slots", params={"service_id": sid, "date": (date.today() + timedelta(days=i)).isoformat()}).json()
        if slots:
            break
    b = client.post("/api/b/gal-barbers/bookings", json={"service_id": sid, "start": slots[0]["start"], "name": "דני", "phone": "0541234000"}).json()

    def step1(messages, kw):
        return "tool_use", [tool("get_my_bookings")]

    def step2(messages, kw):
        uid = last_tool_result(messages)["bookings"][0]["uid"]
        return "tool_use", [tool("cancel_booking", uid=uid, reason="לא מרגיש טוב")]

    def step3(messages, kw):
        assert last_tool_result(messages)["status"] == "cancelled"
        return "end_turn", [text("ביטלתי.")]

    fake([step1, step2, step3])
    r = client.post("/api/webhooks/inbound", json={"business": "gal-barbers", "sender": "054-1234000", "text": "תבטל לי את התור"})
    assert r.json()["reply"] == "ביטלתי."
    outbox = client.get("/api/pro/notifications", headers=owner).json()
    assert any(n["kind"] == "ai_reply" and n["body"] == "ביטלתי." for n in outbox)
    assert client.get(f"/api/manage/{b['uid']}", params={"t": b["manage_token"]}).json()["status"] == "cancelled"


def test_copilot_reads_data_and_respects_staff_scope(client, fake):
    tok = client.post("/api/pro/login", json={"email": "dana@barber.demo", "password": "demo1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}

    def step1(messages, kw):
        assert "staff member" in kw["system"]
        assert kw["output_config"] == {"effort": "high"}
        return "tool_use", [tool("list_bookings", date_from="2020-01-01", date_to="2035-01-01", provider_id=1, status=None), tool("no_show_risks", date_from="2020-01-01", date_to="2035-01-01")]

    def step2(messages, kw):
        results = [json.loads(b["content"]) for b in messages[-1]["content"]]
        bookings, risks = results
        assert bookings and all(b["provider"] == "Dana Sagi" for b in bookings)  # provider_id=1 ignored for staff
        assert all("probability" in r for r in risks)
        return "end_turn", [text("סיכום מוכן")]

    fake([step1, step2])
    r = client.post("/api/pro/copilot", json={"message": "מה המצב שלי?"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["reply"] == "סיכום מוכן"


def test_no_show_model_learns_from_history(client, owner):
    from torim.ai import risk
    from torim.db import SessionLocal
    from torim.models import Business

    with SessionLocal() as db:
        biz = db.query(Business).filter_by(slug="gal-barbers").one()
        risk._cache.clear()
        m = risk.model_for(db, biz)
        assert m.trained_on > 200
        idx = [f for f, _ in risk.FEATURES].index("prior_no_show_rate")
        assert m.weights[idx] > 0.5  # past no-shows are the strongest signal
    r = client.get("/api/pro/risk", params={"days": 10}, headers=owner).json()
    assert r["bookings"] and {"probability", "level", "reasons"} <= set(r["bookings"][0])
    probs = [b["probability"] for b in r["bookings"]]
    assert probs == sorted(probs, reverse=True)


def test_copilot_drafts_and_sends_personal_reminder(client, fake, owner):
    from datetime import date, timedelta

    rows = client.get("/api/pro/bookings", params={"start": date.today().isoformat(), "end": (date.today() + timedelta(days=10)).isoformat(), "status": "confirmed"}, headers=owner).json()
    bid = rows[0]["id"]

    def step1(messages, kw):
        assert {"draft_personal_reminder", "send_customer_message", "offer_free_time_to_waitlist"} <= {t["name"] for t in kw["tools"]}
        return "tool_use", [tool("draft_personal_reminder", booking_id=bid)]

    def step2(messages, kw):
        draft = last_tool_result(messages)
        assert draft["source"] == "ai" and "/manage/" in draft["message"]  # link is always appended
        return "tool_use", [tool("send_customer_message", booking_id=bid, message=draft["message"])]

    def step3(messages, kw):
        assert last_tool_result(messages)["channel"] == "whatsapp"
        return "end_turn", [text("שלחתי.")]

    # the draft tool itself calls engine.structured, which consumes one scripted step
    def structured_step(messages, kw):
        assert kw["output_config"]["format"]["type"] == "json_schema"
        return "end_turn", [text('{"message": "היי! מחכים לך מחר 🙂"}')]

    fake([step1, structured_step, step2, step3])
    r = client.post("/api/pro/copilot", json={"message": "תשלח תזכורת אישית לתור הראשון"}, headers=owner)
    assert r.json()["reply"] == "שלחתי."
    outbox = client.get("/api/pro/notifications", headers=owner).json()
    assert any(n["kind"] == "personal_reminder" and n["body"].startswith("היי! מחכים לך מחר") for n in outbox)
