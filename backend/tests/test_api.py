from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor


def first_open_slot(client, slug="gal-barbers", service_name="תספורת גבר", days_from=3):
    page = client.get(f"/api/b/{slug}").json()
    svc = next(s for s in page["services"] if s["name"] == service_name)
    for i in range(days_from, days_from + 10):
        d = (date.today() + timedelta(days=i)).isoformat()
        slots = client.get(f"/api/b/{slug}/slots", params={"service_id": svc["id"], "date": d}).json()
        if slots:
            return svc, slots
    raise AssertionError("no slots found")


def book(client, svc, slot, phone="0521234567", **extra):
    return client.post(
        "/api/b/gal-barbers/bookings",
        json={"service_id": svc["id"], "start": slot["start"], "name": "בדיקה", "phone": phone, **extra},
    )


def test_business_page(client):
    r = client.get("/api/b/gal-barbers")
    assert r.status_code == 200
    body = r.json()
    assert body["business"]["name"] == "מספרת גל"
    assert len(body["providers"]) == 3 and len(body["services"]) == 5


def test_book_then_slot_disappears(client):
    svc, slots = first_open_slot(client)
    slot = slots[0]
    r = book(client, svc, slot)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "confirmed" and b["manage_token"]
    again = client.get("/api/b/gal-barbers/slots", params={"service_id": svc["id"], "date": slot["start"][:10]}).json()
    same = [s for s in again if s["start"] == slot["start"]]
    # the start may still exist for other barbers, but never for the one we booked
    assert all(b["provider"]["id"] not in s["provider_ids"] for s in same)


def test_no_double_booking_under_concurrency(client):
    svc, slots = first_open_slot(client)
    slot = next(s for s in slots if len(s["provider_ids"]) == 1) if any(len(s["provider_ids"]) == 1 for s in slots) else slots[0]
    pid = slot["provider_ids"][0]
    with ThreadPoolExecutor(8) as ex:
        codes = list(ex.map(lambda i: book(client, svc, slot, phone=f"05000000{i:02d}", provider_id=pid).status_code, range(8)))
    assert codes.count(201) == 1 and codes.count(409) == 7


def test_hold_blocks_others_and_is_honored(client):
    svc, slots = first_open_slot(client)
    slot = slots[0]
    pid = slot["provider_ids"][0]
    h = client.post("/api/b/gal-barbers/holds", json={"service_id": svc["id"], "start": slot["start"], "provider_id": pid})
    assert h.status_code == 200
    # someone else cannot take the held provider at that time
    assert book(client, svc, slot, phone="0539999999", provider_id=pid).status_code == 409
    # the holder can
    r = book(client, svc, slot, hold_token=h.json()["token"])
    assert r.status_code == 201 and r.json()["provider"]["id"] == pid


def test_requires_confirmation_flow(client, owner):
    svc, slots = first_open_slot(client, service_name="צבע שורשים")
    b = book(client, svc, slots[0]).json()
    assert b["status"] == "pending"
    r = client.post(f"/api/pro/bookings/{b['id']}/status", json={"status": "confirmed"}, headers=owner)
    assert r.json()["status"] == "confirmed"
    bad = client.post(f"/api/pro/bookings/{b['id']}/status", json={"status": "pending"}, headers=owner)
    assert bad.status_code == 409


def test_manage_cancel_and_reschedule(client):
    svc, slots = first_open_slot(client)
    b = book(client, svc, slots[0]).json()
    view = client.get(f"/api/manage/{b['uid']}", params={"t": "wrong"})
    assert view.status_code == 404
    new = slots[3]
    r = client.post(f"/api/manage/{b['uid']}/reschedule", json={"t": b["manage_token"], "start": new["start"]})
    assert r.status_code == 200, r.text
    assert r.json()["start"] == new["start"]
    c = client.post(f"/api/manage/{b['uid']}/cancel", json={"t": b["manage_token"], "reason": "חולה"})
    assert c.json()["status"] == "cancelled"


