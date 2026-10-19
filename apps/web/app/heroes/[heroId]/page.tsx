import { HeroDetail } from "@/components/HeroDetail";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function HeroPage({ params, searchParams }: { params: Promise<{ heroId: string }>; searchParams: Promise<SearchParams> }) {
  const [{ heroId }, query] = await Promise.all([params, searchParams]);
  return <HeroDetail heroId={heroId} filters={{
    from: first(query.from),
    to: first(query.to),
    minBadge: first(query.min_average_badge),
    maxBadge: first(query.max_average_badge),
  }} />;
}
