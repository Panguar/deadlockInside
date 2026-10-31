"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useHeroStats } from "@/components/home/useHeroStats";
import { ImageWithFallback } from "@/components/ImageWithFallback";
import { getHeroPortrait } from "@/lib/hero-portraits";
import { useReveal } from "./reveal";
import "@/app/home/heroes.css";

const SIZE_PATTERN = ["size-tall", "size-s", "size-s", "size-wide", "size-s", "size-tall", "size-s", "size-s"] as const;

function sizeClass(index: number) {
  if (index < 2) return "size-xl";
  return SIZE_PATTERN[(index - 2) % SIZE_PATTERN.length];
}

const percentFormat = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

function formatPercent(value: number | null | undefined) {
  return value == null ? "нет данных" : percentFormat.format(value);
}

function formatInteger(value: number | null | undefined) {
  return value == null ? "нет данных" : integerFormat.format(value);
}

function formatDecimal(value: number | null | undefined) {
  return value == null ? "нет данных" : decimalFormat.format(value);
}

export function HeroGallery() {
  const { status, heroes, totalMatches, retry } = useHeroStats();
  const gridRef = useRef<HTMLDivElement>(null);
  const titleRef = useReveal<HTMLHeadingElement>();
  const sorted = useMemo(() => [...heroes].sort((a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1)), [heroes]);

  useEffect(() => {
    if (status !== "ready") return;
    const root = gridRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".hero-card"));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof IntersectionObserver === "undefined" || reduced) {
      cards.forEach((card) => card.classList.add("is-in"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2 },
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [status, sorted]);

  const caption =
    status === "loading"
      ? "Загружаем героев…"
      : status === "ready"
        ? `${sorted.length} героев, ссылка ведёт на разбор героя`
        : "";

  return (
    <section id="heroes" className="heroes" aria-labelledby="heroes-title">
      <div className="container">
        <header className="heroes-head">
          <h2 id="heroes-title" ref={titleRef} className="heroes-title reveal-h2">Все герои по винрейту</h2>
          {caption && <p className="heroes-caption">{caption}</p>}
        </header>

        {status === "loading" && (
          <div className="hero-grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} className={`hero-skeleton ${sizeClass(index)}`} aria-hidden="true" />
            ))}
          </div>
        )}

        {status === "error" && (
          <div className="heroes-state" role="alert">
            <span>Не удалось загрузить героев.</span>
            <button type="button" className="heroes-retry" onClick={retry}>Повторить</button>
          </div>
        )}

        {status === "ready" && (
          <div className="hero-grid" ref={gridRef}>
            {sorted.map((hero, index) => {
              const name = hero.name ?? `Герой ${hero.hero_id}`;
              const pick = totalMatches > 0 && hero.matches != null ? hero.matches / totalMatches : null;
              return (
                <a
                  key={hero.hero_id}
                  href={`/heroes/${hero.hero_id}`}
                  className={`hero-card ${sizeClass(index)}`}
                  style={{ "--i": index % 8 } as CSSProperties}
                >
                  <ImageWithFallback
                    className="hero-card-portrait"
                    src={getHeroPortrait(hero.hero_id, "card")}
                    alt={name}
                    fallback={name.slice(0, 1)}
                  />
                  <dl className="hero-card-tag">
                    <div>
                      <dt>Винрейт</dt>
                      <dd>{formatPercent(hero.win_rate)}</dd>
                    </div>
                    <div>
                      <dt>KDA</dt>
                      <dd>{formatDecimal(hero.kda)}</dd>
                    </div>
                    <div>
                      <dt>Пикрейт</dt>
                      <dd>{formatPercent(pick)}</dd>
                    </div>
                    <div>
                      <dt>Матчи</dt>
                      <dd>{formatInteger(hero.matches)}</dd>
                    </div>
                  </dl>
                  <span className="hero-card-plate">
                    <span className="hero-card-name">{name}</span>
                    <span className="hero-card-rate">{formatPercent(hero.win_rate)}</span>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
