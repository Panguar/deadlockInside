"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type DefaultPeriod = "7" | "30" | "90" | "all";
export type Account = { account_id: string; personaname: string; avatar_url: string | null; default_period: DefaultPeriod; csrf_token: string };
type Favorite = { account_id: string; personaname: string | null; avatar_url: string | null };
type AccountContextValue = { account: Account | null; ready: boolean; favorites: Favorite[]; reload: () => Promise<void>; refreshFavorites: () => Promise<void>; logout: () => Promise<void>; setDefaultPeriod: (period: DefaultPeriod) => Promise<void>; addFavorite: (accountId: string) => Promise<void>; removeFavorite: (accountId: string) => Promise<void> };
const AccountContext = createContext<AccountContextValue | null>(null);
const api = "/api/v1";

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Не удалось выполнить запрос");
  return body.data as T;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [ready, setReady] = useState(false);
  const reload = useCallback(async () => {
    try {
      const response = await fetch(`${api}/auth/me`, { cache: "no-store", headers: { accept: "application/json" } });
      setAccount(await readEnvelope<Account | null>(response));
    } catch { setAccount(null); }
    finally { setReady(true); }
  }, []);
  const refreshFavorites = useCallback(async () => {
    if (!account) { setFavorites([]); return; }
    try {
      const response = await fetch(`${api}/account/favorites`, { cache: "no-store" });
      setFavorites(await readEnvelope<Favorite[]>(response));
    } catch { setFavorites([]); }
  }, [account]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void refreshFavorites(); }, [refreshFavorites]);
  const mutate = useCallback(async (path: string, method: string, body?: unknown) => {
    if (!account) throw new Error("Войдите через Steam, чтобы сохранить изменения");
    const response = await fetch(`${api}${path}`, { method, cache: "no-store", headers: { accept: "application/json", "content-type": "application/json", "x-csrf-token": account.csrf_token }, body: body === undefined ? undefined : JSON.stringify(body) });
    await readEnvelope<unknown>(response);
  }, [account]);
  const value = useMemo<AccountContextValue>(() => ({
    account, ready, favorites, reload, refreshFavorites,
    logout: async () => { if (account) await mutate("/auth/logout", "POST"); setAccount(null); setFavorites([]); },
    setDefaultPeriod: async (default_period) => { await mutate("/account/preferences", "PATCH", { default_period }); await reload(); },
    addFavorite: async (account_id) => { await mutate("/account/favorites", "POST", { account_id }); await refreshFavorites(); },
    removeFavorite: async (account_id) => { await mutate(`/account/favorites/${encodeURIComponent(account_id)}`, "DELETE"); await refreshFavorites(); },
  }), [account, ready, favorites, reload, refreshFavorites, mutate]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used within AccountProvider");
  return value;
}
