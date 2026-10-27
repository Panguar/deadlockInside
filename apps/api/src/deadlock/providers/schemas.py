from datetime import datetime, timezone
from typing import Annotated, Any

from pydantic import AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field, field_validator


_STEAM64_BASE = 76_561_197_960_265_728


def normalize_account_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError("account_id must be an integer Steam identifier")
    if isinstance(value, str) and value.isdecimal():
        value = int(value)
    if not isinstance(value, int):
        raise ValueError("account_id must be an integer Steam identifier")
    if _STEAM64_BASE < value <= _STEAM64_BASE + 4_294_967_295:
        value -= _STEAM64_BASE
    return value


AccountId = Annotated[int, BeforeValidator(normalize_account_id), Field(gt=0, le=4_294_967_295)]


class ProviderSchema(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class PlayerCandidate(ProviderSchema):
    account_id: AccountId
    personaname: str
    avatar_url: str | None = Field(default=None, validation_alias=AliasChoices("avatarfull", "avatar_url"))


class ProviderPlayer(PlayerCandidate):
    profile_source: str = "deadlock-api"
    rank_badge: int | None = None
    profile_updated_at: datetime | None = None


class ProviderHero(ProviderSchema):
    hero_id: int = Field(gt=0, strict=True, validation_alias=AliasChoices("id", "hero_id"))
    name: str = Field(min_length=1, max_length=200)
    class_name: str | None = Field(default=None, max_length=200)
    client_version: int | None = None


class ProviderHeroStats(ProviderSchema):
    hero_id: int = Field(gt=0, strict=True)
    bucket: int | None = Field(default=None, ge=0, strict=True)
    wins: int | None = Field(default=None, ge=0, strict=True)
    losses: int | None = Field(default=None, ge=0, strict=True)
    matches: int | None = Field(default=None, ge=0, strict=True)
    total_kills: int | None = Field(default=None, ge=0, strict=True)
    total_deaths: int | None = Field(default=None, ge=0, strict=True)
    total_assists: int | None = Field(default=None, ge=0, strict=True)

    @classmethod
    def from_provider(cls, row: dict[str, Any]) -> "ProviderHeroStats":
        if not isinstance(row, dict):
            raise ValueError("hero analytics row must be an object")
        return cls.model_validate(row)


class ProviderHistoryEntry(ProviderSchema):
    account_id: AccountId
    match_id: int = Field(gt=0, strict=True)
    hero_id: int = Field(gt=0, strict=True)
    started_at: datetime = Field(validation_alias=AliasChoices("start_time", "started_at"))
    duration_s: int | None = Field(default=None, ge=0, strict=True, validation_alias=AliasChoices("match_duration_s", "duration_s"))
    game_mode: int | None = None
    match_mode: int | None = None
    team: int | None = Field(default=None, validation_alias=AliasChoices("player_team", "team"))
    kills: int | None = Field(default=None, validation_alias=AliasChoices("player_kills", "kills"))
    deaths: int | None = Field(default=None, validation_alias=AliasChoices("player_deaths", "deaths"))
    assists: int | None = Field(default=None, validation_alias=AliasChoices("player_assists", "assists"))
    net_worth: int | None = None
    player_match_outcome: int | None = None

    @field_validator("started_at", mode="before")
    @classmethod
    def unix_seconds_to_datetime(cls, value: Any):
        if isinstance(value, bool):
            raise ValueError("start_time must be a timestamp")
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(value, tz=timezone.utc)
        return value


class ProviderMatchPlayer(ProviderSchema):
    account_id: AccountId
    hero_id: int = Field(gt=0, strict=True)
    team: int | None = None
    kills: int | None = None
    deaths: int | None = None
    assists: int | None = None
    net_worth: int | None = None
    player_damage: int | None = None
    player_match_outcome: int | None = None
    items: list[dict[str, Any]] | None = None
    stats_at_seconds: int | None = None

    @classmethod
    def from_provider(cls, row: dict[str, Any]) -> "ProviderMatchPlayer":
        if not isinstance(row, dict):
            raise ValueError("match participant must be an object")
        snapshots = row.get("stats") or []
        if not isinstance(snapshots, list) or any(not isinstance(item, dict) for item in snapshots):
            raise ValueError("match participant stats must be an array of objects")
        latest = max(snapshots, key=lambda item: item.get("time_stamp_s", -1), default={})
        return cls(
            account_id=row["account_id"], hero_id=row["hero_id"], team=row.get("team"),
            kills=row.get("kills"), deaths=row.get("deaths"), assists=row.get("assists"),
            net_worth=row.get("net_worth"), player_damage=latest.get("player_damage"),
            player_match_outcome=row.get("player_match_outcome"), items=row.get("items"),
            stats_at_seconds=latest.get("time_stamp_s"),
        )


class ProviderMatch(ProviderSchema):
    match_id: int = Field(gt=0, strict=True)
    started_at: datetime
    duration_s: int | None = None
    game_mode: int | None = None
    match_mode: int | None = None
    winning_team: int | None = None
    players: list[ProviderMatchPlayer] = Field(default_factory=list)
    status: str = "complete"


def provider_match_from_metadata(payload: dict[str, Any]) -> ProviderMatch:
    if not isinstance(payload, dict):
        raise ValueError("match metadata must be an object")
    match = payload.get("match_info", payload)
    if not isinstance(match, dict):
        raise ValueError("match_info must be an object")
    required = ("match_id", "start_time", "duration_s", "winning_team", "players")
    complete = all(key in match and match[key] is not None for key in required) and bool(match.get("players"))
    if not isinstance(match.get("players", []), list):
        raise ValueError("match players must be an array")
    return ProviderMatch(
        match_id=match["match_id"],
        started_at=datetime.fromtimestamp(match["start_time"], tz=timezone.utc),
        duration_s=match.get("duration_s"), game_mode=match.get("game_mode"),
        match_mode=match.get("match_mode"), winning_team=match.get("winning_team"),
        players=[ProviderMatchPlayer.from_provider(row) for row in match.get("players", [])],
        status="complete" if complete else "partial",
    )
