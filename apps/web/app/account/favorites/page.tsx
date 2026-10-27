"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount, type DefaultPeriod } from "@/components/AccountProvider";
import { getSteamAvatarUrl } from "@/lib/steam-avatar";

const periods: { value: DefaultPeriod; label: string }[] = [
  { value: "7", label: "7 дней" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "all", label: "Всё время" },
];

export default function FavoritesPage() {
  const { account, ready, favorites, setDefaultPeriod, removeFavorite } = useAccount();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");

  async function updatePeriod(period: DefaultPeriod) {
    setMutationError("");
    setPendingAction("period");
    try {
      await setDefaultPeriod(period);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Не удалось сохранить период");
    } finally {
      setPendingAction(null);
    }
  }

  async function removePlayer(accountId: string) {
    setMutationError("");
    setPendingAction(accountId);
    try {
      await removeFavorite(accountId);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Не удалось убрать профиль из избранного");
    } finally {
      setPendingAction(null);
    }
  }

  if (!ready) {
    return <div className="page-content"><p role="status">Загружаем аккаунт…</p></div>;
  }

  if (!account) {
    return (
      <div className="page-content">
        <section className="state-panel">
          <span className="eyebrow">АККАУНТ</span>
          <h1>Войдите через Steam</h1>
          <p>После входа здесь будут сохранённые профили и настройки.</p>
          <a className="button button-primary" href="/api/v1/auth/login">Войти через Steam</a>
        </section>
      </div>
    );
  }

  return (
    <div className="page-content favorites-page">
      <header className="page-heading">
        <span className="eyebrow">ВАША БИБЛИОТЕКА</span>
        <h1>Избранные игроки</h1>
        <p>Период статистики по умолчанию применяется к профилям без дат в ссылке.</p>
      </header>
      {mutationError && <p className="error-copy" role="alert">{mutationError}</p>}
      <section className="section-block">
        <label className="period-setting">
          Период по умолчанию
          <select
            value={account.default_period}
            disabled={pendingAction !== null}
            onChange={(event) => void updatePeriod(event.target.value as DefaultPeriod)}
          >
            {periods.map((period) => <option value={period.value} key={period.value}>{period.label}</option>)}
          </select>
        </label>
      </section>
      <section className="favorite-list" aria-label="Сохранённые игроки">
        {favorites.length ? favorites.map((favorite) => (
          <article className="favorite-row" key={favorite.account_id}>
            <Link href={`/players/${encodeURIComponent(favorite.account_id)}`}>
              <img src={getSteamAvatarUrl(favorite.avatar_url)} alt="" />
              <span>
                <strong>{favorite.personaname ?? `Игрок ${favorite.account_id}`}</strong>
                <small>Account ID {favorite.account_id}</small>
              </span>
            </Link>
            <button
              className="button button-secondary"
              disabled={pendingAction !== null}
              onClick={() => void removePlayer(favorite.account_id)}
            >
              {pendingAction === favorite.account_id ? "Убираем…" : "Убрать"}
            </button>
          </article>
        )) : <p>Сохранённых профилей пока нет.</p>}
      </section>
    </div>
  );
}