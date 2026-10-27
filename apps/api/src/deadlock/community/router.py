from fastapi import APIRouter, Request
from deadlock.core.errors import error_response
from deadlock.core.rate_limit import enforce_rate_limit
from deadlock.community.schemas import Envelope, NewsItemOut, OnlineOut
from deadlock.community.service import CommunityUnavailable, get_news, get_online

router = APIRouter(prefix="/community", tags=["community"])

def _limited(request: Request, bucket: str):
    return enforce_rate_limit(request, bucket=bucket, limit=30, window_seconds=60)

@router.get("/online", response_model=Envelope[OnlineOut], responses={429: {}, 503: {}})
def online(request: Request):
    limited = _limited(request, "community-online")
    if limited:
        return limited
    try:
        return get_online(request.app.state.redis)
    except CommunityUnavailable:
        return error_response(request, 503, "community_unavailable", "Steam community data is temporarily unavailable")

@router.get("/news", response_model=Envelope[list[NewsItemOut]], responses={429: {}, 503: {}})
def news(request: Request):
    limited = _limited(request, "community-news")
    if limited:
        return limited
    try:
        return get_news(request.app.state.redis)
    except CommunityUnavailable:
        return error_response(request, 503, "community_unavailable", "Steam community data is temporarily unavailable")
