"""Synthetic provider for local release smoke checks; never used by production."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from json import dumps
from urllib.parse import urlparse

ACCOUNT_ID = 21001
MATCH_ID = 290001
START_TIME = 1792332860
PLAYER = {"account_id": ACCOUNT_ID, "personaname": "Smoke Fixture Player",
          "avatarfull": "https://example.invalid/avatar.png",
          "profileurl": "https://example.invalid/profile/21001",
          "last_updated": "2026-10-18T00:00:00Z", "matches_played_last_30d": 1}
HISTORY = [{"account_id": ACCOUNT_ID, "match_id": MATCH_ID, "hero_id": 1,
            "start_time": START_TIME, "match_duration_s": 1200, "game_mode": 1,
            "match_mode": 1, "player_team": 0, "player_kills": 5,
            "player_deaths": 2, "player_assists": 7, "net_worth": 22000,
            "player_match_outcome": 1}]
MATCH = {"match_info": {"match_id": MATCH_ID, "start_time": START_TIME,
         "duration_s": 1200, "winning_team": 0, "game_mode": 1,
         "match_mode": 1, "players": [
             {"account_id": ACCOUNT_ID, "hero_id": 1, "team": 0, "kills": 5,
              "deaths": 2, "assists": 7, "net_worth": 22000,
              "player_match_outcome": 1, "items": [], "stats": []},
             {"account_id": 21002, "hero_id": 1, "team": 1, "kills": 2,
              "deaths": 5, "assists": 3, "net_worth": 15000,
              "player_match_outcome": 2, "items": [], "stats": []}]}}
HEROES = [{"id": 1, "class_name": "hero_smoke", "name": "Smoke Hero", "player_selectable": True}]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health/live":
            self._json(200, {"status": "ok"})
        elif path == "/v1/players/steam-search":
            self._json(200, [PLAYER])
        elif path == "/v1/players/steam":
            self._json(200, [PLAYER] if str(ACCOUNT_ID) in self.path else [])
        elif path == f"/v1/players/{ACCOUNT_ID}/rank":
            self._json(200, {"badge": 5})
        elif path == f"/v1/players/{ACCOUNT_ID}/match-history":
            self._json(200, HISTORY)
        elif path == f"/v1/matches/{MATCH_ID}/metadata":
            self._json(200, MATCH)
        elif path == "/v1/assets/heroes":
            self._json(200, HEROES)
        elif path == "/v1/analytics/hero-stats":
            self._json(200, [])
        else:
            self._json(404, {"error": "fixture route not found"})

    def _json(self, status, value):
        body = dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
