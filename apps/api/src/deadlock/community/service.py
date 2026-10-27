import json
import re
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urlsplit
import httpx

APP_ID = 1422450
MAX_RESPONSE_BYTES = 1024 * 1024
ONLINE_TTL, NEWS_TTL, STALE_TTL, LOCK_TTL = 60, 900, 86400, 10
BASE = "https://api.steampowered.com"
NEWS_FEED = "steam_community_announcements"
_TAGS, _SPACE = re.compile(r"\[[^\]]*\]"), re.compile(r"\s+")
_ALLOWED_NEWS_HOSTS = {"steamcommunity.com", "store.steampowered.com", "steamstore-a.akamaihd.net"}

class CommunityUnavailable(Exception):
    pass

class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_data(self, data):
        self.parts.append(data)

def plain_text(value: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(value)
        parser.close()
        text = " ".join(parser.parts)
    except (ValueError, AssertionError):
        text = value
    return _SPACE.sub(" ", unescape(_TAGS.sub(" ", text))).strip()[:400]

def safe_news_url(value) -> str | None:
    if not isinstance(value, str) or len(value) > 2048:
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme not in {"http", "https"} or parts.username is not None or
                parts.password is not None or not parts.hostname or
                parts.hostname.lower() not in _ALLOWED_NEWS_HOSTS or parts.port not in (None, 80, 443)):
            return None
    except ValueError:
        return None
    return value

def _read(redis, key):
    try:
        raw = redis.get(key) if redis is not None else None
        value = json.loads(raw) if raw is not None else None
        return value if isinstance(value, dict) else None
    except Exception:
        return None

def _cache(redis, fresh_key, stale_key, value, ttl):
    if redis is None:
        return
    encoded = json.dumps(value, separators=(",", ":"))
    for key, expiry in ((stale_key, STALE_TTL), (fresh_key, ttl)):
        try:
            redis.set(key, encoded, ex=expiry)
        except Exception:
            pass

def _acquire(redis, key):
    if redis is None:
        return True
    try:
        return bool(redis.set(key, "1", nx=True, ex=LOCK_TTL))
    except Exception:
        return True

def _request_json(path: str, params: dict) -> dict:
    try:
        with httpx.Client(timeout=httpx.Timeout(4.0, connect=2.0), follow_redirects=False) as client:
            with client.stream("GET", f"{BASE}/{path}", params=params) as response:
                if response.status_code != 200:
                    raise CommunityUnavailable("Steam returned a non-success status")
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise CommunityUnavailable("Steam response exceeded the size limit")
                    chunks.append(chunk)
        payload = json.loads(b"".join(chunks))
        if not isinstance(payload, dict):
            raise ValueError("invalid response")
        return payload
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise CommunityUnavailable("Steam response was unavailable or malformed") from exc

def _online(payload) -> dict:
    response = payload.get("response")
    count = response.get("player_count") if isinstance(response, dict) else None
    result = response.get("result") if isinstance(response, dict) else None
    if isinstance(result, bool) or result != 1 or isinstance(count, bool) or not isinstance(count, int) or count < 0:
        raise CommunityUnavailable("Steam player count was malformed")
    return {"data": {"player_count": count}, "updated_at": datetime.now(timezone.utc).isoformat()}

def _news(payload) -> dict:
    appnews = payload.get("appnews")
    items = appnews.get("newsitems") if isinstance(appnews, dict) else None
    if not isinstance(items, list):
        raise CommunityUnavailable("Steam news response was malformed")
    news = []
    for item in items:
        if not isinstance(item, dict) or item.get("feedname") != NEWS_FEED:
            continue
        url = safe_news_url(item.get("url"))
        gid, title, timestamp = item.get("gid"), item.get("title"), item.get("date")
        if (url is None or not isinstance(gid, (str, int)) or isinstance(gid, bool) or
                not isinstance(title, str) or not title.strip() or isinstance(timestamp, bool) or
                not isinstance(timestamp, int) or timestamp < 0):
            continue
        contents = item.get("contents", "")
        try:
            date = datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        except (ValueError, OverflowError, OSError):
            continue
        news.append({"gid": str(gid), "title": title.strip()[:300], "url": url, "date": date,
                     "excerpt": plain_text(contents) if isinstance(contents, str) else ""})
        if len(news) >= 5:
            break
    return {"data": news, "updated_at": datetime.now(timezone.utc).isoformat()}

def _resolve(redis, fresh_key, stale_key, lock_key, ttl, fetch):
    fresh = _read(redis, fresh_key)
    if fresh is not None and isinstance(fresh.get("data"), (dict, list)) and fresh.get("updated_at"):
        return fresh, False
    stale = _read(redis, stale_key)
    if not _acquire(redis, lock_key):
        if stale is not None and isinstance(stale.get("data"), (dict, list)) and stale.get("updated_at"):
            return stale, True
        raise CommunityUnavailable("Community data is being refreshed")
    try:
        current = fetch()
    except CommunityUnavailable:
        if stale is not None and isinstance(stale.get("data"), (dict, list)) and stale.get("updated_at"):
            return stale, True
        raise
    _cache(redis, fresh_key, stale_key, current, ttl)
    return current, False

def get_online(redis):
    cached, stale = _resolve(redis, "community:online:fresh", "community:online:last", "community:online:lock",
        ONLINE_TTL, lambda: _online(_request_json("ISteamUserStats/GetNumberOfCurrentPlayers/v1/", {"appid": APP_ID})))
    return {"data": cached["data"], "meta": {"source": "steam", "updated_at": cached["updated_at"],
            "sample_size": 0, "stale": stale}}

def get_news(redis):
    cached, stale = _resolve(redis, "community:news:fresh", "community:news:last", "community:news:lock",
        NEWS_TTL, lambda: _news(_request_json("ISteamNews/GetNewsForApp/v2/",
            {"appid": APP_ID, "count": 5, "maxlength": 400, "feeds": NEWS_FEED})))
    return {"data": cached["data"], "meta": {"source": "steam", "updated_at": cached["updated_at"],
            "sample_size": len(cached["data"]), "stale": stale}}
