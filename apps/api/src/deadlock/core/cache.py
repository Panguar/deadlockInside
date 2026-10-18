import json


class Cache:
    def __init__(self, redis):
        self.redis = redis

    def get_json(self, key: str):
        value = self.redis.get(key)
        return json.loads(value) if value is not None else None

    def set_json(self, key: str, value, ttl_seconds: int) -> None:
        self.redis.set(key, json.dumps(value, separators=(",", ":")), ex=ttl_seconds)

    def invalidate_player(self, account_id: int) -> None:
        self._invalidate_prefix(f"player:{account_id}:")

    def _invalidate_prefix(self, prefix: str) -> None:
        keys = list(self.redis.scan_iter(match=f"{prefix}*"))
        if keys:
            self.redis.delete(*keys)

    def invalidate_refresh(self, account_id: int, match_ids, participant_ids) -> None:
        """Invalidate every scoped cache key affected by committed refresh data."""
        player_ids = set(participant_ids)
        player_ids.add(account_id)
        for player_id in player_ids:
            self._invalidate_prefix(f"player:{player_id}:")
        for match_id in set(match_ids):
            self._invalidate_prefix(f"match:{match_id}:")
