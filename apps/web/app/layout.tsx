import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountProvider } from "@/components/AccountProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deadlock Insight: статистика игроков и героев",
  description: "История матчей, статистика игроков и аналитика героев Deadlock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Advent+Pro:wdth,wght@100,500;100,700&family=Onest:wght@400;600&family=Poiret+One&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body>
        <AccountProvider>
          <div className="site-shell">
            <SiteHeader />
            <main>
              {children}
            </main>
            <footer className="site-plaque">
              <div className="plaque-plate">
                <p className="plaque-wordmark">Deadlock Insight</p>
                <nav aria-label="Нижняя навигация">
                  <a href="/heroes">Герои</a>
                  <a href="/account/favorites">Избранное</a>
                </nav>
                <p className="plaque-note">Данные: deadlock-api.com и Steam.</p>
                <p className="plaque-note">Неофициальный фан-проект. Не связан с Valve.</p>
              </div>
            </footer>
          </div>
        </AccountProvider>
      </body>
    </html>
  );
}
