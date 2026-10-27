"""Steam OpenID login, opaque Redis sessions, and account-owned preferences."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from redis.exceptions import RedisError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from deadlock.core.db import get_session
from deadlock.players.models import Player
from deadlock.account.models import Account, Favorite

router = APIRouter(tags=["auth", "account"])
OPENID_ENDPOINT = "https://steamcommunity.com/openid/login"
STEAM_ID_BASE = 76561197960265728
SESSION_SECONDS = 7 * 86400
STATE_SECONDS = 600
NONCE_SECONDS = 300
SIGNED = {"op_endpoint", "claimed_id", "identity", "return_to", "response_nonce", "assoc_handle"}
PERIODS = {"7", "30", "90", "all"}


class FavoriteBody(BaseModel):
    account_id: str = Field(pattern=r"^[0-9]{1,10}$")


class PreferenceBody(BaseModel):
    default_period: str = Field(pattern=r"^(7|30|90|all)$")


def _redis(request: Request):
    try:
        request.app.state.redis.ping()
        return request.app.state.redis
    except (RedisError, OSError, TimeoutError):
        raise HTTPException(503, "session_store_unavailable") from None


def _base(request: Request) -> str:
    return request.app.state.settings.public_base_url.rstrip("/")


def _limiter(request: Request, action: str, limit: int = 12) -> None:
    redis = _redis(request)
    key = f"deadlock:auth:rate:{action}:{request.client.host if request.client else 'unknown'}"
    try:
        count = redis.incr(key)
        if count == 1:
            redis.expire(key, 60)
        if count > limit:
            raise HTTPException(429, "rate_limited")
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None


def _callback_url(request: Request, state: str) -> str:
    return f"{_base(request)}/api/v1/auth/callback?state={state}"


def _identity(value: str) -> int:
    match = re.fullmatch(r"https?://steamcommunity\.com/openid/id/([0-9]{17})", value)
    if not match:
        raise HTTPException(400, "invalid_steam_identity")
    steam64 = int(match.group(1))
    account_id = steam64 - STEAM_ID_BASE
    if not 0 < account_id <= 4294967295:
        raise HTTPException(400, "invalid_steam_identity")
    return account_id


def _params(request: Request) -> dict[str, str]:
    raw = request.scope["query_string"]
    if len(raw) > 8192:
        raise HTTPException(400, "openid_response_too_large")
    try:
        query = raw.decode("ascii", "strict")
    except UnicodeDecodeError:
        raise HTTPException(400, "invalid_openid_response") from None
    pairs = parse_qsl(query, keep_blank_values=True)
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "duplicate_openid_parameter")
    result = dict(pairs)
    if any(key != "state" and not key.startswith("openid.") for key in result):
        raise HTTPException(400, "invalid_openid_response")
    return result


def _parse_verification_response(body: bytes) -> bool:
    if len(body) > 8192:
        raise HTTPException(502, "steam_verification_invalid")
    try:
        lines = body.decode("ascii", "strict").splitlines()
    except UnicodeDecodeError:
        raise HTTPException(502, "steam_verification_invalid") from None
    fields: dict[str, str] = {}
    for line in lines:
        if not line:
            raise HTTPException(502, "steam_verification_invalid")
        key, separator, value = line.partition(":")
        if not separator or not re.fullmatch(r"[a-z_]+", key) or not value or key in fields:
            raise HTTPException(502, "steam_verification_invalid")
        fields[key] = value
    if fields.get("ns") != "http://specs.openid.net/auth/2.0" or fields.get("is_valid") not in {"true", "false"}:
        raise HTTPException(502, "steam_verification_invalid")
    return fields["is_valid"] == "true"


def _verified_assertion(params: dict[str, str], expected_return: str) -> int:
    get = lambda name: params.get("openid." + name, "")
    if get("ns") != "http://specs.openid.net/auth/2.0" or get("mode") != "id_res":
        raise HTTPException(400, "invalid_openid_response")
    if get("op_endpoint") != OPENID_ENDPOINT or get("return_to") != expected_return:
        raise HTTPException(400, "invalid_openid_response")
    account_id = _identity(get("identity"))
    if _identity(get("claimed_id")) != account_id:
        raise HTTPException(400, "invalid_openid_response")
    signed = set(get("signed").split(","))
    if not SIGNED.issubset(signed):
        raise HTTPException(400, "invalid_openid_signature_fields")
    nonce = get("response_nonce")
    try:
        stamp = datetime.strptime(nonce[:20], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(400, "invalid_openid_nonce") from None
    age = (datetime.now(timezone.utc) - stamp).total_seconds()
    if age < -30 or age > NONCE_SECONDS:
        raise HTTPException(400, "expired_openid_nonce")
    payload = {key: value for key, value in params.items() if key.startswith("openid.")}
    payload["openid.mode"] = "check_authentication"
    try:
        with httpx.Client(timeout=httpx.Timeout(4, connect=2), follow_redirects=False) as client:
            with client.stream("POST", OPENID_ENDPOINT, data=payload) as response:
                if response.status_code != 200:
                    raise HTTPException(502, "steam_verification_unavailable")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 8192:
                        raise HTTPException(502, "steam_verification_invalid")
        verified = _parse_verification_response(bytes(body))
    except httpx.HTTPError:
        raise HTTPException(502, "steam_verification_unavailable") from None
    if not verified:
        raise HTTPException(401, "steam_assertion_rejected")
    return account_id


def _token_key(token: str) -> str:
    return "deadlock:auth:session:" + hashlib.sha256(token.encode()).hexdigest()


def _session(request: Request) -> tuple[dict | None, str | None]:
    token = request.cookies.get("deadlock_session")
    if not token:
        return None, None
    try:
        raw = _redis(request).get(_token_key(token))
        if raw is None:
            return None, None
        if isinstance(raw, bytes):
            raw = raw.decode()
        data = json.loads(raw)
        if not isinstance(data, dict) or not isinstance(data.get("account_id"), int):
            return None, None
        return data, token
    except (RedisError, OSError, ValueError, TypeError):
        raise HTTPException(503, "session_store_unavailable") from None


def _csrf(request: Request, token: str) -> dict:
    session, _ = _session(request)
    origin = request.headers.get("origin")
    parsed = urlsplit(_base(request))
    expected_origin = f"{parsed.scheme}://{parsed.netloc}"
    if session is None or not token or origin != expected_origin:
        raise HTTPException(403, "csrf_rejected")
    supplied = request.headers.get("x-csrf-token", "")
    if not hmac.compare_digest(supplied, str(session.get("csrf_token", ""))):
        raise HTTPException(403, "csrf_rejected")
    return session


def _envelope(data, **meta):
    return {"data": data, "meta": meta}


def _cookie(response: Response, request: Request, key: str, value: str, max_age: int) -> None:
    response.set_cookie(key, value, max_age=max_age, httponly=True, secure=request.app.state.settings.public_base_url.startswith("https://"),
                        samesite="lax", path="/", domain=None)


@router.get("/auth/login")
def login(request: Request):
    _limiter(request, "login")
    redis = _redis(request)
    state = secrets.token_urlsafe(32)
    try:
        if not redis.set("deadlock:auth:state:" + state, "1", ex=STATE_SECONDS, nx=True):
            raise HTTPException(503, "session_store_unavailable")
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None
    return_to = _callback_url(request, state)
    query = urlencode({
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": _base(request),
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    })
    response = RedirectResponse(OPENID_ENDPOINT + "?" + query, status_code=302)
    _cookie(response, request, "deadlock_login_state", state, STATE_SECONDS)
    return response


@router.get("/auth/callback")
def callback(request: Request, session: Session = Depends(get_session)):
    _limiter(request, "callback")
    params = _params(request)
    state = params.get("state", "")
    cookie_state = request.cookies.get("deadlock_login_state", "")
    if not state or not cookie_state or not hmac.compare_digest(state, cookie_state):
        raise HTTPException(400, "login_state_mismatch")
    redis = _redis(request)
    try:
        if redis.getdel("deadlock:auth:state:" + state) is None:
            raise HTTPException(400, "login_state_expired")
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None
    account_id = _verified_assertion(params, _callback_url(request, state))
    nonce = params["openid.response_nonce"]
    try:
        if not redis.set("deadlock:auth:nonce:" + hashlib.sha256(nonce.encode()).hexdigest(), "1",
                         ex=NONCE_SECONDS, nx=True):
            raise HTTPException(401, "openid_replay")
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None
    steam_id64 = str(STEAM_ID_BASE + account_id)
    personaname = None
    avatar_url = None
    try:
        provider = request.app.state.steam_provider
        profile = provider.fetch_player(account_id)
        personaname, avatar_url = profile.personaname, profile.avatar_url
    except Exception:
        pass
    try:
        session.execute(insert(Account).values(account_id=account_id, steam_id64=steam_id64,
                          personaname=personaname, avatar_url=avatar_url)
                        .on_conflict_do_update(index_elements=[Account.account_id], set_={
                            "steam_id64": steam_id64,
                            "personaname": func.coalesce(personaname, Account.personaname),
                            "avatar_url": func.coalesce(avatar_url, Account.avatar_url),
                        }))
        session.execute(insert(Player).values(account_id=account_id, personaname=personaname, avatar_url=avatar_url)
                        .on_conflict_do_update(index_elements=[Player.account_id], set_={
                            "personaname": func.coalesce(personaname, Player.personaname),
                            "avatar_url": func.coalesce(avatar_url, Player.avatar_url),
                        }))
        session.commit()
        default_period = session.get(Account, account_id).default_period
    except SQLAlchemyError:
        session.rollback()
        raise HTTPException(503, "account_store_unavailable") from None
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    old_token = request.cookies.get("deadlock_session")
    try:
        pipeline = redis.pipeline(transaction=True)
        if old_token:
            pipeline.delete(_token_key(old_token))
        pipeline.set(_token_key(token), json.dumps({"account_id": account_id, "csrf_token": csrf}),
                     ex=SESSION_SECONDS)
        pipeline.execute()
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None
    response = RedirectResponse(f"{_base(request)}/players/{account_id}", status_code=303)
    _cookie(response, request, "deadlock_session", token, SESSION_SECONDS)
    response.delete_cookie("deadlock_login_state", path="/", secure=request.app.state.settings.public_base_url.startswith("https://"),
                           httponly=True, samesite="lax")
    return response


@router.get("/auth/me")
def me(request: Request, db: Session = Depends(get_session)):
    value, _token = _session(request)
    if value is None:
        return _envelope(None, source="session")
    account = db.get(Account, value["account_id"])
    if account is None:
        raise HTTPException(503, "account_store_unavailable")
    return _envelope({"account_id": str(account.account_id), "personaname": account.personaname,
                      "avatar_url": account.avatar_url, "default_period": account.default_period,
                      "csrf_token": value["csrf_token"]}, source="session")


@router.post("/auth/logout")
def logout(request: Request):
    value, token = _session(request)
    if value is None or token is None:
        raise HTTPException(401, "authentication_required")
    _csrf(request, token)
    try:
        _redis(request).delete(_token_key(token))
    except RedisError:
        raise HTTPException(503, "session_store_unavailable") from None
    response = JSONResponse(_envelope(True, source="session"))
    response.delete_cookie("deadlock_session", path="/", secure=request.app.state.settings.public_base_url.startswith("https://"),
                           httponly=True, samesite="lax")
    return response


def _account(request: Request) -> tuple[dict, str]:
    value, token = _session(request)
    if value is None or token is None:
        raise HTTPException(401, "authentication_required")
    return _csrf(request, token), token


@router.get("/account/favorites")
def favorites(request: Request, db: Session = Depends(get_session)):
    value, _ = _session(request)
    if value is None:
        raise HTTPException(401, "authentication_required")
    rows = db.execute(select(Favorite.account_id, Player.personaname, Player.avatar_url)
                      .outerjoin(Player, Player.account_id == Favorite.account_id)
                      .where(Favorite.owner_id == value["account_id"]).order_by(Favorite.created_at)).all()
    return _envelope([{"account_id": str(r.account_id), "personaname": r.personaname or str(r.account_id),
                       "avatar_url": r.avatar_url} for r in rows], source="account")


@router.post("/account/favorites")
def add_favorite(body: FavoriteBody, request: Request, db: Session = Depends(get_session)):
    value, _ = _account(request)
    account_id = int(body.account_id)
    if not 0 < account_id <= 4294967295:
        raise HTTPException(422, "invalid_account_id")
    try:
        db.execute(select(Account.account_id).where(Account.account_id == value["account_id"]).with_for_update())
        if db.scalar(select(func.count()).select_from(Favorite).where(Favorite.owner_id == value["account_id"])) >= 100:
            raise HTTPException(409, "favorite_limit_reached")
        db.execute(insert(Favorite).values(owner_id=value["account_id"], account_id=account_id).on_conflict_do_nothing())
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(503, "account_store_unavailable") from None
    return _envelope({"account_id": str(account_id)}, source="account")


@router.delete("/account/favorites/{account_id}")
def remove_favorite(account_id: str, request: Request, db: Session = Depends(get_session)):
    value, _ = _account(request)
    if not re.fullmatch(r"[0-9]{1,10}", account_id) or not 0 < int(account_id) <= 4294967295:
        raise HTTPException(422, "invalid_account_id")
    db.execute(delete(Favorite).where(Favorite.owner_id == value["account_id"], Favorite.account_id == int(account_id)))
    db.commit()
    return _envelope(True, source="account")


@router.patch("/account/preferences")
def update_preferences(body: PreferenceBody, request: Request, db: Session = Depends(get_session)):
    value, _ = _account(request)
    account = db.get(Account, value["account_id"])
    if account is None:
        raise HTTPException(503, "account_store_unavailable")
    account.default_period = body.default_period
    db.commit()
    return _envelope({"default_period": account.default_period}, source="account")
