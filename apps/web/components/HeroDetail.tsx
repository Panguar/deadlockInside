"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiRequest, datePeriodError, delay, formatMatches, formatNumber, formatPercent, nextUtcDayStart, queryString, sourceDescription, type ApiMeta, type HeroDetail as HeroDetailData, type HeroStats } from "@/lib/api";
import { getEnglishHeroName } from "@/lib/hero-names.en";
import { getHeroPortrait } from "@/lib/hero-portraits";
import { ImageWithFallback } from "@/components/ImageWithFallback";

type HeroFilters = { from: string; to: string; minBadge: string; maxBadge: string };
type AnalyticsState = "loading" | "pending" | "ready" | "error";

function filterValidationError(filters: HeroFilters) {
  const dateError = datePeriodError(filters.from, filters.to, true);
  if (dateError) return dateError;
  const validBadge = (value: string) => !value || (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 65535);
  if (!validBadge(filters.minBadge) || !validBadge(filters.maxBadge)) return "Ссылка содержит некорректный диапазон среднего ранга матча.";
  if (filters.minBadge && filters.maxBadge && Number(filters.minBadge) > Number(filters.maxBadge)) return "Минимальный ранг матча должен быть ниже максимального.";
  return "";
}

export function HeroDetail({ heroId, filters }: { heroId: string; filters: HeroFilters }) {
  const [hero, setHero] = useState<HeroDetailData | null>(null);
  const [stats, setStats] = useState<HeroStats | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [error, setError] = useState("");
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>("loading");
  const [analyticsMessage, setAnalyticsMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const backQuery = queryString({
    from: filters.from || undefined,
    to: filters.to || undefined,
    min_average_badge: filters.minBadge || undefined,
    max_average_badge: filters.maxBadge || undefined,
  });
  const statsQuery = queryString({
    from: filters.from ? `${filters.from}T00:00:00Z` : undefined,
    to: filters.to ? nextUtcDayStart(filters.to) : undefined,
    min_average_badge: filters.minBadge || undefined,
    max_average_badge: filters.maxBadge || undefined,
  });

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setLoading(true);
    setError("");
    setAnalyticsState("loading");
    setAnalyticsMessage("");
    apiRequest<HeroDetailData>(`/api/v1/heroes/${encodeURIComponent(heroId)}`, { signal: controller.signal })
      .then((result) => { if (alive) setHero(result.data); })
      .catch((cause: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status === 404 ? "Герой не найден в актуальном справочнике." : cause instanceof Error ? cause.message : "Не удалось загрузить данные героя.");
      })
      .finally(() => { if (alive) setLoading(false); });

    async function loadStats() {
      const validationError = filterValidationError(filters);
      if (validationError) {
        setAnalyticsState("error");
        setAnalyticsMessage(validationError);
        return;
      }
      for (let attempt = 0; attempt <= 6; attempt += 1) {
        try {
          const result = await apiRequest<HeroStats[]>(`/api/v1/heroes/stats${statsQuery}`, { signal: controller.signal });
          if (!alive) return;
          setStats(result.data.find((row) => row.hero_id === heroId) ?? null);
          setMeta(result.meta);
          setAnalyticsState("ready");
          setAnalyticsMessage("");
          return;
        } catch (cause) {
          if (!alive || controller.signal.aborted) return;
          if (cause instanceof ApiError && cause.status === 503 && cause.code === "analytics_snapshot_unavailable" && attempt < 6) {
            setAnalyticsState("pending");
            setAnalyticsMessage("Снимок аналитики готовится. Проверим ещё раз через пару секунд.");
            try { await delay(1800, controller.signal); } catch { return; }
            continue;
          }
          setAnalyticsState("error");
          setAnalyticsMessage(cause instanceof Error ? cause.message : "Не удалось загрузить аналитику героя.");
          return;
        }
      }
      if (alive) {
        setAnalyticsState("error");
        setAnalyticsMessage("Снимок аналитики пока недоступен. Попробуйте позже.");
      }
    }

    void loadStats();
    return () => { alive = false; controller.abort(); };
  }, [heroId, filters, retry, statsQuery]);

  if (loading) return <div className="page-loading" role="status">Загружаем героя…</div>;
  if (error || !hero) return (
    <section className="state-panel" role="alert">
      <span className="eyebrow">СПРАВОЧНИК ГЕРОЕВ</span><h1>{error || "Герой недоступен"}</h1>
      <Link className="button button-secondary" href={`/heroes${backQuery}`}>К аналитике героев</Link>
      <button className="text-button retry-detail" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
    </section>
  );

  return (
    <div className="page-content hero-detail-page">
      <Link className="back-link" href={`/heroes${backQuery}`}>← Все герои</Link>
      <section className="hero-detail-heading">
        <ImageWithFallback className="hero-monogram hero-detail-portrait" src={getHeroPortrait(hero.hero_id, "card")} alt={hero.name} fallback={hero.name.slice(0, 1)} />
        <div><span className="eyebrow">{getEnglishHeroName(hero.hero_id) ?? "ГЕРОЙ DEADLOCK"}</span><h1>{hero.name}</h1><p>Hero ID {hero.hero_id}</p></div>
      </section>
      {meta && <p className="data-caption">{sourceDescription(meta)}{meta.stale ? " · данные устарели" : ""}</p>}
      {analyticsState === "loading" && <div className="inline-state" role="status">Загружаем аналитику за выбранный период…</div>}
      {analyticsState === "pending" && <div className="inline-state" role="status">{analyticsMessage}</div>}
      {analyticsState === "error" && <div className="inline-state error-state" role="alert"><span>{analyticsMessage}</span><button className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button></div>}
      {analyticsState === "ready" && !stats && <div className="inline-state">За выбранный период данных по герою нет.</div>}
      {analyticsState === "ready" && stats && (
        <div className="stat-grid hero-stat-grid">
          <article className="stat-card"><span>Матчи</span><strong>{formatNumber(stats.matches, 0)}</strong><small>размер выборки источника</small></article>
          <article className="stat-card"><span>Винрейт</span><strong>{formatPercent(stats.win_rate)}</strong><small>{formatNumber(stats.wins, 0)} побед · {formatNumber(stats.losses, 0)} поражений</small></article>
          <article className="stat-card"><span>KDA</span><strong>{formatNumber(stats.kda)}</strong><small>{formatMatches(stats.kda_sample_size)} с полными K/D/A</small></article>
        </div>
      )}
      <div className="notice notice-muted">Показатели относятся к выбранной глобальной выборке. Контр-подборы и сборки отсутствуют в подтверждённом контракте.</div>
    </div>
  );
}
