from pydantic import BaseModel


class HeroOut(BaseModel):
    hero_id: str
    name: str
    class_name: str | None
    client_version: int | None


class HeroGlobalStatsOut(BaseModel):
    hero_id: str
    name: str | None
    class_name: str | None = None
    matches: int | None
    wins: int | None
    losses: int | None
    win_rate: float | None
    kda: float | None
    kda_sample_size: int


class HeroDetailOut(HeroOut):
    stats: HeroGlobalStatsOut | None = None
