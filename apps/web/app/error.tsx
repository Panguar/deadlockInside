"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="state-panel" role="alert">
      <span className="eyebrow">ОШИБКА ЗАГРУЗКИ</span>
      <h1>Не удалось открыть страницу</h1>
      <p>Попробуйте ещё раз. Сохранённые данные не менялись.</p>
      <button className="button button-secondary" onClick={() => reset()}>Повторить</button>
    </section>
  );
}
