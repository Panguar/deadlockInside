"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiRequest, datePeriodError, delay, formatDate, formatDuration, formatMatches, formatNumber, formatPercent, isValidDateOnly, nextUtcDayStart, queryString, sourceDescription, type ApiMeta, type Hero, type Job, type MatchHistoryItem, type Player, type PlayerStats } from "@/lib/api";

type Filters = { heroId: string; from: string; to: string };
type RefreshState = "idle" | "queued" | "running" | "failed" | "timeout";

function getInitialFilters() {
  if (typeof window === "undefined") return { filters: { heroId: "", from: "", to: "" }, error: "" };
  const params = new URLSearchParams(window.location.search);
  const raw = { heroId: params.get("hero_id") ?? "", from: params.get("from") ?? "", to: params.get("to") ?? "" };
  const error = datePeriodError(raw.from, raw.to, false);
  return { filters: { ...raw, from: isValidDateOnly(raw.from) ? raw.from : "", to: isValidDateOnly(raw.to) ? raw.to : "" }, error };
}

function dateAtUtcStart(date: string) {
  return date ? `${date}T00:00:00Z` : "";
}

function utcDate(value: string) {
  return value ? value.slice(0, 10) : "";
}

export function PlayerProfile({ accountId }: { accountId: string }) {
  const [initialFilters] = useState(getInitialFilters);
  const [player, setPlayer] = useState<Player | null>(null);
  const [playerMeta, setPlayerMeta] = useState<ApiMeta | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [statsMeta, setStatsMeta] = useState<ApiMeta | null>(null);
  const [matches, setMatches] = useState<MatchHistoryItem[]>([]);
  const [historyMeta, setHistoryMeta] = useState<ApiMeta | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters.filters);
  const [draftFrom, setDraftFrom] = useState(filters.from);
  const [draftTo, setDraftTo] = useState(filters.to);
  const [cursorLoading, setCursorLoading] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>("idle");
  const [refreshMessage, setRefreshMessage] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [filterError, setFilterError] = useState(initialFilters.error);
  const refreshController = useRef<AbortController | null>(null);
  const paginationController = useRef<AbortController | null>(null);
  const historyGeneration = useRef(0);

  const apiFilters = useMemo(() => ({
    hero_id: filters.heroId || undefined,
    from: filters.from ? dateAtUtcStart(filters.from) : undefined,
    to: filters.to ? nextUtcDayStart(filters.to) : undefined,
  }), [filters]);
  const serializedFilters = queryString(apiFilters);

  useEffect(() => {
    const controller = new AbortController();
    historyGeneration.current += 1;
    paginationController.current?.abort();
    paginationController.current = null;
    setCursorLoading(false);
    let alive = true;
    let profileLoaded = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      apiRequest<Player>(`/api/v1/players/${encodeURIComponent(accountId)}`, { signal: controller.signal }),
      apiRequest<Hero[]>("/api/v1/heroes", { signal: controller.signal }).catch(() => null),
    ]).then(async ([profile, catalog]) => {
      if (!alive) return;
      profileLoaded = true;
      setPlayer(profile.data);
      setPlayerMeta(profile.meta);
      if (catalog) setHeroes(catalog.data);
      const [playerStats, history] = await Promise.all([
        apiRequest<PlayerStats>(`/api/v1/players/${encodeURIComponent(accountId)}/stats${serializedFilters}`, { signal: controller.signal }),
        apiRequest<MatchHistoryItem[]>(`/api/v1/players/${encodeURIComponent(accountId)}/matches${serializedFilters}`, { signal: controller.signal }),
      ]);
      if (!alive) return;
      setStats(playerStats.data);
      setStatsMeta(playerStats.meta);
      setMatches(history.data);
      setHistoryMeta(history.meta);
    }).catch((error: unknown) => {
      if (!alive || controller.signal.aborted) return;
      if (!profileLoaded) {
        setLoadError(error instanceof ApiError && error.status === 404
          ? "Профиль ещё не загружен"
          : error instanceof Error ? error.message : "Не удалось загрузить профиль");
        setPlayer(null);
      } else {
        setFilterError(error instanceof Error ? error.message : "Не удалось загрузить выбранную историю");
      }
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [accountId, serializedFilters, retryKey]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.heroId) params.set("hero_id", filters.heroId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [filters]);

  useEffect(() => () => {
    refreshController.current?.abort();
    paginationController.current?.abort();
  }, []);

  async function loadMore() {
    if (!historyMeta?.next_cursor || cursorLoading) return;
    const controller = new AbortController();
    const generation = historyGeneration.current;
    paginationController.current = controller;
    setCursorLoading(true);
    try {
      const page = await apiRequest<MatchHistoryItem[]>(
        `/api/v1/players/${encodeURIComponent(accountId)}/matches${queryString({ ...apiFilters, cursor: historyMeta.next_cursor })}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== historyGeneration.current) return;
      setMatches((current) => [...current, ...page.data]);
      setHistoryMeta(page.meta);
    } catch (error) {
      if (controller.signal.aborted || generation !== historyGeneration.current) return;
      setFilterError(error instanceof Error ? error.message : "Не удалось загрузить следующие матчи");
    } finally {
      if (generation === historyGeneration.current) setCursorLoading(false);
      if (paginationController.current === controller) paginationController.current = null;
    }
  }

  async function refreshProfile() {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setRefreshState("queued");
    setRefreshMessage("Запросили обновление. Проверяем состояние задания…");
    const deadline = Date.now() + 18_000;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(0, deadline - Date.now()));
    try {
      const accepted = await apiRequest<{ job_id: string }>(
        `/api/v1/players/${encodeURIComponent(accountId)}/refresh`,
        { method: "POST", signal: controller.signal },
      );
      let latest: Job | null = null;
      while (Date.now() < deadline) {
        await delay(Math.min(1500, Math.max(0, deadline - Date.now())), controller.signal);
        const result = await apiRequest<Job>(`/api/v1/refresh-jobs/${encodeURIComponent(accepted.data.job_id)}`, { signal: controller.signal });
        latest = result.data;
        setRefreshState(result.data.status === "queued" ? "queued" : "running");
        setRefreshMessage(result.data.status === "queued" ? "Обновление в очереди…" : "Загружаем историю матчей…");
        if (result.data.status === "failed") throw new Error("Не удалось обновить профиль. Попробуйте ещё раз.");
        if (result.data.status === "succeeded") break;
      }
      if (latest?.status !== "succeeded") {
        setRefreshState("timeout");
        setRefreshMessage("Задание продолжается в фоне. Обновление занимает больше времени — проверьте позже.");
        return;
      }
      setRefreshMessage("Обновление готово. Загружаем сохранённые данные…");
      setRetryKey((value) => value + 1);
      setRefreshState("idle");
    } catch (error) {
      if (timedOut) {
        setRefreshState("timeout");
        setRefreshMessage("Задание продолжается в фоне. Обновление занимает больше времени — проверьте позже.");
        return;
      }
      if (controller.signal.aborted) return;
      setRefreshState("failed");
      setRefreshMessage(error instanceof Error ? error.message : "Не удалось обновить профиль");
    } finally {
      window.clearTimeout(timeoutId);
      if (refreshController.current === controller) refreshController.current = null;
    }
  }

  function applyDates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = datePeriodError(draftFrom, draftTo, true);
    if (error) return setFilterError(error);
    setFilterError("");
    setFilters((current) => ({ ...current, from: draftFrom, to: draftTo }));
  }

  function changeHero(heroId: string) {
    setFilterError("");
    setFilters((current) => ({ ...current, heroId }));
  }

  if (loading && !player) return <div className="page-loading" role="status">Загружаем профиль…</div>;
  if (!player) {
    return (
      <section className="state-panel">
        <span className="eyebrow">ПРОФИЛЬ ИГРОКА</span>
        <h1>{loadError || "Профиль не найден"}</h1>
        <p>История этого игрока ещё не сохранена. Запросите загрузку данных из источника.</p>
        {refreshMessage && <p className={refreshState === "failed" ? "error-copy" : "pending-copy"} role={refreshState === "failed" ? "alert" : "status"}>{refreshMessage}</p>}
        <div className="state-actions">
          <button className="button button-primary" onClick={refreshProfile} disabled={refreshState === "queued" || refreshState === "running"}>
            {refreshState === "queued" || refreshState === "running" ? "Обновляем…" : "Обновить профиль"}
          </button>
          {refreshState === "failed" && <button className="button button-secondary" onClick={refreshProfile}>Повторить</button>}
        </div>
      </section>
    );
  }

  return (
    <div className="page-content profile-page">
      <section className="profile-heading">
        <div className="player-identity">
          <div className="player-avatar" aria-hidden="true">{player.personaname?.slice(0, 1).toUpperCase() ?? "?"}</div>
          <div>
            <span className="eyebrow">ПРОФИЛЬ ИГРОКА</span>
            <h1>{player.personaname ?? `Игрок ${player.account_id}`}</h1>
            <p className="identity-id">Account ID {player.account_id}</p>
          </div>
        </div>
        <div className="rank-block">
          <span className="eyebrow">РАНГ</span>
          <strong>{player.rank_badge == null ? "—" : formatNumber(player.rank_badge, 0)}</strong>
          <span>{player.rank_badge == null ? "Ранг не определён" : `Ранг ${player.rank_badge}`}</span>
        </div>
      </section>
      {(playerMeta?.stale || playerMeta?.coverage === "partial") && (
        <div className="notice notice-muted" role="status">
          {playerMeta.stale ? "Показаны сохранённые данные; история может быть устаревшей." : "Показана доступная часть истории."}
        </div>
      )}

      <section className="stats-section">
        <div className="section-heading"><div><span className="eyebrow">ЗАГРУЖЕННАЯ ВЫБОРКА</span><h2>Результаты</h2></div></div>
        {statsMeta && <p className="data-caption">{sourceDescription(statsMeta)}{statsMeta.stale ? " · данные устарели" : ""}</p>}
        <div className="stat-grid">
          <article className="stat-card"><span>Матчи</span><strong>{stats ? formatNumber(stats.sample_size, 0) : "—"}</strong><small>сохранено в истории</small></article>
          <article className="stat-card"><span>Винрейт</span><strong>{formatPercent(stats?.win_rate)}</strong><small>{stats ? `${stats.wins} побед · ${stats.decided_matches} с известным исходом` : "—"}</small></article>
          <article className="stat-card"><span>KDA</span><strong>{formatNumber(stats?.kda)}</strong><small>{formatMatches(stats?.kda_sample_size)} с полными K/D/A</small></article>
        </div>
      </section>

      <section className="section-block history-section" aria-labelledby="history-title">
        <div className="section-heading">
          <div><span className="eyebrow">МАТЧИ И ФИЛЬТРЫ</span><h2 id="history-title">История матчей</h2></div>
          {historyMeta && <span className="count-chip">{formatNumber(historyMeta.sample_size, 0)} всего</span>}
        </div>
        <form className="filter-row" onSubmit={applyDates}>
          <label>Герой
            <select aria-label="Герой" value={filters.heroId} onChange={(event) => changeHero(event.target.value)}>
              <option value="">Все герои</option>
              {heroes.map((hero) => <option key={hero.hero_id} value={hero.hero_id}>{hero.name}</option>)}
            </select>
          </label>
          <label>С даты (UTC)<input aria-label="С даты" type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label>
          <label>По дату (UTC)<input aria-label="По дату" type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label>
          <button className="button button-secondary filter-submit" type="submit">Применить</button>
        </form>
        {filterError && <p className="error-copy" role="alert">{filterError}</p>}
        {historyMeta && <p className="data-caption">{sourceDescription(historyMeta)}{historyMeta.stale ? " · данные устарели" : ""}</p>}
        {loading && <p className="pending-copy" role="status">Обновляем историю под выбранные фильтры…</p>}
        {matches.length === 0 ? (
          <div className="empty-history"><span className="empty-mark" aria-hidden="true">∅</span><strong>Матчей пока нет</strong><p>Попробуйте другой период или загрузите историю игрока.</p></div>
        ) : (
          <div className="match-list">
            {matches.map((row) => {
              const hero = heroes.find((entry) => entry.hero_id === row.hero_id);
              return (
                <Link className="match-row" key={row.match_id} href={`/matches/${encodeURIComponent(row.match_id)}`}>
                  <span className="match-result"><i className={row.player_match_outcome === 1 ? "win-dot" : row.player_match_outcome === 2 ? "loss-dot" : "unknown-dot"} />{row.player_match_outcome == null ? "—" : row.player_match_outcome === 1 ? "Победа" : "Поражение"}</span>
                  <span className="match-hero"><span className="hero-sigil">{hero?.name.slice(0, 1) ?? "?"}</span><span>{hero?.name ?? `Герой ${row.hero_id}`}<small>{formatDate(row.started_at)}</small></span></span>
                  <span className="match-kda"><strong>{row.kills ?? "—"} / {row.deaths ?? "—"} / {row.assists ?? "—"}</strong><small>K / D / A</small></span>
                  <span className="match-duration">{formatDuration(row.duration_s)}</span>
                  <span className="match-link-label">Матч {row.match_id} <b aria-hidden="true">↗</b></span>
                </Link>
              );
            })}
          </div>
        )}
        {historyMeta?.next_cursor && <button className="button button-secondary load-more" onClick={loadMore} disabled={cursorLoading}>{cursorLoading ? "Загружаем…" : "Загрузить ещё матчи"}</button>}
      </section>
    </div>
  );
}
