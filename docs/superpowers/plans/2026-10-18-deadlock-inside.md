# Deadlock Inside Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Делегирование — только после выбора пользователем этого способа работы.

**Goal:** Первый релиз статистики Deadlock: поиск, профили, матчи и аналитика героев.

**Architecture:** Next.js обращается к отдельному FastAPI; PostgreSQL хранит данные, Celery загружает и обновляет их, Redis обслуживает кеш и очередь.

**Tech Stack:** Next.js, TypeScript, FastAPI, Pydantic, PostgreSQL, SQLAlchemy, Alembic, Redis, Celery, httpx, pytest, Playwright, Docker Compose.

**Spec:** [Архитектура и границы релиза](../specs/2026-10-18-deadlock-inside-design.md).

Статус: подготовлен для ревью 18 октября 2026 года; реализация не начата. Next.js и Python подтверждены пользователем; остальные решения — предложения спецификации. Каждый этап заканчивается проверяемым результатом и отдельным коммитом.

## Global Constraints

- Интерфейс — Next.js и TypeScript; отдельный полноценный бэкенд — Python.
- ID в JSON — строки; время — UTC ISO 8601.
- Отсутствующие значения — null, а не ноль.
- Русский интерфейс, мобильная версия, публичный просмотр без регистрации.
- Секреты не попадают в браузер, git и фикстуры.
- Личная статистика относится к загруженной выборке; глобальная имеет отдельное происхождение.

## Review Focus

1. Неуникальные ники и большие Steam ID: список кандидатов и точное преобразование — этапы 1 и 4.
2. Пустая история, неизвестный результат/ранг, нулевые смерти: корректные null и знаменатели — этапы 2 и 5.
3. Timeout, 429/503, отказ Redis: ограниченные повторы и сохранённые данные — этапы 3 и 4.
4. Конкурентный refresh и повторная доставка: одна логическая загрузка без дублей — этап 3.
5. Границы периода, одинаковое время матчей, смена фильтра: стабильная пагинация и соответствие выборки — этапы 4 и 6.

## Структура репозитория

```text
apps/web/                         # Next.js App Router
apps/api/pyproject.toml            # Зависимости Python
apps/api/src/deadlock/main.py      # FastAPI factory
apps/api/src/deadlock/core/        # Config, DB, cache, errors, logging
apps/api/src/deadlock/providers/   # Адаптер Deadlock API
apps/api/src/deadlock/players/     # Router, schemas, service, models, stats
apps/api/src/deadlock/matches/     # Router, schemas, models, ingest
apps/api/src/deadlock/heroes/      # Router, schemas, service, models
apps/api/src/deadlock/jobs/        # Celery, dispatcher, tasks, models
apps/api/migrations/               # Alembic
apps/api/tests/                   # Unit/integration tests и fixtures
packages/api-client/              # Генерируемый TypeScript-клиент
infra/                            # Dockerfiles и reverse proxy
compose.yaml                      # Локальный запуск
compose.production.yaml           # Production-настройки
scripts/                          # Smoke, backup, restore
```

## Этап 1. Проверка источника

**Файлы:** `docs/data-source.md`, `apps/api/tests/fixtures/provider/*.json`, `apps/api/tests/fixtures/provider/README.md`.

**Вход:** спецификация и актуальная документация Deadlock API. **Выход:** проверенная таблица «показатель → endpoint → поле → ограничения» и обезличенные ответы для тестов.

- [ ] Проверить OpenAPI, условия использования данных/ассетов, необходимость ключа и квоты. Записать дату проверки.
- [ ] Выполнить небольшое число запросов: поиск, известный/отсутствующий игрок, пустая история, полный/неполный матч, герои и агрегаты. Не обходить массово профили.
- [ ] Проверить неоднозначный ник, ID64/account ID, единицы времени, результат/режим матча, пагинацию и фильтры. Непроверяемый случай явно отметить.
- [ ] Сохранить минимальные обезличенные JSON, проверить их парсером; секреты удалить до записи.
- [ ] Сопоставить доступные данные с экранами. Уточнить спецификацию до реализации недоступных функций. Зафиксировать предел начальной загрузки и отображаемое покрытие.
- [ ] Коммит: `docs: verify Deadlock data source`.

