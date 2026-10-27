# Deadlock Inside

Локальный сайт статистики Deadlock: поиск игрока, история и разбор матчей, каталог героев. Приложение состоит из Next.js web, FastAPI API, PostgreSQL, Redis, Celery worker и одного beat-процесса. Публичный запуск не настроен.

## Локальная разработка

Нужны Docker Engine с Compose, Node.js 24.21.0, pnpm 11.25.0 и uv 0.12.7.

```sh
cp .env.example .env
# Задайте локальный POSTGRES_PASSWORD в .env.
docker compose up --build -d --wait
curl --fail http://127.0.0.1:8000/health/ready
```

Dev Compose публикует API, PostgreSQL и Redis только на localhost. `docker compose down` сохраняет данные; не используйте `down -v` для обычной остановки. Подробности: [локальная разработка](docs/local-development.md) и [разработка web](docs/web-development.md).

## Локальный полный стек

Production-подобный Compose изолирован отдельным именем проекта и собственными named volumes. Скопируйте `.env.production.example` в `.env.production`, замените пароль на уникальное случайное значение и оставьте файл только локально:

```sh
cp .env.production.example .env.production
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml config --quiet
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml up --build -d --wait
curl --fail http://127.0.0.1:8080/
```

Снаружи Compose опубликован только web на `127.0.0.1:8080`; API, PostgreSQL и Redis доступны лишь внутри сети проекта. Миграции выполняет отдельный сервис перед API и worker. Для backup, восстановления, обновлений и диагностики см. [runbook](docs/runbook.md). Это локальная конфигурация, она не публикует приложение в интернете.

## Проверки

API integration tests используют реальные PostgreSQL и Redis на тестовом проекте `compose.test.yaml`. Web проверки и генерация клиента:

```sh
cd apps/api
uv sync --frozen
uv run --frozen pytest -v
cd ../..
pnpm install --frozen-lockfile
pnpm generate:api
pnpm typecheck
pnpm build
pnpm --dir apps/web exec playwright install chromium
pnpm test:e2e
```

OpenAPI-клиент генерируется из локальной FastAPI factory, без запущенного Docker API или доступа к внешнему Deadlock API. CI выполняет эти проверки с фиксированными данными. Сценарий stage 7 использует отдельный явно выбранный синтетический provider:

```sh
docker run --rm \
  -v "$PWD:/workspace" -v /var/run/docker.sock:/var/run/docker.sock \
  -w /workspace docker:28-cli sh -c \
  'apk add --no-cache bash curl jq >/dev/null && SMOKE_FIXTURE=1 SMOKE_BASE_URL=http://host.docker.internal:8081 sh scripts/smoke.sh'
```

Smoke запускает изолированный Compose с fixture override и проходит поиск → профиль → матч; синтетические ID существуют только в этой локальной проверке. Настоящее покрытие внешнего источника проверялось отдельно и не подменяется фикстурой.

## Профили Steam

Для прямого получения ника и аватара добавьте `STEAM_API_KEY` в локальный `.env`
(для production Compose — `.env.production`) и пересоздайте API и worker.
Для dev Compose: `docker compose up -d --build api worker`.
Ключ можно получить на https://steamcommunity.com/dev/apikey; храните его только
на сервере, не в `NEXT_PUBLIC_*` и не в репозитории.

Поиск принимает account ID, Steam ID64, ник, HTTPS-ссылки
`https://steamcommunity.com/profiles/<SteamID64>` и
`https://steamcommunity.com/id/<имя>`. Последний вариант требует ключа Steam.
Без ключа и при сбое получения профиля Steam используется Deadlock API.
Ники ищутся через Deadlock API; ранг и матчи также остаются у этого поставщика.
Профиль обновляется существующей операцией refresh, чтение страницы использует БД.

Методы: [Steam ISteamUser](https://partner.steamgames.com/doc/webapi/ISteamUser).

## Документы

- [Архитектура и границы первого релиза](docs/superpowers/specs/2026-10-18-deadlock-inside-design.md)
- [План разработки](docs/superpowers/plans/2026-10-18-deadlock-inside.md)
- [Ограничения источника](docs/data-source.md)
- [Runbook эксплуатации](docs/runbook.md)
