"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiRequest, type PlayerCandidate } from "@/lib/api";
import { ImageWithFallback } from "@/components/ImageWithFallback";
import { getSteamAvatarUrl } from "@/lib/steam-avatar";

type SearchState = "idle" | "loading" | "ready" | "empty" | "error";

export function PlayerSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<PlayerCandidate[]>([]);
  const [state, setState] = useState<SearchState>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const sequence = useRef(0);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setCandidates([]);
      setState("idle");
      setActiveIndex(-1);
      return;
    }
    const controller = new AbortController();
    const current = ++sequence.current;
    const timeout = window.setTimeout(async () => {
      setState("loading");
      try {
        const result = await apiRequest<PlayerCandidate[]>(
          `/api/v1/players/search${new URLSearchParams({ q: value }).toString().replace(/^/, "?")}`,
          { signal: controller.signal },
        );
        if (current !== sequence.current) return;
        setCandidates(result.data);
        setState(result.data.length ? "ready" : "empty");
        setActiveIndex(-1);
      } catch (error) {
        if (controller.signal.aborted || current !== sequence.current) return;
        setCandidates([]);
        setState("error");
      }
    }, 280);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  function choose(candidate: PlayerCandidate) {
    router.push(`/players/${encodeURIComponent(candidate.account_id)}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && candidates.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % candidates.length);
    } else if (event.key === "ArrowUp" && candidates.length) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? candidates.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(candidates[activeIndex]);
    } else if (event.key === "Escape") {
      setCandidates([]);
    }
  }

  return (
    <div className="search-wrap">
      <label className="sr-only" htmlFor="player-search">Поиск игрока</label>
      <div className="search-field">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="search-icon">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 5 5" />
        </svg>
        <input
          id="player-search"
          autoComplete="off"
          role="combobox"
          aria-label="Поиск игрока"
          aria-expanded={candidates.length > 0}
          aria-controls="player-results"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `player-option-${activeIndex}` : undefined}
          placeholder="Ник, Steam ID или ссылка на профиль"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span className="search-key" aria-hidden="true">↵</span>
      </div>
      {state === "loading" && <p className="search-message" role="status">Ищем игрока…</p>}
      {state === "empty" && <p className="search-message" role="status">Игрок не найден</p>}
      {state === "error" && <p className="search-message error-copy" role="alert">Поиск временно недоступен</p>}
      {candidates.length > 0 && (
        <ul className="search-results" id="player-results" role="listbox" aria-label="Найденные игроки">
          {candidates.map((candidate, index) => (
            <li key={`${candidate.account_id}-${index}`}>
              <button
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                id={`player-option-${index}`}
                className={activeIndex === index ? "candidate active" : "candidate"}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(candidate)}
              >
                <ImageWithFallback className="candidate-avatar" src={getSteamAvatarUrl(candidate.avatar_url)} alt={`${candidate.personaname}: аватар`} fallback={candidate.personaname.slice(0, 1).toUpperCase()} />
                <span className="candidate-copy">
                  <strong>{candidate.personaname}</strong>
                  <small>ID {candidate.account_id}</small>
                </span>
                <span className="candidate-arrow" aria-hidden="true">↗</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="search-hint">Введите ник, account ID, Steam ID64 или ссылку steamcommunity.com. Выберите нужный профиль из списка.</p>
    </div>
  );
}
