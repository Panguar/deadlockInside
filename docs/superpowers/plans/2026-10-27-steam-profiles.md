# Steam Profiles Implementation Plan

**Goal:** Optional direct Steam profiles and profile URL search.
**Architecture:** Dedicated Steam adapter used by the existing Deadlock provider, retaining rank and match methods.
**Tech Stack:** Python, httpx, FastAPI, pytest.
**Spec:** docs/superpowers/specs/2026-10-27-steam-profiles-design.md

- [x] Add failing HTTP adapter, URL parsing and fallback tests.
- [x] Implement Steam adapter and provider integration; preserve rank independently.
- [x] Enable validated URL search and report its source accurately.
- [x] Pass optional key through Compose and document activation.
- [x] Run unit tests and inspect diff for secrets and regressions.

## Validation

Final pre-push verification: all 125 backend tests passed in the project's
Python 3.14 Docker image with isolated PostgreSQL and Redis. Explicit test
DATABASE_URL and REDIS_URL were required for the embedded Celery worker.
Web TypeScript checking and production build passed. Live Steam requests
require a Steam key before activation; no credentials were added.

Luna supplied the missing-vanity search fix and HTTP regression test after
Sol 6.1 review found an uninitialized parsed_id. Sol 6.1 independently reran
all 22 Steam tests and approved the integration. The earlier Windows-only
lock-loss timing failure does not reproduce in the target Docker environment.

Ruling: implement the accepted first-stage scope in the current checkout;
keep the existing match provider and HTTP client dependencies. Use Steam's
documented x-webapi-key header to avoid secret-bearing query URLs.
