import "./home/hero.css";
import { PlayerSearch } from "@/components/PlayerSearch";
import { Reliquary } from "@/components/home/Reliquary";
import { SmoothScroll } from "@/components/home/SmoothScroll";
import { MetaSection } from "@/components/home/MetaSection";
import { HeroGallery } from "@/components/home/HeroGallery";
import { WorkshopSection } from "@/components/home/WorkshopSection";
import { ProfileSection } from "@/components/home/ProfileSection";

const PARTS = [
  { key: "crown" as const, label: "Мета патча", href: "#meta" },
  { key: "rays" as const, label: "Герои", href: "#heroes" },
  { key: "gears" as const, label: "Билды", href: "#workshop" },
  { key: "dial" as const, label: "Матчи и лидерборд", href: "#workshop" },
  { key: "plinth" as const, label: "Ваш профиль", href: "#profile" },
];

export default function HomePage() {
  return (
    <div className="home">
      <SmoothScroll />
      <div className="home-stage-track">
        <div className="home-stage-layer">
          <Reliquary parts={PARTS} />
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