**Готово:** установлено, что можно показать на реальных данных. Это первая контрольная точка перед разработкой.

## Этап 2. Основа сервера и хранилища

**Файлы:** `apps/api/pyproject.toml`, `src/deadlock/main.py`, `core/{config,db,errors}.py`, `{players,matches,heroes,jobs}/models.py`, `migrations/`, `tests/integration/test_schema.py`, `test_health.py`, `compose.yaml`, `.env.example`, `.gitignore`. Здесь и далее Python-пути относительно `apps/api/`.

**Интерфейсы:** `create_app() -> FastAPI`, `get_session()`; `/health/live`, `/health/ready`; таблицы players, heroes, matches, match_players, rank_snapshots, hero_stats_snapshots, refresh_jobs.

- [ ] Выбрать совместимые стабильные версии Python/Node и библиотек; закрепить версии и lock-файлы. Менеджеры — uv и pnpm.
- [ ] Написать падающие PostgreSQL integration tests: уникальность account_id, match_id и `(match_id, account_id)`, nullable rank/damage, откат невалидного матча.
- [ ] Реализовать модели и миграции с внешними ключами, timezone-aware датами и индексами истории по игроку/времени. Проверить upgrade → downgrade → upgrade на отдельной тестовой БД.
- [ ] Написать и выполнить падающие health tests; реализовать live=200 и ready=200/503 в зависимости от PostgreSQL/Redis. В ответах нет DSN.
- [ ] Подключить API, PostgreSQL, Redis в Compose, healthchecks и именованный volume БД; описать запуск тестовой БД отдельно от пользовательских данных.
- [ ] Проверка из `apps/api`: `uv run pytest tests/integration/test_schema.py tests/integration/test_health.py -v`; из корня: `docker compose config`. Ожидается успех.
- [ ] Коммит: `feat: add API and database foundation`.

## Этап 3. Надёжная загрузка и обновления

**Файлы:** `providers/{schemas,deadlock_api,limiter}.py`, `matches/ingest.py`, `jobs/{celery_app,service,tasks,dispatcher}.py`, `core/cache.py`, `tests/unit/test_provider.py`, `tests/integration/test_ingest.py`, `test_refresh.py`; дополнить Compose.

**Интерфейсы:** `DeadlockProvider.search_players(query: str) -> list[PlayerCandidate]`, `fetch_player(account_id: int) -> ProviderPlayer`, `fetch_match_page(account_id: int, cursor: str | None) -> ProviderMatchPage`, `fetch_match(match_id: int) -> ProviderMatch`; `ingest_match(session, match: ProviderMatch) -> int`; `request_refresh(account_id: int) -> RefreshJob`. Pydantic-типы объявляются в `providers/schemas.py` по результатам этапа 1.

- [ ] Написать и запустить падающие tests адаптера: преобразование ID, лишние/отсутствующие поля, timeout, 429/503 с Retry-After, 404 без повтора.
- [ ] Реализовать httpx-адаптер с connect/read timeout, проверкой схем и общим Redis-ограничителем фактических квот из `docs/data-source.md`. При отказе ограничителя внешние запросы не выполнять.
- [ ] Написать падающие tests импорта: два импорта дают один матч; ошибка участника откатывает запись; partial-ответ не стирает известные поля.
- [ ] Реализовать транзакционный upsert матчей и участников.
- [ ] Написать падающие tests конкурентного refresh, повторной доставки, cooldown 5 минут, восстановления lease и недоступного брокера.
- [ ] Реализовать сохраняемые статусы заданий, lease, dispatcher для сохранённых queued-заданий и безопасный повтор. Не считать refresh успешным до записи данных.
- [ ] Настроить до 3 повторов по правилам спецификации и инвалидацию кеша после commit. Добавить worker и один beat.
- [ ] Проверка: `uv run pytest tests/unit/test_provider.py tests/integration/test_ingest.py tests/integration/test_refresh.py -v`; затем задача через настоящий Redis/Celery с повторной доставкой. Ожидается отсутствие дублей и корректный финальный статус.
- [ ] Коммит: `feat: ingest matches with reliable background refresh`.

