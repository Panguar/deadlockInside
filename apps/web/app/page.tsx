import { HeroBoard } from "@/components/HeroBoard";
import { PlayerSearch } from "@/components/PlayerSearch";
import { CommunityPanel } from "@/components/CommunityPanel";

export default function HomePage() {
  return (
    <div className="page-content home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> АНАЛИТИКА МАТЧЕЙ DEADLOCK</span>
          <h1>Каждый матч<br /><em>рассказывает больше.</em></h1>
          <p>История игрока и общая статистика героев — по фактически сохранённым матчам и данным источника.</p>
          <PlayerSearch />
        </div>
        <div className="orbital-art" aria-hidden="true">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="core-mark"><span>DI</span><i /><b /></div>
          <span className="art-tag tag-top">MATCH / 01</span><span className="art-tag tag-bottom">STATS LIVE</span>
        </div>
      </section>
      <section className="home-guide" aria-label="Как это работает">
        <div><span>01</span><p>Найдите игрока по имени или ID</p></div>
        <div><span>02</span><p>Сравните матчи и героев</p></div>
        <div><span>03</span><p>Откройте состав матча</p></div>
      </section>
      <CommunityPanel />
      <HeroBoard compact />
    </div>
  );
}
