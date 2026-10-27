from datetime import datetime
from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")

class CommunityMeta(BaseModel):
    source: str = "steam"
    updated_at: datetime
    sample_size: int = 0
    stale: bool = False

class Envelope(BaseModel, Generic[T]):
    data: T
    meta: CommunityMeta

class OnlineOut(BaseModel):
    player_count: int

class NewsItemOut(BaseModel):
    gid: str
    title: str
    url: str
    date: datetime
    excerpt: str
