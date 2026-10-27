"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "@/components/AccountProvider";

export function SiteHeader() {
  const { account, logout } = useAccount();
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function handleLogout() {
    setLogoutError("");
    setLogoutPending(true);
    try {
      await logout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Не удалось завершить сеанс");
    } finally {
      setLogoutPending(false);
    }
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Deadlock Inside — главная">
        <img src="/deadlock-insight.png" alt="Deadlock Insight" />
      </Link>
      <nav className="main-nav" aria-label="Основная навигация">
        <Link href="/heroes">Герои</Link>
        <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">
          Источник данных <span aria-hidden="true">↗</span>
        </a>
        {account ? (
          <details className="account-menu">
            <summary>
              <img src={account.avatar_url ?? ""} alt="" />
              <span>{account.personaname}</span>
            </summary>
            <div className="account-menu-panel">
              <Link href={`/players/${encodeURIComponent(account.account_id)}`}>Мой профиль</Link>
              <Link href="/account/favorites">Избранное</Link>
              <button type="button" disabled={logoutPending} onClick={() => void handleLogout()}>
                {logoutPending ? "Выходим…" : "Выйти"}
              </button>
            </div>
          </details>
        ) : (
          <a className="button button-secondary sign-in-link" href="/api/v1/auth/login">Войти через Steam</a>
        )}
        {logoutError && <span className="error-copy" role="alert">{logoutError}</span>}
      </nav>
    </header>
  );
}