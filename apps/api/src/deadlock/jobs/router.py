from uuid import UUID

from fastapi import APIRouter, Request

from deadlock.core.errors import error_response
from deadlock.jobs.models import RefreshJob
from deadlock.players.schemas import ApiMeta, Envelope, ErrorEnvelope, JobOut


router = APIRouter(tags=["jobs"])


@router.get("/refresh-jobs/{job_id}", response_model=Envelope[JobOut], responses={
    404: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_job(request: Request, job_id: str):
    try:
        normalized = UUID(job_id)
    except (ValueError, TypeError):
        return error_response(request, 422, "validation_error", "Job identifier is invalid")
    with request.app.state.session_factory() as session:
        job = session.get(RefreshJob, normalized)
    if job is None:
        return error_response(request, 404, "job_not_found", "Refresh job was not found")
    updated_at = job.finished_at or job.started_at or job.created_at
    data = JobOut(job_id=str(job.job_id), status=job.status, attempts=job.attempts,
                  created_at=job.created_at, updated_at=updated_at, error_code=job.error_code)
    return {"data": data, "meta": ApiMeta(source="database", updated_at=updated_at)}
