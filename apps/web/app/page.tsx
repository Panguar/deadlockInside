import "./home/hero.css";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Patron } from "@/components/home/Patron";
import { SmoothScroll } from "@/components/home/SmoothScroll";
import { MetaSection } from "@/components/home/MetaSection";
import { HeroGallery } from "@/components/home/HeroGallery";
import { WorkshopSection } from "@/components/home/WorkshopSection";
import { ProfileSection } from "@/components/home/ProfileSection";

const PARTS = [
  { key: "guardians" as const, label: "Мета патча", href: "#meta" },
  { key: "walkers" as const, label: "Герои", href: "#heroes" },
  { key: "shrines" as const, label: "Билды", href: "#workshop" },
  { key: "cage" as const, label: "Матчи и лидерборд", href: "#workshop" },
  { key: "core" as const, label: "Ваш профиль", href: "#profile" },
];

export default function HomePage() {
  return (
    <div className="home">
      <SmoothScroll />
      <div className="home-stage-track">
        <div className="home-stage-layer">
          <Patron parts={PARTS} />
        </div>
        <section id="top" className="home-hero" aria-labelledby="home-title">
          <div className="container home-hero-inner">
            <div className="home-hero-copy">
              <h1 id="home-title" className="home-wordmark">Deadlock<br />Insight</h1>
              <p className="home-lede">Герои, матчи и игроки Deadlock по живым данным матчей.</p>
              <PlayerSearch />
            </div>
          </div>
        </section>
        <section id="parts" className="home-parts" aria-labelledby="parts-title">
          <div className="container">
            <h2 id="parts-title" className="visually-hidden">Разбор механизма</h2>
          </div>
        </section>
      </div>
      <MetaSection />
      <HeroGallery />
      <WorkshopSection />
      <ProfileSection />
    </div>
  );
}
