import { HeroBoard } from "@/components/HeroBoard";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function HeroesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  return (
    <div className="page-content">
      <div className="page-heading">
        <span className="eyebrow">ГЛОБАЛЬНЫЕ ДАННЫЕ ИСТОЧНИКА</span>
        <h1>Аналитика героев</h1>
        <p>Матчи, победы и KDA за последние 30 полных дней UTC. Уточните период и средний ранг матча.</p>
      </div>
      <HeroBoard initialFilters={{
        from: first(query.from),
        to: first(query.to),
        minBadge: first(query.min_average_badge),
        maxBadge: first(query.max_average_badge),
      }} />
    </div>
  );
}
