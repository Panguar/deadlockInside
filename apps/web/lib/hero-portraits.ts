import catalog from "./hero-portraits.json";

const portraits = new Map(catalog.heroes.map((hero) => [hero.id, hero]));

export function getHeroPortrait(heroId: string | number | null | undefined, size: "small" | "card" = "small") {
  if (heroId == null) return undefined;
  const hero = portraits.get(String(heroId));
  return hero?.[size];
}
