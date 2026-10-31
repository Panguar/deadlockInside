"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/components/AccountProvider";
import { Gauge } from "@/components/home/Gauge";
import { useHeroStats } from "@/components/home/useHeroStats";
import { useReveal } from "@/components/home/reveal";
import { apiRequest, type PlayerStats } from "@/lib/api";
import { getHeroPortrait } from "@/lib/hero-portraits";
import "@/app/home/profile.css";

const percentFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const kdaFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function ProfileSection() {
  const { account, ready } = useAccount();
  const { status: heroStatus, heroes, avgWinRate, avgKda } = useHeroStats();
  const referenceReady = heroStatus === "ready" && heroes.length > 0;
  const accountId = account?.account_id ?? null;
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const titleRef = useReveal<HTMLHeadingElement>();

  useEffect(() => {
    if (!accountId) return;
    setStatus("loading");
    setStats(null);
    const controller = new AbortController();
    apiRequest<PlayerStats>(`/api/v1/players/${encodeURIComponent(accountId)}/stats`, {
      signal: controller.signal,
    })
      .then((result) => {
        setStats(result.data);
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [accountId, attempt]);

  return (
    <section id="profile" className="profile" aria-labelledby="profile-title">
      <div className="container">
        <h2 id="profile-title" ref={titleRef} className="profile-title reveal-h2">
          Ваш профиль
        </h2>

        {!ready ? (
          <div className="profile-skeleton" aria-busy="true" aria-label="Загружаем профиль">
            <span className="profile-skeleton-line" />
            <span className="profile-skeleton-line profile-skeleton-line-short" />
          </div>
        ) : !account ? (
          <div className="profile-signed-out">
            <div className="profile-copy">
              <p className="profile-lede">
                Войдите через Steam, чтобы увидеть свой винрейт и KDA рядом со средними по игре.
              </p>
              <div className="profile-actions">
                <a className="btn-brass" href="/api/v1/auth/login">
                  Войти через Steam
                </a>
                <a className="profile-link" href="#top">
                  Найти игрока по нику
                </a>
              </div>
            </div>

            {heroStatus === "loading" ? (
              <div className="profile-skeleton profile-gauges-skeleton" aria-busy="true" aria-hidden="true">
                <span className="profile-skeleton-line" />
                <span className="profile-skeleton-line profile-skeleton-line-short" />
              </div>
            ) : heroStatus === "ready" ? (
              <div className="profile-gauges-block">
                <figure className="profile-gauge">
                  <Gauge
                    value={avgWinRate * 100}
                    min={35}
                    max={65}
                    majorEvery={5}
                    minorEvery={1}
                    format={(v) => `${percentFormat.format(v)}%`}
                    label="Средний винрейт"
                  />
                  <figcaption>Средний винрейт по игре. После входа здесь появится ваша стрелка.</figcaption>
                </figure>
                <figure className="profile-gauge">
                  <Gauge
                    value={avgKda}
                    min={0}
                    max={6}
                    majorEvery={1}
                    minorEvery={0.25}
                    format={(v) => kdaFormat.format(v)}
                    label="Средний KDA"
                  />
                  <figcaption>Средний KDA по игре</figcaption>
                </figure>
              </div>
            ) : null}
          </div>
        ) : status === "loading" || !stats ? (
          status === "error" ? (
            <div className="profile-error">
              <p role="status" className="profile-lede">
                Не удалось загрузить статистику.
              </p>
              <button type="button" className="profile-retry" onClick={() => {
                  setStatus("loading");
                  setAttempt((value) => value + 1);
                }}>
                Повторить
              </button>
            </div>
          ) : (
            <div className="profile-skeleton" aria-busy="true" aria-label="Загружаем статистику">
              <span className="profile-skeleton-line" />
              <span className="profile-skeleton-line profile-skeleton-line-short" />
            </div>
          )
        ) : (
          <div className="profile-card">
            <header className="profile-identity">
              {account.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="profile-avatar" src={account.avatar_url} alt="" width={48} height={48} />
              ) : null}
              <p className="profile-name">{account.personaname}</p>
            </header>

            <div className="profile-gauges">
              {stats.win_rate === null ? (
                <p className="profile-empty">Недостаточно матчей</p>
              ) : (
                <figure className="profile-gauge">
                  <Gauge
                    value={stats.win_rate * 100}
                    min={35}
                    max={65}
                    majorEvery={5}
                    minorEvery={1}
                    format={(v) => `${percentFormat.format(v)}%`}
                    label="Винрейт"
                    reference={referenceReady && avgWinRate != null ? avgWinRate * 100 : undefined}
                  />
                  <figcaption>Ваш винрейт, отметка патины: среднее по игре</figcaption>
                </figure>
              )}

              {stats.kda === null ? (
                <p className="profile-empty">Недостаточно матчей</p>
              ) : (
                <figure className="profile-gauge">
                  <Gauge
                    value={stats.kda}
                    min={0}
                    max={6}
                    majorEvery={1}
                    minorEvery={0.25}
                    format={(v) => kdaFormat.format(v)}
                    label="KDA"
                    reference={referenceReady && avgKda != null ? avgKda : undefined}
                  />
                  <figcaption>Ваш KDA против среднего</figcaption>
                </figure>
              )}
            </div>

            <div className="profile-heroes-block">
              <h3 className="profile-heroes-title">Чаще всего играете</h3>
              {stats.heroes.length === 0 ? (
                <p className="profile-empty">Героев пока нет</p>
              ) : (
                <ul className="profile-heroes">
                  {[...stats.heroes]
                    .sort((a, b) => b.sample_size - a.sample_size)
                    .slice(0, 3)
                    .map((hero) => {
                      const portrait = getHeroPortrait(hero.hero_id);
                      return (
                        <li key={hero.hero_id} className="profile-hero">
                          {portrait ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="profile-hero-portrait" src={portrait} alt="" width={56} height={56} />
                          ) : (
                            <span className="profile-hero-portrait profile-hero-fallback" aria-hidden="true">
                              {hero.hero_id.slice(0, 1)}
                            </span>
                          )}
                          <span className="profile-hero-name">
                            Герой {hero.hero_id}
                            <small>
                              {hero.win_rate === null
                                ? "Недостаточно матчей"
                                : `Винрейт ${percentFormat.format(hero.win_rate * 100)}%`}
                            </small>
                          </span>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>

            <a className="btn-brass" href={`/players/${accountId}`}>
              Открыть полный профиль
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
