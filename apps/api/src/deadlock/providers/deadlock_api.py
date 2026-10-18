from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from contextlib import nullcontext
import time
from typing import Any, Callable

import httpx
from pydantic import ValidationError

from deadlock.providers.limiter import RateLimitDeferred
from deadlock.providers.schemas import (
    PlayerCandidate,
    ProviderHistoryEntry,
    ProviderPlayer,
    provider_match_from_metadata,
)


class ProviderError(RuntimeError):
    pass


class ProviderUnavailable(ProviderError):
    def __init__(self, message: str, retry_after: float | None = None):
        self.retry_after = retry_after
        super().__init__(message)


class ProviderNotFound(ProviderError):
    pass


class ProviderBadResponse(ProviderError):
    pass


def _retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            return max(0.0, (date - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


class DeadlockProvider:
    def __init__(self, base_url: str = "https://api.deadlock-api.com/v1", *, limiter,
                 client: httpx.Client | None = None, before_request: Callable[[], None] | None = None):
        self.base_url = base_url.rstrip("/")
        self.limiter = limiter
        self.before_request = before_request
        self.client = client or httpx.Client(timeout=httpx.Timeout(20, connect=3), follow_redirects=False)
        self.last_history_stale = False

    @staticmethod
    def _check_id(value: int, *, account: bool = False) -> None:
        if type(value) is not int or value <= 0 or (account and value > 4_294_967_295):
            raise ValueError("provider identifiers must be valid positive integers")

    @staticmethod
    def _json(raw: bytes):
        try:
            return httpx.Response(200, content=raw).json()
        except ValueError as exc:
            raise ProviderBadResponse("provider returned invalid JSON") from exc

    @staticmethod
    def _history_rows(payload) -> list[ProviderHistoryEntry]:
        if not isinstance(payload, list):
            raise ProviderBadResponse("provider history must be an array")
        try:
            return [ProviderHistoryEntry.model_validate(row) for row in payload]
        except (ValidationError, TypeError, ValueError, OverflowError, OSError) as exc:
            raise ProviderBadResponse("provider returned invalid history data") from exc

    def _keep_lock(self, token):
        keepalive = getattr(self.limiter, "keepalive", None)
        return keepalive(token) if token is not None and keepalive else nullcontext()

    @staticmethod
    def _read_body(response, *, max_bytes=None, deadline=None) -> bytes:
        body = bytearray()
        for chunk in response.iter_bytes():
            if deadline is not None and time.monotonic() > deadline:
                raise ProviderUnavailable("provider_timeout")
            body.extend(chunk)
            if max_bytes is not None and len(body) > max_bytes:
                raise ProviderUnavailable("response_too_large")
        if deadline is not None and time.monotonic() > deadline:
            raise ProviderUnavailable("provider_timeout")
        return bytes(body)

    def _get(self, path: str, *, params: dict[str, Any] | None = None, bucket="default", max_bytes=None):
        if self.before_request:
            self.before_request()
        token = self.limiter.acquire(bucket)
        try:
            with self._keep_lock(token):
                try:
                    deadline = time.monotonic() + 20
                    with self.client.stream("GET", f"{self.base_url}{path}", params=params) as response:
                        raw = self._read_body(response, max_bytes=max_bytes, deadline=deadline)
                    if response.status_code == 404:
                        raise ProviderNotFound("provider resource not found")
                    if response.status_code >= 400:
                        raise ProviderUnavailable(
                            "provider temporarily unavailable" if response.status_code == 429 or response.status_code >= 500 else "provider rejected request",
                            retry_after=_retry_after(response.headers.get("Retry-After")),
                        ) if response.status_code == 429 or response.status_code >= 500 else ProviderBadResponse(f"provider_http_{response.status_code}")
                    return self._json(raw)
                except httpx.TimeoutException as exc:
                    raise ProviderUnavailable("provider_timeout") from exc
                except httpx.TransportError as exc:
                    raise ProviderUnavailable("provider_transport_error") from exc
        finally:
            if token is not None:
                self.limiter.release(token)

    def search_players(self, query: str) -> list[PlayerCandidate]:
        payload = self._get("/players/steam-search", params={
            "search_query": query.strip(), "limit": 20, "min_matches_played_last_30d": 0,
        })
        if not isinstance(payload, list):
            raise ProviderBadResponse("provider search response must be an array")
        try:
            return [PlayerCandidate.model_validate(row) for row in payload[:20]]
        except (ValidationError, TypeError, ValueError) as exc:
            raise ProviderBadResponse("provider returned invalid player candidates") from exc

    def fetch_player(self, account_id: int) -> ProviderPlayer:
        self._check_id(account_id, account=True)
        payload = self._get("/players/steam", params={"account_ids": account_id})
        if not isinstance(payload, list):
            raise ProviderBadResponse("provider player response must be an array")
        if not payload:
            raise ProviderNotFound("provider player not found")
        row = payload[0]
        if not isinstance(row, dict):
            raise ProviderBadResponse("provider player record must be an object")
        try:
            rank = self._get(f"/players/{account_id}/rank")
        except ProviderNotFound:
            rank = None
        badge = rank.get("badge") if isinstance(rank, dict) else None
        try:
            player = ProviderPlayer.model_validate({
                **row, "rank_badge": badge if badge else None,
                "profile_updated_at": row.get("last_updated"),
            })
        except (ValidationError, TypeError, ValueError) as exc:
            raise ProviderBadResponse("provider returned invalid player data") from exc
        if player.account_id != account_id:
            raise ProviderBadResponse("provider returned a different player")
        return player

    def fetch_match_history(self, account_id: int) -> list[ProviderHistoryEntry]:
        self._check_id(account_id, account=True)
        self.last_history_stale = False
        if self.before_request:
            self.before_request()
        token = self.limiter.acquire("history")
        try:
            with self._keep_lock(token):
                try:
                    deadline = time.monotonic() + 20
                    with self.client.stream("GET", f"{self.base_url}/players/{account_id}/match-history") as response:
                        raw = self._read_body(response, max_bytes=10 * 1024 * 1024, deadline=deadline)
                    if response.status_code == 429:
                        rows = self._history_rows(self._json(raw))
                        self.last_history_stale = True
                        return rows
                    if response.status_code == 404:
                        raise ProviderNotFound("provider history not found")
                    if response.status_code >= 400:
                        if response.status_code >= 500:
                            raise ProviderUnavailable("provider temporarily unavailable", _retry_after(response.headers.get("Retry-After")))
                        raise ProviderBadResponse(f"provider_http_{response.status_code}")
                    return self._history_rows(self._json(raw))
                except httpx.TimeoutException as exc:
                    raise ProviderUnavailable("provider_timeout") from exc
                except httpx.TransportError as exc:
                    raise ProviderUnavailable("provider_transport_error") from exc
        finally:
            if token is not None:
                self.limiter.release(token)

    def fetch_match(self, match_id: int):
        self._check_id(match_id)
        payload = self._get(f"/matches/{match_id}/metadata", params={"disable_steam": "true"})
        try:
            return provider_match_from_metadata(payload)
        except (ValidationError, KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ProviderBadResponse("provider returned invalid match metadata") from exc