def test_cancellation_notifies_waitlist(client, owner):
    svc, slots = first_open_slot(client)
    day = slots[0]["start"][:10]
    w = client.post("/api/b/gal-barbers/waitlist", json={"service_id": svc["id"], "date": day, "name": "ממתין", "phone": "0541111111"})
    assert w.status_code == 201
    b = book(client, svc, slots[0]).json()
    client.post(f"/api/manage/{b['uid']}/cancel", json={"t": b["manage_token"]})
    out = client.get("/api/pro/notifications", headers=owner).json()
    assert any(n["kind"] == "waitlist_offer" and n["to"] == "+972541111111" for n in out)
    wl = client.get("/api/pro/waitlist", headers=owner).json()
    assert any(e["status"] == "notified" and e["customer"]["name"] == "ממתין" for e in wl)


def test_reminders_scheduled_and_cancelled(client, owner):
    svc, slots = first_open_slot(client)
    b = book(client, svc, slots[0]).json()
    out = client.get("/api/pro/notifications", headers=owner).json()
    mine = [n for n in out if n["to"] == "+972521234567"]
    kinds = {n["kind"] for n in mine}
    assert {"booked", "reminder_24h", "reminder_2h"} <= kinds
    client.post(f"/api/manage/{b['uid']}/cancel", json={"t": b["manage_token"]})
    out = client.get("/api/pro/notifications", headers=owner).json()
    assert all(n["status"] == "cancelled" for n in out if n["kind"].startswith("reminder") and n["to"] == "+972521234567")


def test_customer_otp_and_my_bookings(client):
    svc, slots = first_open_slot(client)
    book(client, svc, slots[0], phone="052-7654321")
    code = client.post("/api/b/gal-barbers/otp", json={"phone": "0527654321"}).json()["dev_code"]
    assert client.post("/api/b/gal-barbers/otp/verify", json={"phone": "0527654321", "code": "000000x"}).status_code == 401
    tok = client.post("/api/b/gal-barbers/otp/verify", json={"phone": "0527654321", "code": code}).json()["token"]
    mine = client.get("/api/me/bookings", headers={"Authorization": f"Bearer {tok}"}).json()
    assert len(mine["upcoming"]) == 1


def test_walk_in_queue(client, owner):
    page = client.get("/api/b/gal-barbers").json()
    sid = page["services"][0]["id"]
    t = client.post("/api/b/gal-barbers/queue", json={"service_id": sid, "name": "אורח", "phone": "0501231231"}).json()
    assert t["status"] == "waiting" and t["position"] == 4  # seed has 3 waiting
    for _ in range(4):
        assert client.post("/api/pro/queue/call-next", headers=owner).status_code == 200
    assert client.get(f"/api/queue/{t['uid']}").json()["status"] == "called"


def test_staff_cannot_touch_others(client):
    tok = client.post("/api/pro/login", json={"email": "dana@barber.demo", "password": "demo1234"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/pro/schedule", params={"provider_id": 1}, headers=h).status_code == 403
    rows = client.get("/api/pro/bookings", params={"start": "2020-01-01", "end": "2030-01-01"}, headers=h).json()
    assert rows and all(r["provider"]["name"] == "דנה שגיא" for r in rows)


def test_schedule_edit_changes_slots(client, owner):
    me = client.get("/api/pro/me", headers=owner).json()
    svc = next(s for s in me["services"] if s["name"] == "עיצוב זקן")
    d = date.today() + timedelta(days=5)
    client.post("/api/pro/overrides", json={"date": d.isoformat()}, headers=owner)  # owner (gal) off that day
    slots = client.get("/api/b/gal-barbers/slots", params={"service_id": svc["id"], "date": d.isoformat(), "provider_id": me["me"]["id"]}).json()
    assert slots == []


def test_stats(client, owner):
    end = date.today()
    start = end - timedelta(days=30)
    s = client.get("/api/pro/stats", params={"start": start.isoformat(), "end": end.isoformat()}, headers=owner).json()
    assert s["bookings"] > 100
    assert 0 < s["utilization"] <= 1
    assert 0 <= s["no_show_rate"] < 0.2
