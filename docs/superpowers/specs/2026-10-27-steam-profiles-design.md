# Steam profiles

First stage accepted in chat: fetch profile names and avatars directly from Steam; resolve Steam community profile URLs. Keep nickname search, ranks and matches with Deadlock API. No login, online counters or news in this stage.

## Approaches

Use Steam as primary profile source with Deadlock fallback (selected), rather than replacing the match provider or making Steam mandatory. An optional server-only STEAM_API_KEY enables integration. No key preserves existing operation.

Add a dedicated HTTP adapter using existing httpx. Only parse trusted HTTPS steamcommunity.com profile URLs; never fetch user-supplied URLs. Validate returned Steam IDs. Steam failures fall back to Deadlock profiles; rank failures must not discard a valid Steam profile. Keep existing search cache as stale fallback. Do not log request URLs containing keys.

Verify using mocked HTTP responses, URL validation, identity mismatch, and fallback tests. Live activation requires the user's Steam key in local environment.
