import json
from pathlib import Path

import httpx
import pytest

from deadlock.providers.deadlock_api import DeadlockProvider, ProviderNotFound, ProviderUnavailable
from deadlock.providers.limiter import RedisRateLimiter, RateLimitUnavailable

FIXTURES = Path(__file__).parents[1] / "fixtures" / "provider"


class PermitAll:
    def acquire(self, bucket: str = "default") -> None:
        return None


def provider_for(handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return DeadlockProvider("https://api.example", limiter=PermitAll(), client=client)


def test_history_normalizes_uint32_account_id_and_optional_fields():
    rows = json.loads((FIXTURES / "history.json").read_text())
    provider = provider_for(lambda request: httpx.Response(200, json=rows))

    history = provider.fetch_match_history(4_000_000_000)

    assert history[0].account_id == 10001
    assert history[0].match_id == 90001
    assert history[0].kills == 1
    assert history[0].player_match_outcome == 2


def test_provider_returns_429_history_fallback_as_stale_data():
    rows = json.loads((FIXTURES / "history.json").read_text())
    provider = provider_for(lambda request: httpx.Response(429, json=rows, headers={"Retry-After": "30"}))

    history = provider.fetch_match_history(10001)

    assert len(history) == 4
    assert provider.last_history_stale is True


def test_provider_exposes_retry_after_for_503_without_dropping_cause():
    provider = provider_for(lambda request: httpx.Response(503, json={"error": "busy"}, headers={"Retry-After": "12"}))

    with pytest.raises(ProviderUnavailable) as caught:
        provider.fetch_match(90001)

    assert caught.value.retry_after == 12


def test_provider_does_not_retry_not_found():
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(404, json={"error": "not found"})

    provider = provider_for(respond)
    with pytest.raises(ProviderNotFound):
        provider.fetch_match(90001)
    assert calls == 1


def test_provider_maps_timeout_to_retryable_unavailability():
    def timeout(request):
        raise httpx.ReadTimeout("read timed out", request=request)

    provider = provider_for(timeout)
    with pytest.raises(ProviderUnavailable, match="provider_timeout"):
        provider.fetch_match(90001)


def test_metadata_tolerates_extra_and_missing_optional_fields():
    payload = {"match_info": {
        "match_id": 90002, "start_time": 1792173227,
        "players": [{"account_id": 10001, "hero_id": 58, "stats": [
            {"time_stamp_s": 500, "player_damage": 100},
            {"time_stamp_s": 1200, "player_damage": 240},
        ], "new_provider_field": "ignored"}],
        "new_match_field": True,
    }, "provider_extra": "ignored"}
    provider = provider_for(lambda request: httpx.Response(200, json=payload))

    match = provider.fetch_match(90002)

    assert match.status == "partial"
    assert match.players[0].player_damage == 240
    assert match.players[0].kills is None


def test_history_response_over_ten_mib_is_rejected_before_json_parse():
    provider = provider_for(lambda request: httpx.Response(200, content=b" " * (10 * 1024 * 1024 + 1)))

    with pytest.raises(ProviderUnavailable, match="response_too_large"):
        provider.fetch_match_history(10001)


def test_redis_limiter_fails_closed_when_redis_is_unavailable():
    class BrokenRedis:
        def eval(self, *_args, **_kwargs):
            raise OSError("redis offline")

    limiter = RedisRateLimiter(BrokenRedis())
    with pytest.raises(RateLimitUnavailable):
        limiter.acquire("history")


def test_provider_makes_no_http_request_when_redis_admission_fails():
    calls = 0

    class BrokenLimiter:
        def acquire(self, _bucket="default"):
            raise RateLimitUnavailable("redis offline")

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[])

    provider = DeadlockProvider("https://api.example", limiter=BrokenLimiter(), client=httpx.Client(transport=httpx.MockTransport(respond)))
    with pytest.raises(RateLimitUnavailable):
        provider.fetch_match(90001)
    assert calls == 0


