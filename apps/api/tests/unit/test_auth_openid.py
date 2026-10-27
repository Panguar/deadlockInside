from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from deadlock.auth import router as auth
from deadlock.auth.router import _identity, _verified_assertion, STEAM_ID_BASE


NAMESPACE = "http://specs.openid.net/auth/2.0"
RETURN_TO = "http://127.0.0.1:8080/api/v1/auth/callback?state=s"


def assertion(**overrides):
    values = {
        "openid.ns": NAMESPACE,
        "openid.mode": "id_res",
        "openid.op_endpoint": auth.OPENID_ENDPOINT,
        "openid.return_to": RETURN_TO,
        "openid.identity": f"https://steamcommunity.com/openid/id/{STEAM_ID_BASE + 42}",
        "openid.claimed_id": f"https://steamcommunity.com/openid/id/{STEAM_ID_BASE + 42}",
        "openid.response_nonce": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") + "nonce",
        "openid.assoc_handle": "handle",
        "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
        "openid.sig": "signature",
    }
    values.update(overrides)
    return values


class FakeResponse:
    status_code = 200

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def iter_bytes(self):
        yield self.body


class FakeClient:
    body = b"ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"

    def __init__(self, **_kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def stream(self, method, url, *, data):
        assert method == "POST"
        assert url == auth.OPENID_ENDPOINT
        assert data["openid.mode"] == "check_authentication"
        return FakeResponse(self.body)


def test_identity_accepts_canonical_http_and_https_steam_ids():
    steam_id = str(STEAM_ID_BASE + 42)
    assert _identity(f"https://steamcommunity.com/openid/id/{steam_id}") == 42
    assert _identity(f"http://steamcommunity.com/openid/id/{steam_id}") == 42


@pytest.mark.parametrize("value", [
    "https://evil.example/openid/id/76561197960265770",
    "https://steamcommunity.com.evil.test/openid/id/76561197960265770",
    "https://www.steamcommunity.com/openid/id/76561197960265770",
    "https://steamcommunity.com/openid/id/76561197960265728",
    "https://steamcommunity.com/openid/id/76561197960265770?next=evil",
])
def test_identity_rejects_noncanonical_or_invalid_ids(value):
    with pytest.raises(HTTPException):
        _identity(value)


def test_assertion_is_verified_with_steam(monkeypatch):
    monkeypatch.setattr(auth.httpx, "Client", FakeClient)
    assert _verified_assertion(assertion(), RETURN_TO) == 42


@pytest.mark.parametrize("body", [
    b"ns:http://specs.openid.net/auth/2.0\nis_valid:false\n",
    b"ns:http://specs.openid.net/auth/2.0\nis_valid:true\nis_valid:false\n",
    b"ns:http://specs.openid.net/auth/2.0\nis_valid:true\nis_valid:true\n",
    b"ns:http://wrong.example/\nis_valid:true\n",
    b"ns:http://specs.openid.net/auth/2.0\nis_valid:true\nmalformed\n",
    b"is_valid:true\n",
])
def test_assertion_rejects_false_duplicate_or_malformed_verification(monkeypatch, body):
    class Client(FakeClient):
        pass
    Client.body = body
    monkeypatch.setattr(auth.httpx, "Client", Client)
    with pytest.raises(HTTPException):
        _verified_assertion(assertion(), RETURN_TO)


def test_assertion_rejects_unsafe_return_to_before_network():
    params = assertion(**{"openid.return_to": "https://attacker.example/callback"})
    with pytest.raises(HTTPException) as error:
        _verified_assertion(params, RETURN_TO)
    assert error.value.status_code == 400


def test_assertion_rejects_expired_nonce_before_network():
    expired = (datetime.now(timezone.utc) - timedelta(minutes=6)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with pytest.raises(HTTPException) as error:
        _verified_assertion(assertion(**{"openid.response_nonce": expired + "old"}), RETURN_TO)
    assert error.value.status_code == 400


def test_assertion_rejects_missing_signed_fields_before_network():
    params = assertion(**{"openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce"})
    with pytest.raises(HTTPException) as error:
        _verified_assertion(params, RETURN_TO)
    assert error.value.status_code == 400
