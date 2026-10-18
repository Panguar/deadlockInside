from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict


T = TypeVar("T")


class ApiMeta(BaseModel):
    source: str
    updated_at: datetime | None = None
    sample_size: int = 0
    coverage: str = "unknown"
    stale: bool = False
    next_cursor: str | None = None
    reused: bool | None = None


class Envelope(BaseModel, Generic[T]):
    data: T
    meta: ApiMeta


class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class PlayerCandidateOut(BaseModel):
    account_id: str
    personaname: str
    avatar_url: str | None = None


class PlayerOut(PlayerCandidateOut):
    personaname: str | None
    rank_badge: int | None = None
    profile_updated_at: datetime | None = None


class RefreshAccepted(BaseModel):
    job_id: str


class JobOut(BaseModel):
    job_id: str
    status: str
    attempts: int
    created_at: datetime
    updated_at: datetime
    error_code: str | None = None
