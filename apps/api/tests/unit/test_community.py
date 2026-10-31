import pytest
from deadlock.community import service
from deadlock.community.service import CommunityUnavailable

class FakeRedis:
    def __init__(self):
        self.data, self.ttls = {}, {}
    def get(self, key):
        return self.data.get(key)
    def set(self, key, value, ex=None, nx=False):
        if nx and key in self.data:
            return None
        self.data[key], self.ttls[key] = value, ex
        return True

def test_zero_online_count_and_cache_ttls(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(service, "_request_json", lambda *_: {"response": {"result": 1, "player_count": 0}})
    result = service.get_online(redis)
    assert result["data"] == {"player_count": 0}
    assert result["meta"]["stale"] is False
    assert redis.ttls["community:online:fresh"] == 60
    assert redis.ttls["community:online:last"] == 86400
    assert service.get_online(redis)["data"]["player_count"] == 0

@pytest.mark.parametrize("payload", [
    {}, {"response": {}}, {"response": {"result": 42, "player_count": 10}},
    {"response": {"result": 1, "player_count": True}},
    {"response": {"result": 1, "player_count": -1}},
    {"response": {"result": 1, "player_count": "9"}},
])
def test_invalid_online_does_not_become_zero(monkeypatch, payload):
    monkeypatch.setattr(service, "_request_json", lambda *_: payload)
    with pytest.raises(CommunityUnavailable):
        service.get_online(FakeRedis())

def test_stale_fallback(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(service, "_request_json", lambda *_: {"response": {"result": 1, "player_count": 12}})
    service.get_online(redis)
    redis.data.pop("community:online:fresh")
    monkeypatch.setattr(service, "_request_json", lambda *_: (_ for _ in ()).throw(CommunityUnavailable()))
    result = service.get_online(redis)
    assert result["data"]["player_count"] == 12
    assert result["meta"]["stale"] is True

def test_lock_without_cache_is_unavailable():
    redis = FakeRedis()
    redis.data["community:online:lock"] = "1"
    with pytest.raises(CommunityUnavailable):
        service.get_online(redis)

def test_redis_errors_do_not_escape(monkeypatch):
    class BrokenRedis:
        def get(self, _):
            raise OSError()
        def set(self, *_args, **_kwargs):
            raise OSError()
    monkeypatch.setattr(service, "_request_json", lambda *_: {"response": {"result": 1, "player_count": 4}})
    assert service.get_online(BrokenRedis())["data"]["player_count"] == 4

def test_news_filters_feed_and_unsafe_urls(monkeypatch):
    timestamp = 1761500000
    monkeypatch.setattr(service, "_request_json", lambda *_: {"appnews": {"newsitems": [
        {"gid": "a", "feedname": service.NEWS_FEED, "title": "Patch",
         "url": "https://steamstore-a.akamaihd.net/news/externalpost/a", "date": timestamp,
         "contents": "<b>Hello</b> [url=https://evil.test]world[/url]"},
        {"gid": "b", "feedname": "other", "title": "Unofficial",
         "url": "https://steamcommunity.com/news", "date": timestamp, "contents": "x"},
        {"gid": "c", "feedname": service.NEWS_FEED, "title": "Bad",
         "url": "https://steamcommunity.com.evil.test/news", "date": timestamp, "contents": "x"},
    ]}})
    result = service.get_news(FakeRedis())
    assert len(result["data"]) == 1
    assert result["data"][0]["excerpt"] == "Hello world"

def test_empty_news_and_text_link_sanitization(monkeypatch):
    monkeypatch.setattr(service, "_request_json", lambda *_: {"appnews": {"newsitems": []}})
    assert service.get_news(FakeRedis())["data"] == []
    assert service.safe_news_url("javascript:alert(1)") is None
    assert service.safe_news_url("https://user@steamcommunity.com/x") is None
    assert service.plain_text("<p>one &amp; two</p>") == "one & two"
    assert service.plain_text("[b]three[/b]") == "three"

def test_response_size_limit(monkeypatch):
    import httpx
    class Response:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def iter_bytes(self): yield b"x" * (service.MAX_RESPONSE_BYTES + 1)
    class Client:
        def __init__(self, **_): pass
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def stream(self, *_a, **_kw): return Response()
    monkeypatch.setattr(httpx, "Client", Client)
    with pytest.raises(CommunityUnavailable):
        service._request_json("news", {})

def test_news_excerpt_drops_steam_image_markup():
    assert service.plain_text("Intro [img]{STEAM_CLAN_IMAGE}/45164767/abc.png[/img] text") == "Intro text"
    assert service.plain_text('[img src="{STEAM_CLAN_LOC_IMAGE}/1/x.jpg"][/img]Patch notes') == "Patch notes"
    assert service.plain_text("See {STEAM_CLAN_LOC_IMAGE}/45164767/6073.png now") == "See now"
    assert service.plain_text("[url=https://store.steampowered.com/app/1422450]Read more[/url]") == "Read more"
    assert service.plain_text("[IMG]{STEAM_CLAN_IMAGE}/a.png[/IMG]") == ""

def test_plain_text_is_fast_on_pathological_input():
    import time
    value = "[img]" * 500 + "[" * 8000 + "[img " * 1000 + "{STEAM_CLAN_IMAGE}x" * 500
    start = time.perf_counter()
    result = service.plain_text(value)
    elapsed = time.perf_counter() - start
    assert isinstance(result, str)
    assert elapsed < 2.0
    start = time.perf_counter()
    result = service.plain_text("[" * 20000)
    elapsed = time.perf_counter() - start
    assert isinstance(result, str)
    assert elapsed < 2.0
