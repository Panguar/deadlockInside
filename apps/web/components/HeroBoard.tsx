"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, ApiError, datePeriodError, formatMatches, formatNumber, formatPercent, nextUtcDayStart, queryString, sourceDescription, type ApiMeta, type HeroStats } from "@/lib/api";
import { getEnglishHeroName } from "@/lib/hero-names.en";

type BoardState = "loading" | "pending" | "ready" | "error";
type HeroFilters = { from: string; to: string; minBadge: string; maxBadge: string };

function readHeroFilters() {
  if (typeof window === "undefined") return { from: "", to: "", minBadge: "", maxBadge: "" };
  const params = new URLSearchParams(window.location.search);
  return {
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    minBadge: params.get("min_average_badge") ?? "",
    maxBadge: params.get("max_average_badge") ?? "",
  };
}

function readInitialHeroState(seed?: HeroFilters, compact = false) {
  const raw = compact ? { from: "", to: "", minBadge: "", maxBadge: "" } : seed ?? readHeroFilters();
  let error = datePeriodError(raw.from, raw.to, true);
  const validBadge = (value: string) => !value || (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 65535);
  if (!error && (!validBadge(raw.minBadge) || !validBadge(raw.maxBadge))) error = "Ссылка содержит некорректный диапазон среднего ранга матча.";
  if (!error && raw.minBadge && raw.maxBadge && Number(raw.minBadge) > Number(raw.maxBadge)) error = "Минимальный ранг матча должен быть ниже максимального.";
  if (error) return { filters: { from: "", to: "", minBadge: "", maxBadge: "" }, error };
  return { filters: raw, error: "" };
}

