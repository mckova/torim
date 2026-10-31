"""Small, dependency-free auth: scrypt password hashes and HMAC-signed tokens.

Providers sign in with email + password. Customers sign in with their phone
number and a one-time code (sent over WhatsApp/SMS in production; returned in
the response when TORIM_DEV_OTP=1 so the demo works without a gateway).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import Depends, Header, HTTPException

SECRET = os.environ.get("TORIM_SECRET", "dev-secret-change-me").encode()
TOKEN_TTL = 60 * 60 * 24 * 14


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(kind: str, subject: int, business_id: int) -> str:
    payload = {"k": kind, "sub": subject, "biz": business_id, "exp": int(time.time()) + TOKEN_TTL}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{sig}"


def read_token(token: str) -> dict:
    try:
        body, sig = token.split(".")
    except ValueError:
        raise HTTPException(401, "invalid token")
    expected = _b64(hmac.new(SECRET, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "invalid token")
    payload = json.loads(_unb64(body))
    if payload["exp"] < time.time():
        raise HTTPException(401, "token expired")
    return payload


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    return authorization.split(" ", 1)[1]


def provider_claims(authorization: str | None = Header(default=None)) -> dict:
    claims = read_token(_bearer(authorization))
    if claims["k"] != "provider":
        raise HTTPException(403, "provider token required")
    return claims


def customer_claims(authorization: str | None = Header(default=None)) -> dict:
    claims = read_token(_bearer(authorization))
    if claims["k"] != "customer":
        raise HTTPException(403, "customer token required")
    return claims


ProviderAuth = Depends(provider_claims)
CustomerAuth = Depends(customer_claims)
