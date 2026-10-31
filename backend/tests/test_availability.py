from datetime import date, datetime, time, timedelta, timezone

from torim import availability as av

TZ = "Asia/Jerusalem"
UTC = timezone.utc
DAY = date(2026, 11, 2)  # Monday
NOW = datetime(2026, 11, 1, 8, 0, tzinfo=UTC)


def local(h, m=0, d=DAY):
    from zoneinfo import ZoneInfo

    return datetime.combine(d, time(h, m), tzinfo=ZoneInfo(TZ)).astimezone(UTC)


def cal(**kw):
    return av.ProviderCalendar(TZ, {0: av.DayRule(time(9), time(12), ((time(10), time(10, 30)),))}, **kw)


def hhmm(slots):
    from zoneinfo import ZoneInfo

    return [s.astimezone(ZoneInfo(TZ)).strftime("%H:%M") for s in slots]


def test_merge_and_subtract():
    a = datetime(2026, 1, 1, tzinfo=UTC)
    h = lambda n: a + timedelta(hours=n)  # noqa: E731
    assert av.merge([(h(0), h(2)), (h(1), h(3)), (h(5), h(6))]) == [(h(0), h(3)), (h(5), h(6))]
    assert av.subtract([(h(0), h(10))], [(h(2), h(3)), (h(5), h(6))]) == [(h(0), h(2)), (h(3), h(5)), (h(6), h(10))]
    assert av.subtract([(h(0), h(1))], [(h(0), h(1))]) == []


def test_breaks_split_the_day():
    s = av.ServiceRule(1, duration=30)
    assert hhmm(av.slots_for_day(cal(), DAY, s, NOW, step=30)) == ["09:00", "09:30", "10:30", "11:00", "11:30"]


def test_bookings_and_buffers_block_time():
    s = av.ServiceRule(1, duration=30, buffer_after=10)
    c = cal(bookings=[av.ExistingBooking(local(11), local(11, 30), 1, 0, 10)])
    # 10:30 slot would end 11:00 + 10 min buffer -> overlaps the 11:00 booking
    # 11:30 is blocked by the existing booking's own after-buffer (until 11:40)
    assert hhmm(av.slots_for_day(c, DAY, s, NOW, step=30)) == ["09:00", "09:30"]


def test_buffer_may_hang_past_closing_time():
    s = av.ServiceRule(1, duration=30, buffer_after=15)
    assert "11:30" in hhmm(av.slots_for_day(cal(), DAY, s, NOW, step=30))


def test_min_notice_and_horizon():
    s = av.ServiceRule(1, duration=30, min_notice=60)
    now = local(9, 10)
    assert hhmm(av.slots_for_day(cal(), DAY, s, now, step=30))[0] == "10:30"
    far = av.ServiceRule(1, duration=30, max_days_ahead=3)
    assert av.slots_for_day(cal(), DAY + timedelta(days=7), far, NOW) == []


def test_override_and_day_off():
    s = av.ServiceRule(1, duration=60)
    c = cal(overrides={DAY: av.DayRule(time(14), time(16))})
    assert hhmm(av.slots_for_day(c, DAY, s, NOW, step=60)) == ["14:00", "15:00"]
    off = cal(overrides={DAY: None})
    assert av.slots_for_day(off, DAY, s, NOW) == []


def test_time_off_and_holds():
    s = av.ServiceRule(1, duration=30)
    c = cal(time_off=[(local(9), local(10))], holds=[(local(11), local(11, 30))])
    assert hhmm(av.slots_for_day(c, DAY, s, NOW, step=30)) == ["10:30", "11:30"]


def test_group_capacity():
    s = av.ServiceRule(7, duration=60, capacity=2)
    seat = av.ExistingBooking(local(9), local(10), 7)
    one = cal(bookings=[seat])
    assert "09:00" in hhmm(av.slots_for_day(one, DAY, s, NOW, step=60))
    full = cal(bookings=[seat, seat])
    assert "09:00" not in hhmm(av.slots_for_day(full, DAY, s, NOW, step=60))
    # a private booking of another service blocks the group slot entirely
    other = cal(bookings=[av.ExistingBooking(local(9), local(10), 1)])
    assert "09:00" not in hhmm(av.slots_for_day(other, DAY, s, NOW, step=60))


def test_daylight_saving_day():
    # Israel leaves DST on Sunday 2026-10-25; local hours must stay 09:00-12:00
    d = date(2026, 10, 25)
    c = av.ProviderCalendar(TZ, {6: av.DayRule(time(9), time(12))})
    slots = av.slots_for_day(c, d, av.ServiceRule(1, duration=60), datetime(2026, 10, 20, tzinfo=UTC), step=60)
    assert hhmm(slots) == ["09:00", "10:00", "11:00"]
    assert slots[0] == datetime(2026, 10, 25, 7, 0, tzinfo=UTC)  # UTC+2 after the change
