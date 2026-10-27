import importlib
import json
import os
import secrets
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi.testclient import TestClient
from redis import Redis
from sqlalchemy import delete
from sqlalchemy.orm import sessionmaker

from deadlock.account.models import Account, Favorite
from deadlock.auth.router import _token_key, STEAM_ID_BASE
from deadlock.main import create_app


import pytest


@pytest.fixture(autouse=True)
def clear_auth_rate_limit_keys():
    redis_url = os.environ.get("TEST_REDIS_URL")
    if not redis_url:
        yield
        return
    redis = Redis.from_url(redis_url)
    for key in redis.scan_iter(match="deadlock:auth:rate:*"):
        redis.delete(key)
    yield
    for key in redis.scan_iter(match="deadlock:auth:rate:*"):
        redis.delete(key)
    redis.close()


def _seed_accounts(db, *account_ids):
    for account_id in account_ids:
        db.merge(Account(account_id=account_id, steam_id64=str(STEAM_ID_BASE + account_id)))
    db.commit()


def _token(redis, account_id):
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    redis.set(_token_key(token), json.dumps({"account_id": account_id, "csrf_token": csrf}), ex=60)
    return token, csrf


def test_favorites_preferences_logout_csrf_and_cache_headers(live_dependencies, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://127.0.0.1:8080")
    app = create_app()
    token_a, token_b = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    csrf_a, csrf_b = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    headers_a = {"Origin": "http://127.0.0.1:8080", "X-CSRF-Token": csrf_a}
    try:
        with TestClient(app) as client:
            factory = app.state.session_factory
            with factory() as db:
                _seed_accounts(db, 301, 302)
            redis.set(_token_key(token_a), json.dumps({"account_id": 301, "csrf_token": csrf_a}), ex=60)
            redis.set(_token_key(token_b), json.dumps({"account_id": 302, "csrf_token": csrf_b}), ex=60)
            login = client.get("/api/v1/auth/login", follow_redirects=False)
            assert login.status_code == 302
            assert login.headers["cache-control"] == "no-store"
            client.cookies.set("deadlock_session", token_a, domain="testserver.local", path="/")
            assert client.get("/api/v1/auth/me").headers["cache-control"] == "no-store"
            assert client.post("/api/v1/account/favorites", json={"account_id": "42"}).status_code == 403
            wrong_origin = {"Origin": "https://attacker.example", "X-CSRF-Token": csrf_a}
            assert client.post("/api/v1/account/favorites", json={"account_id": "42"}, headers=wrong_origin).status_code == 403
            wrong_csrf = {"Origin": "http://127.0.0.1:8080", "X-CSRF-Token": "incorrect"}
            assert client.post("/api/v1/account/favorites", json={"account_id": "42"}, headers=wrong_csrf).status_code == 403
            added = client.post("/api/v1/account/favorites", json={"account_id": "42"}, headers=headers_a)
            assert added.status_code == 200
            assert added.headers["cache-control"] == "no-store"
            client.cookies.set("deadlock_session", token_b, domain="testserver.local", path="/")
            favorites = client.get("/api/v1/account/favorites")
            assert favorites.json()["data"] == []
            assert favorites.headers["cache-control"] == "no-store"
            redis.delete(_token_key(token_b))
            assert client.get("/api/v1/auth/me").json()["data"] is None
            client.cookies.set("deadlock_session", token_a, domain="testserver.local", path="/")
            assert client.patch("/api/v1/account/preferences", json={"default_period": "5"}, headers=headers_a).status_code == 422
            saved = client.patch("/api/v1/account/preferences", json={"default_period": "90"}, headers=headers_a)
            assert saved.status_code == 200 and saved.json()["data"]["default_period"] == "90"
            removed_seed = client.delete("/api/v1/account/favorites/42", headers=headers_a)
            assert removed_seed.status_code == 200
            with factory() as db:
                db.execute(delete(Favorite).where(Favorite.owner_id == 301))
                db.add_all([Favorite(owner_id=301, account_id=i) for i in range(1000, 1100)])
                db.flush()
                assert db.query(Favorite).filter_by(owner_id=301).count() == 100
                db.commit()
            limited = client.post("/api/v1/account/favorites", json={"account_id": "1100"}, headers=headers_a)
            assert limited.status_code == 409
            assert limited.headers["cache-control"] == "no-store"
            removed = client.delete("/api/v1/account/favorites/42", headers=headers_a)
            assert removed.status_code == 200 and removed.headers["cache-control"] == "no-store"
            logged_out = client.post("/api/v1/auth/logout", headers=headers_a)
            assert logged_out.status_code == 200 and logged_out.headers["cache-control"] == "no-store"
            assert client.get("/api/v1/auth/me").json()["data"] is None
    finally:
        redis.delete(_token_key(token_a), _token_key(token_b))
        with app.state.session_factory() as db:
            db.execute(delete(Favorite).where(Favorite.owner_id.in_([301, 302])))
            db.execute(delete(Account).where(Account.account_id.in_([301, 302])))
            db.commit()
        redis.close()


def test_callback_rotates_and_invalidates_previous_session(live_dependencies, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://127.0.0.1:8080")
    auth_module = importlib.import_module("deadlock.auth.router")
    monkeypatch.setattr(auth_module, "_verified_assertion", lambda _params, _return_to: 303)
    app = create_app()
    old_token = secrets.token_urlsafe(32)
    old_csrf = secrets.token_urlsafe(32)
    state = secrets.token_urlsafe(32)
    nonce = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + secrets.token_hex(8)
    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    try:
        with TestClient(app) as client:
            redis.set("deadlock:auth:state:" + state, "1", ex=600)
            redis.set(_token_key(old_token), json.dumps({"account_id": 301, "csrf_token": old_csrf}), ex=600)
            client.cookies.set("deadlock_login_state", state, domain="testserver.local", path="/")
            client.cookies.set("deadlock_session", old_token, domain="testserver.local", path="/")
            app.state.steam_provider.fetch_player = lambda _account_id: (_ for _ in ()).throw(RuntimeError("offline"))
            query = urlencode({"state": state, "openid.response_nonce": nonce})
            callback = client.get("/api/v1/auth/callback?" + query, follow_redirects=False)
            assert callback.status_code == 303
            assert callback.headers["location"] == "http://127.0.0.1:8080/players/303"
            assert callback.headers["cache-control"] == "no-store"
            assert redis.get(_token_key(old_token)) is None
            new_token = client.cookies.get("deadlock_session")
            assert new_token and new_token != old_token
            client.cookies.set("deadlock_session", old_token, domain="testserver.local", path="/")
            assert client.get("/api/v1/auth/me").json()["data"] is None
            client.cookies.set("deadlock_session", new_token, domain="testserver.local", path="/")
            me = client.get("/api/v1/auth/me")
            assert me.json()["data"]["account_id"] == "303"
            assert me.headers["cache-control"] == "no-store"
            state2 = secrets.token_urlsafe(32)
            redis.set("deadlock:auth:state:" + state2, "1", ex=600)
            client.cookies.set("deadlock_login_state", state2, domain="testserver.local", path="/")
            replay = client.get("/api/v1/auth/callback?" + urlencode({"state": state2, "openid.response_nonce": nonce}), follow_redirects=False)
            assert replay.status_code == 401
    finally:
        redis.delete(_token_key(old_token), "deadlock:auth:state:" + state, "deadlock:auth:state:" + locals().get("state2", ""))
        with app.state.session_factory() as db:
            db.execute(delete(Favorite).where(Favorite.owner_id == 303))
            db.execute(delete(Account).where(Account.account_id == 303))
            db.commit()
        redis.close()


def test_callback_rejects_missing_mismatched_and_expired_state(live_dependencies, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "http://127.0.0.1:8080")
    app = create_app()
    try:
        with TestClient(app) as client:
            missing = client.get("/api/v1/auth/callback")
            assert missing.status_code == 400
            duplicate = client.get("/api/v1/auth/callback?state=one&state=two")
            assert duplicate.status_code == 400
            client.cookies.set("deadlock_login_state", "cookie-state", domain="testserver.local", path="/")
            mismatch = client.get("/api/v1/auth/callback?state=query-state")
            assert mismatch.status_code == 400
            client.cookies.set("deadlock_login_state", "expired-state", domain="testserver.local", path="/")
            expired = client.get("/api/v1/auth/callback?state=expired-state")
            assert expired.status_code == 400
    finally:
        app.state.redis.close()
        app.state.engine.dispose()
