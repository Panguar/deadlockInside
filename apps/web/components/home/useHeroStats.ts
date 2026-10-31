"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest, type HeroStats } from "@/lib/api";

export type HeroStatsStatus = "loading" | "error" | "ready";

// Hero row with the fields the UI relies on guaranteed (API marks them nullable).
export type HeroRow = HeroStats & {
  name: string;
  matches: number;
  wins: number;
  kda: number;
  win_rate: number;
};

export function toHeroRows(rows: HeroStats[]): HeroRow[] {
  const result: HeroRow[] = [];
  for (const hero of rows) {
    if (hero.name == null || hero.matches == null || hero.win_rate == null) continue;
    result.push({
      ...hero,
      name: hero.name,
      matches: hero.matches,
      wins: hero.wins ?? 0,
      kda: hero.kda ?? 0,
      win_rate: hero.win_rate,
    });
  }
  return result;
}

export type HeroStatsState = {
  status: HeroStatsStatus;
  heroes: HeroRow[];
  totalMatches: number;
  avgWinRate: number;
  avgKda: number;
  retry: () => void;
};

type SharedRequest = {
  promise: Promise<HeroStats[]>;
  controller: AbortController;
  subscribers: number;
  settled: boolean;
};

// Module-level cache: all components share one in-flight or settled request.
let shared: SharedRequest | null = null;

function startRequest(): SharedRequest {
  const controller = new AbortController();
  const request: SharedRequest = {
    promise: Promise.resolve([]),
    controller,
    subscribers: 0,
    settled: false,
  };
  request.promise = apiRequest<HeroStats[]>("/api/v1/heroes/stats", { signal: controller.signal }).then(
    (response) => {
      request.settled = true;
      return response.data;
    },
    (error: unknown) => {
      if (shared === request) shared = null;
      throw error;
    },
  );
  return request;
}

function subscribe(): SharedRequest {
  if (!shared) shared = startRequest();
  shared.subscribers += 1;
  return shared;
}

function unsubscribe(request: SharedRequest) {
  request.subscribers -= 1;
  // Abort only when nobody waits for an unfinished request, so a shared request survives one unmount.
  if (request.subscribers === 0 && !request.settled) {
    request.controller.abort();
    if (shared === request) shared = null;
  }
}

export function useHeroStats(): HeroStatsState {
  const [state, setState] = useState<{ status: HeroStatsStatus; heroes: HeroStats[] }>({
    status: "loading",
    heroes: [],
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const request = subscribe();
    request.promise.then(
      (heroes) => {
        if (active) setState({ status: "ready", heroes });
      },
      () => {
        if (active) setState({ status: "error", heroes: [] });
      },
    );
    return () => {
      active = false;
      unsubscribe(request);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState((previous) => (previous.status === "loading" ? previous : { status: "loading", heroes: [] }));
    setAttempt((value) => value + 1);
  }, []);

  const heroes = useMemo(() => toHeroRows(state.heroes), [state.heroes]);
  const derived = useMemo(() => {
    let matches = 0;
    let wins = 0;
    let kdaWeighted = 0;
    for (const hero of heroes) {
      matches += hero.matches;
      wins += hero.wins;
      kdaWeighted += hero.kda * hero.matches;
    }
    return {
      totalMatches: matches / 12,
      avgWinRate: matches > 0 ? wins / matches : 0,
      avgKda: matches > 0 ? kdaWeighted / matches : 0,
    };
  }, [heroes]);

  return { status: state.status, heroes, ...derived, retry };
}
