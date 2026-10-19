"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest, delay, formatDate, formatDuration, formatNumber, type ApiMeta, type Job, type Match } from "@/lib/api";

type Purchase = { player: string; itemId: string; seconds: number | null; sourceOrder: number };

function purchaseSeconds(item: Record<string, unknown>) {
  const value = item.game_time_s ?? item.game_time_seconds ?? item.game_time;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clock(seconds: number | null) {
  if (seconds == null) return "Время неизвестно";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function MatchDetail({ matchId }: { matchId: string }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    async function load() {
      try {
        let result = await apiRequest<Match | { job_id: string }>(`/api/v1/matches/${encodeURIComponent(matchId)}`, { signal: controller.signal });
        if (result.status === 202 && "job_id" in result.data) {
          let job: Job | null = null;
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await delay(1200, controller.signal);
            const status = await apiRequest<Job>(`/api/v1/refresh-jobs/${encodeURIComponent(result.data.job_id)}`, { signal: controller.signal });
            job = status.data;
            if (job.status === "succeeded" || job.status === "failed") break;
          }
          if (job?.status !== "succeeded") throw new Error(job?.status === "failed" ? "Не удалось загрузить детали матча." : "Детали матча ещё загружаются. Попробуйте позже.");
          result = await apiRequest<Match>(`/api/v1/matches/${encodeURIComponent(matchId)}`, { signal: controller.signal });
        }
        if (!alive) return;
        setMatch(result.data as Match);
        setMeta(result.meta);
      } catch (cause) {
        if (!alive || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Не удалось загрузить матч");
      } finally {
        if (alive) setLoading(false);
      }
    }
    setLoading(true);
    setError("");
    void load();
    return () => { alive = false; controller.abort(); };
  }, [matchId, retry]);

  if (loading) return <div className="page-loading" role="status">Загружаем матч…</div>;
  if (error || !match) return (
    <section className="state-panel" role="alert">
      <span className="eyebrow">ДЕТАЛИ МАТЧА</span>
      <h1>Матч {matchId}</h1>
      <p>{error || "Матч не найден"}</p>
      <button className="button button-secondary" onClick={() => setRetry((value) => value + 1)}>Повторить</button>
    </section>
  );

  const teams = [0, 1].map((team) => match.players.filter((player) => player.team === team));
  const purchases: Purchase[] = match.players.flatMap((player, playerIndex) => (player.items ?? []).map((item, itemIndex) => ({
    player: player.personaname ?? player.account_id,
    itemId: item.item_id ?? "ID неизвестен",
    seconds: purchaseSeconds(item),
    sourceOrder: playerIndex * 1000 + itemIndex,
  }))).sort((left, right) => {
    if (left.seconds == null && right.seconds != null) return 1;
    if (left.seconds != null && right.seconds == null) return -1;
    return (left.seconds ?? left.sourceOrder) - (right.seconds ?? right.sourceOrder);
  });

  return (
    <div className="page-content match-page">
      <button className="back-link back-button" onClick={() => window.history.back()}>← Назад</button>
      <section className="match-title-panel">
        <span className="eyebrow">РАЗБОР МАТЧА</span>
        <h1>Матч {match.match_id}</h1>
        <p>{formatDate(match.started_at)} <span>·</span> {formatDuration(match.duration_s)} <span>·</span> {match.status === "partial" ? "частичные данные" : "данные загружены"}</p>
        {meta && <small className="data-caption">{meta.source} · участников {formatNumber(meta.sample_size, 0)}{meta.stale ? " · данные устарели" : ""}</small>}
      </section>
      <div className="team-grid">
        {teams.map((players, team) => (
          <section className={`team-panel team-${team}`} key={team}>
            <div className="team-heading"><span className="team-indicator" />Команда {team === 0 ? "А" : "Б"}<span className="team-total">{players.length} игроков</span></div>
            <div className="table-scroll">
              <table className="data-table player-table">
                <thead><tr><th>Игрок</th><th>K / D / A</th><th>Души</th><th>Урон</th></tr></thead>
                <tbody>{players.map((player) => (
                  <tr key={player.account_id}>
                    <td><Link href={`/players/${encodeURIComponent(player.account_id)}`} className="match-player-name"><span className="hero-sigil">{player.hero_name.slice(0, 1)}</span><span>{player.hero_name}<small>{player.personaname ?? `ID ${player.account_id}`}</small></span></Link></td>
                    <td>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"}</td>
                    <td>{formatNumber(player.net_worth, 0)}</td>
                    <td>{formatNumber(player.player_damage, 0)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <section className="section-block purchase-section">
        <div className="section-heading"><div><span className="eyebrow">ПО ХОДУ МАТЧА</span><h2>Покупки</h2></div><span className="count-chip">{purchases.length} предметов</span></div>
        {purchases.length === 0 ? <div className="inline-state">Покупки не включены в сохранённые данные матча.</div> : (
          <ol className="purchase-timeline">{purchases.map((purchase, index) => (
            <li key={`${purchase.player}-${purchase.itemId}-${index}`}>
              <time>{clock(purchase.seconds)}</time>
              <span className="timeline-point" aria-hidden="true" />
              <span className="purchase-copy"><strong>Предмет {purchase.itemId}</strong><small>{purchase.player}</small></span>
            </li>
          ))}</ol>
        )}
      </section>
    </div>
  );
}
