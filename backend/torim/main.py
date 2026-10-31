from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import notifications
from .api import ai, provider, public
from .db import Base, SessionLocal, engine

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")


async def _dispatcher():
    while True:
        try:
            with SessionLocal() as db:
                notifications.dispatch_due(db)
        except Exception:  # pragma: no cover
            logging.getLogger("torim").exception("dispatcher failed")
        await asyncio.sleep(float(os.environ.get("TORIM_DISPATCH_SECONDS", "20")))


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    if os.environ.get("TORIM_SEED", "0") == "1":
        from .seed import seed_if_empty

        seed_if_empty()
    task = asyncio.create_task(_dispatcher()) if os.environ.get("TORIM_DISPATCH", "1") == "1" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="TORIM API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("TORIM_CORS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(public.router)
app.include_router(provider.router)
app.include_router(ai.router)


@app.get("/api/health")
def health():
    return {"ok": True}


# Serve the built front-ends when they exist (docker image / `make build`).
_root = Path(__file__).resolve().parents[2] / "apps"
for name, mount in (("provider", "/pro"), ("client", "")):
    dist = _root / name / "dist"
    if dist.is_dir():
        index = dist / "index.html"
        app.mount(f"{mount}/assets", StaticFiles(directory=dist / "assets"), name=f"{name}-assets")

        def _spa(path: str = "", _index=index, _dist=dist):
            candidate = (_dist / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(_dist.resolve()):
                return FileResponse(candidate)
            return FileResponse(_index)

        app.add_api_route(f"{mount}/{{path:path}}" if mount else "/{path:path}", _spa, include_in_schema=False)
        if mount:
            app.add_api_route(mount, _spa, include_in_schema=False)
