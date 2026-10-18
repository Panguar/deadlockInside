from ipaddress import ip_address, ip_network

from deadlock.core.errors import error_response

_INCREMENT = "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count"


def client_ip(request, trusted_networks: list[str]) -> str:
    peer = request.client.host if request.client else "127.0.0.1"
    try:
        address = ip_address(peer)
    except ValueError:
        address = ip_address("127.0.0.1")
    trusted = [ip_network(value, strict=False) for value in trusted_networks]
    if not any(address in network for network in trusted):
        return str(address)
    forwarded = request.headers.get("x-forwarded-for", "")
    chain = []
    for value in forwarded.split(","):
        try:
            chain.append(ip_address(value.strip()))
        except ValueError:
            return str(address)
    for candidate in reversed(chain):
        if not any(candidate in network for network in trusted):
            return str(candidate)
    return str(chain[0] if chain else address)


def enforce_rate_limit(request, *, bucket: str, limit: int, window_seconds: int):
    from redis.exceptions import RedisError

    settings = request.app.state.settings
    address = client_ip(request, settings.trusted_proxy_networks)
    key = f"api:rate:{bucket}:{address}"
    try:
        count = request.app.state.redis.eval(_INCREMENT, 1, key, window_seconds)
    except (RedisError, OSError):
        return error_response(request, 503, "rate_limit_unavailable", "Request limits are temporarily unavailable")
    if count > limit:
        return error_response(request, 429, "rate_limit_exceeded", "Too many requests")
    return None
