"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/lib/api";
type Meta = { updated_at?: string; stale?: boolean };
type Online = { player_count: number };
type News = { gid: string; title: string; url: string; date: string; excerpt: string };
async function request<T>(path: string): Promise<{ data: T; meta: Meta }> {
  const response = await fetch(`/api/v1${path}`, { cache: "no-store" });
  const body = await response.json() as { data: T; meta: Meta };
  if (!response.ok) throw new Error("unavailable");
  return body;
}
function safeNewsUrl(value: string) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : null; } catch { return null; } }
export function CommunityPanel() {
  const [online, setOnline] = useState<Online | null>(null); const [onlineMeta, setOnlineMeta] = useState<Meta | null>(null); const [onlineError, setOnlineError] = useState(false);
  const [news, setNews] = useState<News[]>([]); const [newsMeta, setNewsMeta] = useState<Meta | null>(null); const [newsError, setNewsError] = useState(false); const [loading, setLoading] = useState(true);
  useEffect(() => { let alive = true;
    void request<Online>("/community/online").then((result) => { if (alive) { setOnline(result.data); setOnlineMeta(result.meta); } }).catch(() => { if (alive) setOnlineError(true); });
    void request<News[]>("/community/news").then((result) => { if (alive) { setNews(result.data); setNewsMeta(result.meta); } }).catch(() => { if (alive) setNewsError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  return <section className="community-panel" aria-label="Сообщество Deadlock"><article className="community-online"><span className="eyebrow"><i className="live-dot" /> СЕЙЧАС В DEADLOCK</span>{online ? <><strong>{new Intl.NumberFormat("ru-RU").format(online.player_count)}</strong><span>игроков в Steam</span><small>{onlineMeta?.stale ? "Последнее известное значение · устарело" : `Обновлено ${formatDate(onlineMeta?.updated_at)}`}</small></> : <p role={onlineError ? "status" : undefined}>{onlineError ? "Счётчик временно недоступен" : loading ? "Загружаем данные…" : "Нет данных"}</p>}</article><article className="community-news"><div className="section-heading"><div><span className="eyebrow">ОБНОВЛЕНИЯ</span><h2>Новости игры</h2></div></div>{newsError && news.length === 0 ? <p role="status">Лента новостей временно недоступна</p> : loading && news.length === 0 ? <p role="status">Загружаем новости…</p> : news.length === 0 ? <p>Пока нет новостей</p> : <ul>{news.map((item) => { const href = safeNewsUrl(item.url); return <li key={item.gid}><div><time>{formatDate(item.date)}</time><h3>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.title}</h3><p>{item.excerpt}</p></div></li>; })}</ul>}{newsMeta?.stale && <small>Показана сохранённая лента · устарела</small>}</article></section>;
}
