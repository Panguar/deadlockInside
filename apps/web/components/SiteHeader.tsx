import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Deadlock Inside — главная">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <span>DEADLOCK <b>INSIDE</b></span>
      </Link>
      <nav className="main-nav" aria-label="Основная навигация">
        <Link href="/heroes">Герои</Link>
        <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Источник данных <span aria-hidden="true">↗</span></a>
      </nav>
    </header>
  );
}
