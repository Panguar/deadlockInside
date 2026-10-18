# Локальная разработка: сервер и база

На этапе 2 реализованы FastAPI, семь таблиц PostgreSQL, Alembic и health endpoints. Поиск, загрузка матчей, Celery и Next.js будут добавлены следующими этапами.

## Версии

Python 3.14.7 (`apps/api/.python-version`), uv 0.12.7, PostgreSQL 17.11, Redis server 8.10.2. Python-зависимости и хеши закреплены в `apps/api/uv.lock`: FastAPI 0.146.0, SQLAlchemy 2.0.55, Alembic 1.20.0, psycopg 3.3.6, redis client 7.4.1. Node 24.21.0 закреплён для будущего frontend; pnpm и зависимости web будут зафиксированы при его создании.

## Полный запуск через Compose

Нужен работающий Docker Engine (на macOS — Docker Desktop или Colima) и Compose. Один Docker CLI без Engine не запускает контейнеры.

Из корня репозитория:

```sh
cp .env.example .env
# Установите локальный пароль POSTGRES_PASSWORD в .env.
docker compose config --quiet
docker compose up --build -d
curl --fail http://127.0.0.1:8000/health/live
curl --fail http://127.0.0.1:8000/health/ready
```

POSTGRES_PASSWORD в этом dev-compose подставляется в URI: используйте буквы/цифры/дефис либо корректное URI-кодирование. Для ручного запуска одновременно обновите DATABASE_URL. Не используйте демонстрационный пароль для production.

Compose ждёт PostgreSQL, применяет миграции отдельным сервисом `migrate`, затем запускает API после готовности Redis. База и Redis сохраняют данные в named volumes. Порты опубликованы только на localhost: API 8000, PostgreSQL 5432, Redis 6379. OpenAPI доступна на `/openapi.json`, Swagger — на `/docs`.

```sh
docker compose logs api migrate
docker compose down
```

`down` сохраняет volumes; `down -v` удаляет данные и для обычной остановки не нужен. Это конфигурация разработки, не публичного размещения.

Если Homebrew установил Compose отдельно и `docker compose` ещё недоступен, используйте `docker-compose` с теми же аргументами; менять глобальные настройки Docker для этого не требуется.

## Запуск Python на хосте

Можно запустить только PostgreSQL/Redis через Compose:

```sh
docker compose up -d postgres redis
cd apps/api
uv sync --frozen
uv run --env-file ../../.env alembic upgrade head
uv run --env-file ../../.env uvicorn deadlock.main:create_app --factory --reload --host 127.0.0.1 --port 8000
```

DATABASE_URL должен использовать `postgresql+psycopg://`, REDIS_URL — `redis://` или `rediss://`. Секреты читаются из окружения; app factory создаёт соединения в lifespan, закрывает пул и Redis при остановке. `get_session` выдаёт сессию на запрос; транзакции и commit принадлежат будущему сервисному слою.

`/health/live` проверяет процесс и работает при отказе БД/Redis. `/health/ready` выполняет SELECT 1 и PING; при ошибке возвращает 503 с общим сообщением и request_id без адресов или паролей. Это проверка доступности зависимостей, а не проверка миграций: их гарантирует отдельный шаг запуска.

## Изолированные интеграционные тесты

Тесты используют настоящий PostgreSQL и Redis. Отдельный Compose-проект `deadlock-inside-tests` не разделяет данные с dev-приложением, использует порты 55432 и 56379 и временное хранилище PostgreSQL.

```sh
# Из корня:
docker compose -f compose.test.yaml up -d --wait
cd apps/api
uv sync --frozen
uv run --env-file ../../.env.test.example pytest -v
# Из корня после тестов:
docker compose -f compose.test.yaml down
```

Тесты требуют TEST_DATABASE_URL с именем БД, заканчивающимся `_test`, и TEST_REDIS_URL. Не указывайте production даже с таким суффиксом. Миграции применяются к указанной тестовой БД; записи каждого теста откатываются транзакцией. При отсутствии переменных тесты падают с понятным сообщением, а не молча пропускают проверки.

Схему и цикл миграции проверяйте только на тестовой базе:

```sh
cd apps/api
export DATABASE_URL='postgresql+psycopg://deadlock:test-only@127.0.0.1:55432/deadlock_test'
uv run alembic upgrade head
uv run alembic downgrade base
uv run alembic upgrade head
uv run alembic check
```

`downgrade base` удаляет таблицы и допустим только на одноразовой тестовой БД. В рабочей базе применяйте только нужные проверенные миграции.

## Проверка этапа 2 на этой машине

13 integration tests прошли на PostgreSQL 17.11 и Redis 8.10.2, запущенных отдельно на localhost в временном каталоге; автозапуск служб не включался. Проверены уникальность, foreign keys, nullable-значения, timezone-aware время, rollback, статусы и ограничение одного активного refresh. Health проверен с исправными и отказавшими зависимостями. Upgrade → downgrade → upgrade и Alembic check прошли.

Обе Compose-конфигурации валидны, наличие четырёх закреплённых образов подтверждено registry. Docker Engine на машине отсутствует, поэтому сборка Dockerfile и полный контейнерный запуск пока не проверены. Этот пункт нужно выполнить после появления Engine; Python-сервер и база проверены напрямую.
