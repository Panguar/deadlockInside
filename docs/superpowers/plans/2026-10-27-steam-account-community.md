# Steam Account and Community Implementation Plan

**Goal:** Steam login, persistent favorites and period preferences, homepage online/news.
**Architecture:** FastAPI verifies Steam OpenID and owns Redis sessions and PostgreSQL user data. Next.js proxies cookies/redirects and renders account and community controls.
**Tech Stack:** Existing Python 3.14, FastAPI, PostgreSQL, Redis, Next.js 16, httpx.
**Spec:** docs/superpowers/specs/2026-10-27-steam-login-community-design.md (approved in chat).

## Constraints and review focus

Use Luna to propose code diffs and Sol 6.1 to review; do not expose credentials.
Use canonical PUBLIC_BASE_URL and fixed Steam endpoints. Verify signed OpenID
fields, replay/state, return URL, session hashing, CSRF and per-user ownership.
Treat news as untrusted text, retain explicit stale values, isolate upstream errors.
No production source file over 50 lines is read in full by the planner.

## Tasks

- [x] Backend account: models/migration, auth service/router, settings and route registration. Contract: GET /auth/login, /auth/callback, /auth/me; POST /auth/logout; GET/POST /account/favorites, DELETE /account/favorites/{account_id}, PATCH /account/preferences. Anonymous me data=null. Authenticated me contains account_id, personaname, avatar_url, default_period and csrf_token. All JSON uses data/meta envelopes. Mutation header X-CSRF-Token plus canonical Origin. Favorites return account_id/personaname/avatar_url; POST body account_id; preferences body default_period in 7,30,90,all.
- [x] Public community: GET /community/online and /community/news, cached independently in Redis with retrieval timestamps and stale fallback. Online data player_count; news array gid/title/url/date/excerpt; app1422450, official feeds only. Fixed public Steam endpoints, limits and malformed-response tests.
- [x] Web: forward auth cookies/CSRF/Origin, manual redirects and Set-Cookie, add DELETE/PATCH proxy; account header, favorites page/buttons, default period application and homepage community panels. Read Next.js local guides. Browser tests cover new flows.
- [x] Review proposed changes, run unit/integration tests in isolated Docker services, typecheck, build, browser tests. Address findings via Luna. Separate approved account, public-community and web-integration commits; inspect staged diffs, push per AGENTS.md.
- [x] Rebuild local release stack, apply migration, verify public data and login redirect without completing the user's Steam login.

## Validation ledger

157 backend tests passed with Python 3.14 and isolated PostgreSQL/Redis; 19
browser tests passed; three tests invoke the actual compiled proxy route and
confirm redirect, multiple cookies, CSRF/Origin, mutation bodies and safe 502.
Typecheck and production build passed. Sol 6.1 approved backend authentication
and frontend/community reviews after Luna fixes for session rotation, strict
OpenID parsing, no-store and visible mutation failures.

The complete suite runs refresh/Celery tests first to avoid the existing
global Celery client dependence on earlier application initialization:
`pytest tests/integration/test_refresh.py tests/integration tests/unit -q`.
Authentication tests isolate their own rate-limit keys between runs.

Local release stack rebuilt and healthy, migration applied after a database
backup. Live smoke confirmed homepage, no-store anonymous session, Steam302
redirect and HttpOnly login-state cookie through web, five official news items,
and unauthorized favorites rejection. Steam online still returns result42;
the application handles it as unavailable without fabricating a count.
PUBLIC_BASE_URL was added to the ignored local release environment using the
existing published origin http://127.0.0.1:8080. Real Steam sign-in remains a
user action; mocked signed callbacks cover success and rejection paths.

Ruling: backend account, public community and web integration use separate
atomic commits so each server capability can be reviewed independently while
shared browser wiring and its tests arrive together. User AGENTS.md and local
environment secrets remain outside commits.