def test_provider_rejects_zero_identifier_before_request():
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[])

    provider = provider_for(respond)
    with pytest.raises(ValueError, match="positive"):
        provider.fetch_match(0)
    assert calls == 0


@pytest.mark.parametrize("account_id", [True, 4_294_967_296])
def test_provider_rejects_non_uint32_account_ids_before_request(account_id):
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=[])

    provider = provider_for(respond)
    with pytest.raises(ValueError):
        provider.fetch_player(account_id)
    assert calls == 0


def test_search_normalizes_valid_steam64_candidate_to_account_id():
    payload = [{"account_id": "76561197960275729", "personaname": "Example"}]
    provider = provider_for(lambda request: httpx.Response(200, json=payload))

    candidates = provider.search_players("Example")

    assert candidates[0].account_id == 10001


@pytest.mark.parametrize("status,payload", [(200, {"error": "bad shape"}), (200, {"match_info": []}), (429, {})])
def test_history_rejects_non_array_or_invalid_fallback_as_bad_response(status, payload):
    provider = provider_for(lambda request: httpx.Response(status, json=payload))

    from deadlock.providers.deadlock_api import ProviderBadResponse
    with pytest.raises(ProviderBadResponse):
        provider.fetch_match_history(10001)


def test_history_rejects_unrepresentable_timestamp_as_bad_response():
    payload = [{"account_id": 10001, "match_id": 1, "hero_id": 58, "start_time": 1e100}]
    provider = provider_for(lambda request: httpx.Response(200, json=payload))

    from deadlock.providers.deadlock_api import ProviderBadResponse
    with pytest.raises(ProviderBadResponse):
        provider.fetch_match_history(10001)


def test_malformed_match_metadata_is_provider_bad_response():
    provider = provider_for(lambda request: httpx.Response(200, json={"match_info": []}))

    from deadlock.providers.deadlock_api import ProviderBadResponse
    with pytest.raises(ProviderBadResponse):
        provider.fetch_match(90001)


def test_null_required_match_fields_mark_metadata_partial():
    payload = {"match_info": {
        "match_id": 90002, "start_time": 1792173227, "duration_s": None,
        "winning_team": None,
        "players": [{"account_id": 10001, "hero_id": 58}],
    }}
    provider = provider_for(lambda request: httpx.Response(200, json=payload))

    match = provider.fetch_match(90002)

    assert match.status == "partial"


def test_provider_stream_enforces_total_deadline(monkeypatch):
    class SlowBody:
        def iter_bytes(self):
            yield b"chunk"

    monkeypatch.setattr("deadlock.providers.deadlock_api.time.monotonic", lambda: 21)
    with pytest.raises(ProviderUnavailable, match="provider_timeout"):
        DeadlockProvider._read_body(SlowBody(), deadline=20)


def test_redis_provider_lock_renews_until_request_finishes():
    from time import sleep

    class RecordingRedis:
        def __init__(self):
            self.renewals = 0
            self.lease_ttl = 0

        def eval(self, script, *_args):
            if "PEXPIRE" in script:
                self.renewals += 1
                return 1
            self.lease_ttl = _args[5]
            return -1

    redis = RecordingRedis()
    limiter = RedisRateLimiter(redis, heartbeat_interval=0.01)
    token = limiter.acquire()
    with limiter.keepalive(token):
        sleep(0.04)

    assert redis.renewals >= 2
    assert redis.lease_ttl >= 45_000


def test_redis_provider_lock_loss_fails_closed():
    from time import sleep

    class LostLockRedis:
        def eval(self, script, *_args):
            return -1 if "local now" in script else 0

    limiter = RedisRateLimiter(LostLockRedis(), heartbeat_interval=0.001)
    token = limiter.acquire()
    with pytest.raises(RateLimitUnavailable, match="lease lost"):
        with limiter.keepalive(token):
            sleep(0.01)
