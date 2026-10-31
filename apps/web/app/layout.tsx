import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountProvider } from "@/components/AccountProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deadlock Inside — статистика игроков и героев",
  description: "История матчей, статистика игроков и аналитика героев Deadlock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Forum&family=Manrope:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <AccountProvider>
          <div className="site-shell">
            <SiteHeader />
            <main>{children}</main>
            <footer className="site-footer">
              <span className="footer-mark">DEADLOCK <span className="footer-diamond" aria-hidden="true">◆</span> INSIDE</span>
              <span>Данные зависят от доступной истории матчей.</span>
            </footer>
          </div>
        </AccountProvider>
      </body>
    </html>
  );
}