export function HeroBoard({ compact = false, initialFilters }: { compact?: boolean; initialFilters?: HeroFilters }) {
  const [initial] = useState(() => readInitialHeroState(initialFilters, compact));
  const [filters, setFilters] = useState(initial.filters);
  const [draftFrom, setDraftFrom] = useState(filters.from);
  const [draftTo, setDraftTo] = useState(filters.to);
  const [draftMin, setDraftMin] = useState(filters.minBadge);
  const [draftMax, setDraftMax] = useState(filters.maxBadge);
  const [filterError, setFilterError] = useState(initial.error);
  const [rows, setRows] = useState<HeroStats[]>([]);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [state, setState] = useState<BoardState>("loading");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const query = queryString({
    from: filters.from ? `${filters.from}T00:00:00Z` : undefined,
    to: filters.to ? nextUtcDayStart(filters.to) : undefined,
    min_average_badge: filters.minBadge || undefined,
    max_average_badge: filters.maxBadge || undefined,
  });

  useEffect(() => {
    if (compact) return;
    const params = new URLSearchParams();
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.minBadge) params.set("min_average_badge", filters.minBadge);
    if (filters.maxBadge) params.set("max_average_badge", filters.maxBadge);
    const value = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${value ? `?${value}` : ""}`);
  }, [compact, filters]);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    let timer = 0;
    let attempts = 0;

    if (filterError) {
      setState("ready");
      setRows([]);
      return () => controller.abort();
    }

    async function load() {
      try {
        const result = await apiRequest<HeroStats[]>(`/api/v1/heroes/stats${query}`, { signal: controller.signal });
        if (!alive) return;
        setRows(result.data);
        setMeta(result.meta);
        setState("ready");
        setMessage("");
      } catch (error) {
        if (!alive || controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 503 && error.code === "analytics_snapshot_unavailable" && attempts < 6) {
          attempts += 1;
          setState("pending");
          setMessage("Снимок аналитики готовится. Проверим ещё раз через пару секунд.");
          timer = window.setTimeout(load, 1800);
          return;
        }
        setState("error");
        setMessage(error instanceof Error ? error.message : "Аналитика временно недоступна");
      }
    }

    setState("loading");
    void load();
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [retry, query, filterError]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dateError = datePeriodError(draftFrom, draftTo, true);
    if (dateError) return setFilterError(dateError);
    const validBadge = (value: string) => !value || (/^\d+$/.test(value) && Number(value) >= 0 && Number(value) <= 65535);
    if (!validBadge(draftMin) || !validBadge(draftMax)) return setFilterError("Средний ранг матча должен быть числом от 0 до 65535.");
    if (draftMin && draftMax && Number(draftMin) > Number(draftMax)) {
      setFilterError("Минимальный ранг матча должен быть ниже максимального.");
      return;
    }
    setFilterError("");
    setFilters({ from: draftFrom, to: draftTo, minBadge: draftMin, maxBadge: draftMax });
    setRetry((value) => value + 1);
  }

  const visibleRows = compact ? rows.slice(0, 5) : rows;
  return (
    <section className="section-block" aria-labelledby={compact ? "home-heroes-title" : "heroes-title"}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{filters.from || filters.to || filters.minBadge || filters.maxBadge ? "ПОЛЬЗОВАТЕЛЬСКИЙ СРЕЗ UTC" : "ПОСЛЕДНИЕ 30 ПОЛНЫХ ДНЕЙ UTC"}</span>
          <h2 id={compact ? "home-heroes-title" : "heroes-title"}>Срез по героям</h2>
        </div>
        {compact && <Link className="text-link" href="/heroes">Вся аналитика <span aria-hidden="true">→</span></Link>}
      </div>
      {!compact && <form className="filter-row hero-filters" onSubmit={applyFilters}>
        <label>С даты (UTC)<input type="date" aria-label="С даты" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
        <label>По дату (UTC)<input type="date" aria-label="По дату" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
        <label>Средний ранг матча от<input type="number" min="0" max="65535" aria-label="Средний ранг матча от" value={draftMin} onChange={(event) => setDraftMin(event.target.value)} /></label>
        <label>Средний ранг матча до<input type="number" min="0" max="65535" aria-label="Средний ранг матча до" value={draftMax} onChange={(event) => setDraftMax(event.target.value)} /></label>
        <button className="button button-secondary filter-submit" type="submit">Применить</button>
      </form>}
      {filterError && <p className="error-copy" role="alert">{filterError}</p>}
      {meta && <p className="data-caption">{sourceDescription(meta)}{meta.stale ? " · данные устарели" : ""}</p>}
      {(state === "loading" || state === "pending") && <div className="inline-state" role="status">{message || "Загружаем аналитику…"}</div>}
      {state === "error" && (
        <div className="inline-state error-state" role="alert">
          <span>{message}</span>
          <button className="text-button" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
        </div>
      )}
      {state === "ready" && rows.length === 0 && <div className="inline-state">За выбранный период данных пока нет.</div>}
      {state === "ready" && rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table hero-table">
            <thead><tr><th>Герой</th><th>Матчи</th><th>Победы</th><th>Винрейт</th><th>KDA</th></tr></thead>
            <tbody>
              {visibleRows.map((hero) => (
                <tr key={hero.hero_id}>
                  <td><Link className="hero-name" href={`/heroes/${encodeURIComponent(hero.hero_id)}${queryString({ from: filters.from || undefined, to: filters.to || undefined, min_average_badge: filters.minBadge || undefined, max_average_badge: filters.maxBadge || undefined })}`}><span className="hero-sigil">{hero.name?.slice(0, 1) ?? "?"}</span><span>{hero.name ?? `Герой ${hero.hero_id}`}<small>{getEnglishHeroName(hero.hero_id) ?? "Герой"}</small></span></Link></td>
                  <td>{formatNumber(hero.matches, 0)}</td>
                  <td>{formatNumber(hero.wins, 0)}</td>
                  <td className="metric-cell">{formatPercent(hero.win_rate)}</td>
                  <td>{hero.kda == null ? "—" : `${formatNumber(hero.kda)}${hero.kda_sample_size < (hero.matches ?? 0) ? ` · ${formatMatches(hero.kda_sample_size)}` : ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="footnote">Число матчей показывает выборку источника, а не долю выбора героя. Противостояния и сборки не включены в доступные данные.</p>
    </section>
  );
}
