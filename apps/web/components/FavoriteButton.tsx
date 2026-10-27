"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/AccountProvider";
export function FavoriteButton({ accountId }: { accountId: string }) {
  const { account, favorites, addFavorite, removeFavorite } = useAccount(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  if (!account) return <a className="button button-secondary" href="/api/v1/auth/login">Войдите, чтобы добавить в избранное</a>;
  const saved = favorites.some((favorite) => favorite.account_id === accountId);
  async function toggle() { setBusy(true); setError(""); try { if (saved) await removeFavorite(accountId); else await addFavorite(accountId); } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить профиль"); } finally { setBusy(false); } }
  return <div className="favorite-control"><button className="button button-secondary" type="button" disabled={busy} onClick={() => void toggle()}>{busy ? "Сохраняем…" : saved ? "Убрать из избранного" : "В избранное"}</button>{error && <span role="alert">{error}</span>}<Link href="/account/favorites">Избранное</Link></div>;
}
