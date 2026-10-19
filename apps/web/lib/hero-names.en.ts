import catalog from "./hero-names.en.json";

export function getEnglishHeroName(heroId: string | number | null | undefined) {
  if (heroId == null) return undefined;
  const key = String(heroId);
  return Object.prototype.hasOwnProperty.call(catalog.heroes, key)
    ? catalog.heroes[key as keyof typeof catalog.heroes]
    : undefined;
}
