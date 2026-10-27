import httpx
import pytest

from deadlock.providers.steam import SteamProvider, parse_profile_url
from deadlock.providers.deadlock_api import DeadlockProvider, ProviderBadResponse, ProviderUnavailable


BASE = 76561197960265728


@pytest.fixture(autouse=True)
def no_live_steam_key(monkeypatch):
    monkeypatch.delenv("STEAM_API_KEY", raising=False)


@pytest.mark.parametrize("url,expected", [
    ("https://steamcommunity.com/id/example/", "example"),
    (f"https://steamcommunity.com/profiles/{BASE + 123}/", 123),
])
def test_profile_urls(url, expected):
    assert parse_profile_url(url) == expected


@pytest.mark.parametrize("url", [
    "https://steamcommunity.com.evil/id/test", "https://evil.test/id/test",
    "https://user@steamcommunity.com/id/test", "http://steamcommunity.com/id/test",
    "https://steamcommunity.com:444/id/test", "https://steamcommunity.com/profiles/123",
    "https://steamcommunity.com/id/a/b", "https://steamcommunity.com/id/a?x=1",
])
def test_reject_untrusted_urls(url):
    with pytest.raises(ValueError):
        parse_profile_url(url)


def test_fetch_and_resolve():
    def handle(request):
        assert request.url.host == "api.steampowered.com"
        assert request.headers["x-webapi-key"] == "test-key"
        assert "key" not in request.url.params
        if "ResolveVanityURL" in request.url.path:
            return httpx.Response(200, json={"response": {"success": 1, "steamid": str(BASE + 123)}})
        assert request.url.params["steamids"] == str(BASE + 123)
        return httpx.Response(200, json={"response": {"players": [
            {"steamid": str(BASE + 123), "personaname": "Example", "avatarfull": "https://example.test/a.jpg"}
        ]}})
    steam = SteamProvider("test-key", client=httpx.Client(transport=httpx.MockTransport(handle)))
    assert steam.resolve_vanity("example") == 123
    assert steam.fetch_player(123).personaname == "Example"


def test_identity_mismatch():
    steam = SteamProvider("key", client=httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"response": {"players": [
            {"steamid": str(BASE + 124), "personaname": "Wrong"}
        ]}}))))
    with pytest.raises(ProviderBadResponse):
        steam.fetch_player(123)


class Limiter:
    def acquire(self, bucket):
        return None


def test_steam_profile_survives_rank_failure():
    class Steam:
        def fetch_player(self, account_id):
            from deadlock.providers.schemas import ProviderPlayer
            return ProviderPlayer(account_id=account_id, personaname="Steam name")
    provider = DeadlockProvider(limiter=Limiter(), steam=Steam(), client=httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(503))))
    assert provider.fetch_player(123).personaname == "Steam name"


def test_steam_failure_falls_back():
    class Steam:
        def fetch_player(self, account_id):
            raise ProviderUnavailable("steam_unavailable")
    def handle(request):
        if request.url.path.endswith("/rank"):
            return httpx.Response(200, json={"badge": 42})
        return httpx.Response(200, json=[{"account_id": 123, "personaname": "Fallback"}])
    provider = DeadlockProvider(limiter=Limiter(), steam=Steam(), client=httpx.Client(
        transport=httpx.MockTransport(handle)))
    player = provider.fetch_player(123)
    assert player.personaname == "Fallback"
    assert player.rank_badge == 42


@pytest.mark.parametrize("status,payload,exception", [
    (429, {}, ProviderUnavailable), (503, {}, ProviderUnavailable),
    (200, {"response": {"players": {}}}, ProviderBadResponse),
    (200, {}, ProviderBadResponse),
])
def test_steam_errors(status, payload, exception):
    steam = SteamProvider("private-key", client=httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(status, json=payload))))
    with pytest.raises(exception) as error:
        steam.fetch_player(123)
    assert "private-key" not in str(error.value)


def test_missing_key_and_numeric_url():
    provider = DeadlockProvider(limiter=Limiter())
    assert provider.steam is None
    assert provider.resolve_profile_url(f"https://steamcommunity.com/profiles/{BASE + 123}") == 123
    with pytest.raises(ProviderUnavailable, match="steam_not_configured"):
        provider.resolve_profile_url("https://steamcommunity.com/id/example")
    provider.close()


def test_missing_vanity_profile():
    from deadlock.providers.deadlock_api import ProviderNotFound
    steam = SteamProvider("key", client=httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json={"response": {"success": 42}}))))
    with pytest.raises(ProviderNotFound):
        steam.resolve_vanity("missing")


def test_search_profile_url_through_http(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from deadlock.players.router import router
    from deadlock.providers.schemas import ProviderPlayer
    monkeypatch.setattr("deadlock.players.router._limited", lambda *_: None)
    class Redis:
        def get(self, key):
            return None
        def set(self, *args, **kwargs):
            pass
    class Provider:
        def resolve_profile_url(self, query):
            return parse_profile_url(query)
        def fetch_player(self, account_id):
            assert account_id == 123
            return ProviderPlayer(account_id=123, personaname="Direct", profile_source="steam")
    app = FastAPI()
    app.include_router(router)
    app.state.redis = Redis()
    app.state.provider = Provider()
    with TestClient(app) as client:
        response = client.get("/players/search", params={"q": f"https://steamcommunity.com/profiles/{BASE + 123}"})
        assert response.status_code == 200
        assert response.json()["data"][0]["personaname"] == "Direct"
        assert response.json()["meta"]["source"] == "steam"


def test_missing_vanity_search_returns_empty_results(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from deadlock.players.router import router
    from deadlock.providers.deadlock_api import ProviderNotFound

    monkeypatch.setattr("deadlock.players.router._limited", lambda *_: None)

    class Redis:
        def get(self, key):
            return None

        def set(self, *args, **kwargs):
            pass

    class Provider:
        def resolve_profile_url(self, query):
            raise ProviderNotFound()

    app = FastAPI()
    app.include_router(router)
    app.state.redis = Redis()
    app.state.provider = Provider()

    with TestClient(app) as client:
        response = client.get(
            "/players/search",
            params={"q": "https://steamcommunity.com/id/missing"},
        )
        assert response.status_code == 200
        assert response.json()["data"] == []
