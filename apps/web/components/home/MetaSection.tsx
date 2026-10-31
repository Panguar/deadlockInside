"use client";

import Link from "next/link";
import { ImageWithFallback } from "@/components/ImageWithFallback";
import { formatMatches, formatNumber, formatPercent } from "@/lib/api";
import { getHeroPortrait } from "@/lib/hero-portraits";
import "@/app/home/meta.css";
import { Gauge } from "./Gauge";
import { useHeroStats } from "./useHeroStats";
import { CountUp } from "./CountUp";
import { useReveal } from "./reveal";

const RATE_UP = 0.52;
const RATE_DOWN = 0.48;
const MIN_SAMPLE_SHARE = 0.005;

function rateTone(winRate: number) {
  if (winRate >= RATE_UP) return "meta-rate meta-rate-up";
  if (winRate <= RATE_DOWN) return "meta-rate meta-rate-down";
  return "meta-rate";
}

export function MetaSection() {
  const { status, heroes, totalMatches, avgWinRate, retry } = useHeroStats();
  const ready = status === "ready";
  const titleRef = useReveal<HTMLHeadingElement>();

  const sumMatches = heroes.reduce((sum, hero) => sum + hero.matches, 0);
  const byWinRate = [...heroes].sort((a, b) => b.win_rate - a.win_rate);
  const dialHeroes = byWinRate.filter((hero) => hero.matches >= MIN_SAMPLE_SHARE * sumMatches).slice(0, 3);
  const tableHeroes = byWinRate.slice(0, 10);

  return (
    <section id="meta" className="meta" aria-labelledby="meta-title">
      <div className="container meta-inner">
        <header className="meta-head">
          <h2 id="meta-title" ref={titleRef} className="meta-title reveal-h2">
            Кто держит патч
          </h2>
          {ready ? <p className="meta-caption">Выборка источника: <CountUp value={totalMatches} format={formatMatches} /></p> : null}
        </header>

        {status === "error" ? (
          <div className="meta-error" role="alert">
            <p>Не удалось загрузить статистику героев.</p>
            <button type="button" className="meta-retry" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : (
          <div className="meta-grid">
            <div className="meta-dials">
              {status === "loading"
                ? [0, 1, 2].map((key) => <div key={key} className="meta-skeleton meta-skeleton-dial" aria-hidden="true" />)
                : dialHeroes.map((hero) => (
                    <figure key={hero.hero_id} className="meta-dial">
                      <Gauge
                        value={hero.win_rate * 100}
                        min={40}
                        max={60}
                        majorEvery={5}
                        minorEvery={1}
                        format={(value) => `${formatNumber(value, 1)}%`}
                        label={`Винрейт ${hero.name}`}
                        reference={avgWinRate * 100}
                        size={220}
                      />
                      <figcaption className="meta-dial-caption">
                        <ImageWithFallback
                          src={getHeroPortrait(hero.hero_id, "card")}
                          alt={hero.name}
                          className="meta-portrait"
                          fallback={<span>{hero.name.slice(0, 1)}</span>}
                        />
                        <span className="meta-dial-text">
                          <span className="meta-dial-name">{hero.name}</span>
                          <span className={`meta-dial-rate ${rateTone(hero.win_rate)}`}><CountUp value={hero.win_rate} format={formatPercent} /></span>
                        </span>
                      </figcaption>
                    </figure>
                  ))}
            </div>

            <div className="meta-ledger">
              {status === "loading" ? (
                <div className="meta-skeleton-table" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, index) => (
                    <div key={index} className="meta-skeleton meta-skeleton-row" />
                  ))}
                </div>
              ) : ready && heroes.length === 0 ? (
                <p className="meta-empty">Нет данных по героям для этого патча.</p>
              ) : (
                <table className="meta-table">
                  <thead>
                    <tr>
                      <th scope="col" className="meta-col-name">
                        Герой
                      </th>
                      <th scope="col" className="meta-num">
                        Винрейт
                      </th>
                      <th scope="col" className="meta-num">
                        Пикрейт
                      </th>
                      <th scope="col" className="meta-num meta-col-extra">
                        KDA
                      </th>
                      <th scope="col" className="meta-num meta-col-extra">
                        Матчи
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableHeroes.map((hero) => (
                      <tr key={hero.hero_id}>
                        <th scope="row" className="meta-col-name">
                          <Link href={`/heroes/${hero.hero_id}`} className="meta-hero-link">
                            {hero.name}
                          </Link>
                        </th>
                        <td className={`meta-num ${rateTone(hero.win_rate)}`}>{formatPercent(hero.win_rate)}</td>
                        <td className="meta-num">
                          {totalMatches > 0 ? formatPercent(hero.matches / totalMatches) : "нет данных"}
                        </td>
                        <td className="meta-num meta-col-extra">{formatNumber(hero.kda, 2)}</td>
                        <td className="meta-num meta-col-extra">{formatNumber(hero.matches, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {status === "loading" ? null : (
                <div className="meta-well">
                  <h3 className="meta-well-title">Кто растёт и кто падает</h3>
                  <p>Сравнение патчей появится, когда источник начнёт отдавать историю по версиям.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
