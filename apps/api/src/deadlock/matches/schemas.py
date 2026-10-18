from datetime import datetime
from pydantic import BaseModel, ConfigDict, field_validator


class MatchItemOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    item_id: str | None = None

    @field_validator("item_id", mode="before")
    @classmethod
    def stringify_item_id(cls, value):
        return str(value) if value is not None else None


class MatchHistoryItem(BaseModel):
    match_id: str
    started_at: datetime
    duration_s: int | None
    hero_id: str
    kills: int | None
    deaths: int | None
    assists: int | None
    net_worth: int | None
    player_damage: int | None
    player_match_outcome: int | None
    status: str


class MatchPlayerOut(BaseModel):
    account_id: str
    personaname: str | None
    hero_id: str
    hero_name: str
    team: int | None
    kills: int | None
    deaths: int | None
    assists: int | None
    net_worth: int | None
    player_damage: int | None
    player_match_outcome: int | None
    items: list[MatchItemOut] | None


class MatchOut(BaseModel):
    match_id: str
    started_at: datetime
    duration_s: int | None
    game_mode: int | None
    match_mode: int | None
    winning_team: int | None
    status: str
    players: list[MatchPlayerOut]


class RefreshAccepted(BaseModel):
    job_id: str
