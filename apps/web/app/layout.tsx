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
      <body>
        <AccountProvider>
          <div className="site-shell">
            <SiteHeader />
            <main>{children}</main>
            <footer className="site-footer">
              <span>DEADLOCK INSIDE</span>
              <span>Данные зависят от доступной истории матчей.</span>
            </footer>
          </div>
        </AccountProvider>
      </body>
    </html>
  );
}