## Этап 4. API поиска, профиля и матчей

**Файлы:** `players/{router,schemas,service}.py`, `matches/{router,schemas}.py`, `jobs/router.py`, `core/rate_limit.py`, `tests/integration/test_players_api.py`, `test_matches_api.py`; подключить routers в `main.py`.

**Интерфейсы:** маршруты, envelope, ошибки и пагинация строго по спецификации. Pydantic — единственный источник публичной OpenAPI-схемы.

- [ ] Написать падающие API tests: неоднозначный ник → кандидаты; неверный ID → 422; отсутствующий профиль → 404; refresh → 202/job ID; повторный refresh → существующее задание.
- [ ] Реализовать поиск: trim, длина 2–100 символов, максимум 20 кандидатов. ID нормализовать по этапу 1; произвольные пользовательские URL не запрашивать.
- [ ] Реализовать чтение БД, null-поля, partial-статус, metadata свежести и endpoint статуса задания.
- [ ] Написать tests пагинации: одинаковый started_at без дублей/пропусков, limit 20/100, плохой курсор=422, смена фильтра с прежним курсором=422, from включительно/to исключительно. Реализовать эти правила.
- [ ] Добавить tests отказа источника: сохранённые данные со stale=true; без данных — 503. Реализовать обработку ошибок без утечки внутренних исключений.
- [ ] Добавить rate limits и доверенные proxy. Tests: 429 после лимита, подмена forwarded заголовка недоверенным клиентом не обходит ограничение.
- [ ] Проверка: `uv run pytest tests/integration/test_players_api.py tests/integration/test_matches_api.py -v`; проверить строковые ID в OpenAPI. Ожидается PASS.
- [ ] Коммит: `feat: expose player and match API`.

## Этап 5. Личные расчёты и глобальная аналитика

**Файлы:** `players/stats.py`, `heroes/{router,schemas,service}.py`, `tests/unit/test_stats.py`, `tests/integration/test_hero_stats.py`; дополнить адаптер и задачи.

**Интерфейсы:** `calculate_player_stats(rows: Sequence[PlayerMatchRow]) -> PlayerStats`. Типы в `players/schemas.py`: вход — hero ID, nullable исход, kills/deaths/assists; выход — sample_size, decided_matches, wins, win_rate, kda, статистика героев. Снимок глобальной аналитики хранит source, период, фильтры, sample_size и updated_at.

- [ ] Написать и запустить падающие tests: пустая выборка → win_rate=null; 2 победы/3 известных исхода → 2/3; неизвестный исход исключён из знаменателя; 10 kills + 5 assists при 0 deaths → KDA=15; агрегируются суммы, а не средние KDA.
- [ ] Реализовать расчёты и запросы с общими с историей фильтрами. sample_size и decided_matches возвращать отдельно.
- [ ] Написать падающие tests глобальных снимков: source и размер выборки обязательны; пустые данные не превращаются в 0%; кеш другой комбинации фильтров не используется.
- [ ] Реализовать справочники и агрегаты источника, TTL 24 часа/1 час и расписание. Противостояния/сборки включить только при подтверждённом контракте; не выдавать корреляцию за гарантированный эффект предмета.
- [ ] Проверка: `uv run pytest tests/unit/test_stats.py tests/integration/test_hero_stats.py -v`. Ожидается PASS.
- [ ] Коммит: `feat: add player and hero analytics`.

## Этап 6. Интерфейс Next.js

**Файлы:** `apps/web/app/{layout.tsx,page.tsx,loading.tsx,error.tsx}`, страницы `players/[accountId]/page.tsx`, `matches/[matchId]/page.tsx`, `heroes/page.tsx`, `heroes/[heroId]/page.tsx`; `apps/web/components/{PlayerSearch,MatchHistory,StatsSummary,HeroTable}.tsx`, `apps/web/lib/api.ts`, `packages/api-client/`, `apps/web/tests/e2e/player-flow.spec.ts`.

