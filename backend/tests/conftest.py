import os
import tempfile

_tmp = tempfile.mkdtemp()
os.environ["TORIM_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["TORIM_DISPATCH"] = "0"
os.environ["TORIM_DEV_OTP"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from torim.db import Base, SessionLocal, engine  # noqa: E402
from torim.main import app  # noqa: E402
from torim.seed import build  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        build(db)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def owner(client):
    r = client.post("/api/pro/login", json={"email": "owner@barber.demo", "password": "demo1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}
