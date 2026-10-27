"""Server-only Steam Web API adapter. Never requests user-provided URLs."""
from datetime import datetime, timezone
import re
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from deadlock.providers.deadlock_api import ProviderBadResponse, ProviderNotFound, ProviderUnavailable
from deadlock.providers.schemas import ProviderPlayer, _STEAM64_BASE, normalize_account_id


def parse_profile_url(value: str) -> int | str:
    url = urlsplit(value)
    if (url.scheme != "https" or url.netloc.lower() not in {"steamcommunity.com", "www.steamcommunity.com"}
            or url.query or url.fragment or "\\" in value):
        raise ValueError("invalid Steam profile URL")
    match = re.fullmatch(r"/(profiles|id)/([A-Za-z0-9_-]{1,64})/?", url.path)
    if not match:
        raise ValueError("invalid Steam profile URL")
    kind, identifier = match.groups()
    if kind == "id":
        return identifier
    if not identifier.isascii() or not identifier.isdecimal():
        raise ValueError("invalid Steam ID64")
    steam_id = int(identifier)
    if not _STEAM64_BASE < steam_id <= _STEAM64_BASE + 4_294_967_295:
        raise ValueError("invalid Steam ID64")
    return normalize_account_id(steam_id)


class SteamProvider:
    def __init__(self, api_key: str, *, client: httpx.Client | None = None):
        self._api_key = api_key
        self.client = client or httpx.Client(timeout=httpx.Timeout(8, connect=3), follow_redirects=False)

    def _get(self, method: str, version: int, **params):
        try:
            with self.client.stream("GET", f"https://api.steampowered.com/ISteamUser/{method}/v{version}/",
                                    params=params, headers={"x-webapi-key": self._api_key}) as response:
                if response.status_code != 200:
                    raise ProviderUnavailable("steam_unavailable")
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 1024 * 1024:
                        raise ProviderBadResponse("steam_response_too_large")
            payload = httpx.Response(200, content=bytes(body)).json()
            if not isinstance(payload, dict) or not isinstance(payload.get("response"), dict):
                raise ValueError
            return payload["response"]
        except httpx.HTTPError:
            # Keep transport details out of public errors.
            raise ProviderUnavailable("steam_unavailable") from None
        except (ValueError, TypeError):
            raise ProviderBadResponse("steam_invalid_response") from None

    def fetch_player(self, account_id: int) -> ProviderPlayer:
        if type(account_id) is not int or not 0 < account_id <= 4_294_967_295:
            raise ValueError("invalid account identifier")
        payload = self._get("GetPlayerSummaries", 2, steamids=str(_STEAM64_BASE + account_id))
        rows = payload.get("players")
        if not isinstance(rows, list):
            raise ProviderBadResponse("steam_invalid_players")
        if not rows:
            raise ProviderNotFound("steam_player_not_found")
        try:
            if len(rows) != 1 or not isinstance(rows[0], dict):
                raise ValueError
            row = rows[0]
            if str(row.get("steamid")) != str(_STEAM64_BASE + account_id):
                raise ValueError
            return ProviderPlayer(account_id=account_id, personaname=row["personaname"],
                                  avatarfull=row.get("avatarfull"), profile_source="steam",
                                  profile_updated_at=datetime.now(timezone.utc))
        except (ValueError, TypeError, KeyError, ValidationError):
            raise ProviderBadResponse("steam_invalid_player") from None

    def resolve_vanity(self, name: str) -> int:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name):
            raise ValueError("invalid vanity name")
        payload = self._get("ResolveVanityURL", 1, vanityurl=name, url_type=1)
        if payload.get("success") == 42:
            raise ProviderNotFound("steam_profile_not_found")
        try:
            if payload.get("success") != 1:
                raise ValueError
            value = payload["steamid"]
            return parse_profile_url(f"https://steamcommunity.com/profiles/{value}")
        except (ValueError, TypeError, KeyError):
            raise ProviderBadResponse("steam_invalid_identity") from None