**Интерфейсы:** генерируемый TypeScript-клиент из FastAPI OpenAPI. Фильтры в URL, серверный API URL только в серверном окружении; браузер использует same-origin proxy.

- [ ] Инициализировать Next.js App Router и pnpm workspace; закрепить lockfile. Добавить воспроизводимую генерацию клиента из `create_app().openapi()`.
- [ ] Написать падающий Playwright-сценарий с контролируемым API: поиск → выбор одноимённого игрока → профиль → фильтр героя → матч.
- [ ] Реализовать общий стиль: тёмная палитра, портреты из разрешённых источников, читаемые таблицы, адаптивная навигация. Показывать source/sample_size/updated_at рядом с показателями.
- [ ] Реализовать поиск, профиль, историю, матч и героев. При незагруженном профиле предложить refresh, показать job status и перечитать после успеха. Останавливать polling при уходе со страницы и по timeout.
- [ ] Реализовать loading/empty/partial/stale/error. Смена фильтра сбрасывает курсор; устаревший медленный ответ не заменяет актуальный.
- [ ] Дополнить browser tests: пустая история, отсутствующий ранг, 503, failed refresh, смена фильтра при активном запросе, большие строковые ID, клавиатурный поиск.
- [ ] Проверка из `apps/web`: `pnpm typecheck`, `pnpm build`, `pnpm exec playwright test`. Scripts определить при инициализации. Вручную проверить 375/1440 px. Ожидается успех всех проверок.
- [ ] Коммит: `feat: build statistics interface`.

## Этап 7. Сквозная проверка и подготовка эксплуатации

**Файлы:** `infra/{web,api}.Dockerfile`, `compose.production.yaml`, `.github/workflows/ci.yml`, `docs/runbook.md`, `scripts/{smoke,backup-db,restore-db}.sh`; обновить Compose и README.

**Интерфейсы:** документированный запуск, миграции отдельным шагом, healthchecks, изолированные тестовые PostgreSQL/Redis. Restore требует явного имени отдельной целевой БД и не перезаписывает production по умолчанию.

- [ ] Собрать все сервисы; наружу публиковать только web/proxy. Настроить сохранение данных и раздельные секреты.
- [ ] Настроить CI: pytest, генерация клиента без diff, typecheck, Next.js build и Playwright на фиксированных данных. Внешний API не требуется для воспроизводимого CI.
- [ ] Выполнить `docker compose config`, `docker compose up --build -d`, `bash scripts/smoke.sh`. Smoke проверяет health, справочник и контролируемый профиль. После restart сверить сохранённые матчи; volumes не удалять.
- [ ] Пройти путь поиск → профиль → матч на нескольких реальных профилях без массовой загрузки; записать фактическое покрытие источника.
- [ ] Проверить отказ источника, повторную доставку задания и восстановление backup в отдельную БД со сверкой числа матчей.
- [ ] Описать HTTPS, proxy, секреты, миграции, обновление/откат приложения, диагностику failed jobs, ежедневный backup с хранением 7 суток и восстановление.
- [ ] Обновить README фактическими командами. На итоговом состоянии запустить полный набор проверок, устранить ошибки. Коммит: `chore: prepare release and operations`.
- [ ] Перед публикацией выбрать с владельцем хостинг/домен и проверить конфигурацию на выбранной площадке. Локальный запуск не считается production-деплоем.

## Порядок и контрольные точки

1 → 2 → 3 → 4 → 5 → 6 → 7. После этапа 1 подтверждается реализуемость функций на источнике. После этапа 4 работает самостоятельный сервер. После этапа 6 — полный пользовательский сценарий. После этапа 7 — воспроизводимый релиз и инструкция эксплуатации; публикация зависит от площадки.

Оценку сроков составить после проверки API. Количество этапов не является оценкой в днях.

## Самопроверка

Все экраны первого релиза привязаны к этапам; ограничения источника и основные отказы имеют проверки. Контракт API общий для web/server, ID и временные границы согласованы. Авторизация, live и прогнозы вынесены за пределы релиза. Следующий шаг — ревью документов и выбор способа выполнения; код приложения в рамках этого плана ещё не написан.
