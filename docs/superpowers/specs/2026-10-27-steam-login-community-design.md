# Steam login and homepage community data

Approved by the user in chat on 27 October 2026.

## Intent and scope

The user selected Steam sign-in with saved profiles/preferences and homepage
player count/news. Keep public statistics accessible without signing in.
Use the existing Next.js, FastAPI, PostgreSQL, Redis and Steam integration.

## Approaches

Recommended: Steam OpenID 2.0 verified on FastAPI, opaque server-side sessions
in Redis, user data in PostgreSQL. This fits the existing stack and keeps
authentication and authorization together. Alternative: an external identity
service, adding another account, provider dependency and deployment setup.
The user approved the first approach.

## Steam sign-in

Header button redirects to Steam's own login page. Verify the OpenID assertion
with Steam server-to-server; never infer identity from a submitted SteamID.
Validate endpoint, namespace, mode, signed fields, claimed identity, identity,
return URL, timestamp and nonce; reject replay. Bind the return to a short-lived
single-use login state cookie. Use a configured canonical PUBLIC_BASE_URL,
never untrusted forwarded host headers, and allow only fixed local return paths.

Store only a hash of a cryptographically random session token in Redis, with
a fixed expiry. Rotate on login. HttpOnly, SameSite=Lax, host-only cookies;
Secure in HTTPS deployment, explicit loopback HTTP development support.
Mutations require CSRF protection and origin validation. Logout invalidates
the session and clears the cookie. Forward cookies and multiple Set-Cookie
headers through Next.js without caching authenticated responses or following
login redirects internally. Rate-limit login and callback requests.

After login show nickname/avatar, My profile, Favorites and Logout. Add an
owned user record keyed by verified SteamID; no ownership of arbitrary player
profiles. Save favorites per user in PostgreSQL with a unique user/player pair,
limit 100 favorites, allow add/remove on profiles. Save the default statistics
period (7, 30, 90 days or all time) per user, initially 30 days. This period
choice is an assistant proposal, not a stated user requirement.

## Online and news

Use GetNumberOfCurrentPlayers and GetNewsForApp for Deadlock app 1422450.
Show current Steam player count with retrieval time; do not claim it is a
matchmaking count. Cache for 60 seconds, retain a last-known value as explicitly
stale on upstream failure. News: latest five official-feed entries, cache
15 minutes, display title, date, plain-text excerpt and source link. Verify
the actual available feeds before promising patch-note coverage. Never render
upstream HTML/BBCode as trusted markup; allow only HTTP(S) outbound links.
Empty/unavailable news has an explicit empty/error state independent of stats.

Live preflight on 27 October: official Steam news returns valid entries;
the Steam player-count method returns HTTP 404/result42 for Deadlock with
and without a user key, while the same method works for another game.
The UI must display unavailable until a genuine count can be obtained.

## UI and delivery

Follow the current Russian visual style and mobile layout. Add compact online
status and a news section on the homepage, account controls in the header and
a favorites page. No new design system or paid services. Implement login and
saved user state first, homepage data second, with separate atomic commits.
Luna supplies implementation diffs; Sol 6.1 reviews after automated checks.

## Verification and boundaries

Tests cover forged/replayed/expired OpenID responses, unsafe return URLs,
login state binding, session expiration/logout, cookie proxying, CSRF, user
isolation, favorite limits, preference validation, cache TTL/stale behavior,
malformed Steam news and safe links. Run full backend, web typecheck/build and
browser tests. Human completes the real Steam sign-in; no passwords or Steam
Guard codes are handled by the application or agent. Verify public online/news
with real read requests. Local deployment must use one canonical browser URL.

Sources:
- https://partner.steamgames.com/doc/features/auth
- https://partner.steamgames.com/doc/webapi/ISteamNews
- https://partner.steamgames.com/doc/webapi/ISteamUserStats
