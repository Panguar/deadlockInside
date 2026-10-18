from contextlib import contextmanager
from threading import Event, Thread
import time
from uuid import uuid4

from redis.exceptions import RedisError


class RateLimitUnavailable(RuntimeError):
    """Redis could not safely admit a provider request."""


class RateLimitDeferred(RuntimeError):
    def __init__(self, retry_after: float):
        self.retry_after = retry_after
        super().__init__("provider request rate limited")


_LEASE_MILLISECONDS = 60_000
_ACQUIRE = """
local now = redis.call('TIME')
local seconds = tonumber(now[1]) + tonumber(now[2]) / 1000000
local global_next = tonumber(redis.call('GET', KEYS[1]) or '0')
local bucket_next = tonumber(redis.call('GET', KEYS[2]) or '0')
local wait = math.max(global_next, bucket_next) - seconds
if wait > 0 then return wait end
if not redis.call('SET', KEYS[3], ARGV[1], 'NX', 'PX', ARGV[2]) then return 0.25 end
redis.call('SET', KEYS[1], seconds + tonumber(ARGV[3]), 'EX', math.ceil(tonumber(ARGV[3]) * 2))
if tonumber(ARGV[4]) > 0 then
  redis.call('SET', KEYS[2], seconds + tonumber(ARGV[4]), 'EX', math.ceil(tonumber(ARGV[4]) * 2))
end
return -1
"""
_RENEW = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end"
_RELEASE = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"


class RedisRateLimiter:
    def __init__(self, redis, *, heartbeat_interval: float = 5):
        self.redis = redis
        self.heartbeat_interval = heartbeat_interval

    def acquire(self, bucket: str = "default") -> str:
        token = str(uuid4())
        bucket_seconds = 360 if bucket == "history" else 0
        while True:
            try:
                admitted = float(self.redis.eval(
                    _ACQUIRE,
                    3,
                    "deadlock:provider:next",
                    f"deadlock:provider:bucket:{bucket}",
                    "deadlock:provider:lock",
                    token,
                    _LEASE_MILLISECONDS,
                    1,
                    bucket_seconds,
                ))
            except (RedisError, OSError, TimeoutError) as exc:
                raise RateLimitUnavailable("provider limiter unavailable") from exc
            if admitted < 0:
                return token
            if admitted > 1:
                raise RateLimitDeferred(admitted)
            time.sleep(max(admitted, 0.01))

    def release(self, token: str) -> None:
        try:
            self.redis.eval(_RELEASE, 1, "deadlock:provider:lock", token)
        except (RedisError, OSError, TimeoutError) as exc:
            raise RateLimitUnavailable("provider limiter unavailable") from exc

    @contextmanager
    def keepalive(self, token: str):
        stopped = Event()
        lost = Event()

        def renew_while_active():
            while not stopped.wait(self.heartbeat_interval):
                try:
                    renewed = self.redis.eval(_RENEW, 1, "deadlock:provider:lock", token, _LEASE_MILLISECONDS)
                except (RedisError, OSError, TimeoutError):
                    continue
                if not renewed:
                    lost.set()
                    return

        thread = Thread(target=renew_while_active, name="provider-limiter-lease", daemon=True)
        thread.start()
        try:
            yield
        finally:
            stopped.set()
            thread.join(timeout=1)
            if lost.is_set():
                raise RateLimitUnavailable("provider limiter lease lost")

    @contextmanager
    def slot(self, bucket: str = "default"):
        token = self.acquire(bucket)
        try:
            yield
        finally:
            self.release(token)
