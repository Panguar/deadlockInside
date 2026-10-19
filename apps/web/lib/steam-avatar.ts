const STEAM_AVATAR_HOSTS = new Set([
  "avatars.steamstatic.com",
  "steamcdn-a.akamaihd.net",
]);

export function getSteamAvatarUrl(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && STEAM_AVATAR_HOSTS.has(url.hostname) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
