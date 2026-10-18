from deadlock.core.cache import Cache


class FakeRedis:
    def __init__(self):
        self.keys = {
            "player:10001:profile", "player:10001:stats:all", "player:10002:stats:hero:58",
            "match:90001:summary", "match:90001:players", "player:10003:profile",
        }
        self.deleted = []

    def scan_iter(self, match):
        prefix = match.removesuffix("*")
        return (key for key in tuple(self.keys) if key.startswith(prefix))

    def delete(self, *keys):
        self.deleted.extend(keys)
        for key in keys:
            self.keys.discard(key)


def test_refresh_invalidation_clears_all_affected_player_and_match_keys():
    redis = FakeRedis()
    cache = Cache(redis)

    cache.invalidate_refresh(10001, [90001], [10001, 10002])

    assert redis.keys == {"player:10003:profile"}
