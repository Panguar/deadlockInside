import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Deadlock Inside — статистика игроков и героев",
  description: "История матчей, статистика игроков и аналитика героев Deadlock.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>
        <div className="site-shell">
          <SiteHeader />
          <main>{children}</main>
          <footer className="site-footer">
            <span>DEADLOCK INSIDE</span>
            <span>Данные зависят от доступной истории матчей.</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
