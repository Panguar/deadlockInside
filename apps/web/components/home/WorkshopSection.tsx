"use client";

import { useEffect, useState } from "react";
import { apiRequest, formatDate } from "@/lib/api";
import { CountUp } from "./CountUp";
import { useReveal } from "./reveal";
import "@/app/home/workshop.css";

type Online = { player_count: number };
type News = { gid: string; title: string; url: string; date: string; excerpt: string };

function safeNewsUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function WorkshopSection() {
  const [online, setOnline] = useState<number | null>(null);
  const [onlineStale, setOnlineStale] = useState(false);
  const [onlineState, setOnlineState] = useState<"loading" | "ready" | "error">("loading");
  const [news, setNews] = useState<News[]>([]);
  const [newsStale, setNewsStale] = useState(false);
  const [newsState, setNewsState] = useState<"loading" | "ready" | "error">("loading");
  const [newsAttempt, setNewsAttempt] = useState(0);
  const titleRef = useReveal<HTMLHeadingElement>();

  useEffect(() => {
    let alive = true;
    apiRequest<Online>("/api/v1/community/online")
      .then((result) => {
        if (alive) {
          setOnline(result.data.player_count);
          setOnlineStale(result.meta.stale === true);
          setOnlineState("ready");
        }
      })
      .catch(() => {
        if (alive) setOnlineState("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setNewsStale(false);
    apiRequest<News[]>("/api/v1/community/news")
      .then((result) => {
        if (alive) {
          setNews(result.data.slice(0, 4));
          setNewsStale(result.meta.stale === true);
          setNewsState("ready");
        }
      })
      .catch(() => {
        if (alive) setNewsState("error");
      });
    return () => {
      alive = false;
    };
  }, [newsAttempt]);

  return (
    <section id="workshop" className="workshop" aria-labelledby="workshop-title">
      <div className="container">
        <h2 id="workshop-title" ref={titleRef} className="workshop-title reveal-h2">
          Билды, живые матчи, лидерборд
        </h2>
        <div className="workshop-grid">
          <div className="workshop-vitrine workshop-vitrine-builds">
            <h3>Сборки и порядок покупки</h3>
            <p role="status" className="workshop-status">
              Источник билдов ещё не подключён. Здесь будут самые результативные сборки с порядком покупки по минутам.
            </p>
          </div>

          <div className="workshop-vitrine workshop-vitrine-live">
            <h3>Живые матчи и лидерборд</h3>
            <p className="workshop-status">
              Ждём источник живых матчей. Пока здесь только официальный онлайн Steam.
            </p>
            {onlineState === "ready" && online !== null ? (
              <p className="workshop-online">
                <span className="workshop-online-value">
                  <CountUp value={online} format={(n) => new Intl.NumberFormat("ru-RU").format(Math.round(n))} />
                </span>
                <span className="workshop-online-caption">игроков онлайн по данным Steam</span>
                {onlineStale && (
                  <span className="workshop-stale-note">Последнее известное значение · устарело</span>
                )}
              </p>
            ) : onlineState === "error" ? (
              <p role="status" className="workshop-status">
                Steam сейчас не отдаёт онлайн Deadlock.
              </p>
            ) : (
              <p role="status" className="workshop-status">
                Загружаем онлайн…
              </p>
            )}
          </div>

          <div className="workshop-news">
            <h3>Новости Steam</h3>
            {newsState === "loading" ? (
              <p role="status" className="workshop-status">
                Загружаем новости…
              </p>
            ) : newsState === "error" ? (
              <div className="workshop-news-error">
                <p role="status" className="workshop-status">
                  Не удалось загрузить новости.
                </p>
                <button
                  type="button"
                  className="workshop-retry"
                  onClick={() => {
                    setNewsState("loading");
                    setNewsStale(false);
                    setNewsAttempt((value) => value + 1);
                  }}
                >
                  Повторить
                </button>
              </div>
            ) : news.length === 0 ? (
              <p className="workshop-status">Пока нет новостей.</p>
            ) : (
              <ul className="workshop-news-list">
                {news.map((item) => {
                  const href = safeNewsUrl(item.url);
                  return (
                    <li key={item.gid} className="workshop-news-item">
                      <div className="workshop-news-link">
                        <time className="workshop-news-date" dateTime={item.date}>
                          {formatDate(item.date)}
                        </time>
                        <h4 className="workshop-news-title">
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {item.title}
                            </a>
                          ) : (
                            item.title
                          )}
                        </h4>
                        <p className="workshop-news-excerpt">{item.excerpt}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {newsState === "ready" && newsStale && (
              <small className="workshop-stale-note">Показана сохранённая лента · устарела</small>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
