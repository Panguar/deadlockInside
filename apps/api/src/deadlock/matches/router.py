from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response
from sqlalchemy import select

from deadlock.core.errors import error_response
from deadlock.jobs.service import request_match_refresh
from deadlock.heroes.models import Hero
from deadlock.matches.models import Match, MatchPlayer
from deadlock.matches.schemas import MatchOut, MatchPlayerOut, RefreshAccepted
from deadlock.players.models import Player
from deadlock.players.schemas import ApiMeta, Envelope, ErrorEnvelope


router = APIRouter(prefix="/matches", tags=["matches"])


def _identifier(value: str) -> int:
    if not value.isdecimal():
        raise ValueError
    number = int(value)
    if not 0 < number <= 9_223_372_036_854_775_807:
        raise ValueError
    return number


def _read_match(session, match_id: int):
    match = session.get(Match, match_id)
    if match is None:
        return None
    rows = session.execute(select(MatchPlayer, Player, Hero).join(
        Player, Player.account_id == MatchPlayer.account_id,
    ).join(Hero, Hero.hero_id == MatchPlayer.hero_id).where(
               MatchPlayer.match_id == match_id).order_by(MatchPlayer.team, MatchPlayer.account_id)).all()
    players = [MatchPlayerOut(
        account_id=str(participant.account_id), personaname=player.personaname,
        hero_id=str(participant.hero_id), hero_name=hero.name, team=participant.team,
        kills=participant.kills, deaths=participant.deaths, assists=participant.assists,
        net_worth=participant.net_worth, player_damage=participant.player_damage,
        player_match_outcome=participant.player_match_outcome, items=participant.items,
    ) for participant, player, hero in rows]
    data = MatchOut(match_id=str(match.match_id), started_at=match.started_at,
                    duration_s=match.duration_s, game_mode=match.game_mode, match_mode=match.match_mode,
                    winning_team=match.winning_team, status=match.status, players=players)
    return match, data


@router.get("/{match_id}", response_model=Envelope[MatchOut | RefreshAccepted], responses={
    202: {"description": "Metadata loading queued"}, 404: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_match(request: Request, response: Response, match_id: str):
    try:
        normalized = _identifier(match_id)
    except (ValueError, TypeError, OverflowError):
        return error_response(request, 422, "validation_error", "Match identifier is invalid")
    with request.app.state.session_factory() as session:
        result = _read_match(session, normalized)
    if result is None:
        return error_response(request, 404, "match_not_found", "Match was not found")
    match, data = result
    updated_at = match.metadata_updated_at or match.created_at
    stale = False
    if match.status == "partial":
        with request.app.state.session_factory.begin() as session:
            job = request_match_refresh(session, normalized)
            session.flush()
            reused = getattr(job, "reused", False)
            job_id, job_status = str(job.job_id), job.status
        if match.metadata_updated_at is None and not (reused and job_status in ("succeeded", "failed")):
            response.status_code = 202
            return {"data": {"job_id": job_id}, "meta": ApiMeta(source="database", updated_at=updated_at,
                                                                        sample_size=len(data.players), coverage="partial",
                                                                        stale=False, reused=reused)}
        stale = job_status == "failed"
    return {"data": data, "meta": ApiMeta(source="database", updated_at=updated_at,
                                           sample_size=len(data.players), coverage="partial" if match.status == "partial" else "unknown",
                                           stale=stale)}
