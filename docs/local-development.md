# Локальная разработка: сервер и база

Основа сервера включает FastAPI, PostgreSQL, Alembic и health endpoints. Загрузка и обновления выполняются отдельными процессами Celery worker и beat; HTTP API поиска и страниц статистики и интерфейс Next.js относятся к следующим этапам.

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
docker compose logs worker beat
docker compose exec worker celery -A deadlock.jobs.celery_app:celery_app inspect ping
docker compose down
```

`down` сохраняет volumes; `down -v` удаляет данные и для обычной остановки не нужен. Это конфигурация разработки, не публичного размещения.

Worker запускается с concurrency=1. В Compose предусмотрен один beat: он каждые 10 секунд подбирает сохранённые задания обновления и восстанавливает задания с истёкшим lease. Файл расписания beat находится в доступном пользователю контейнера `/tmp/celerybeat-schedule`. Не запускайте дополнительные экземпляры beat для этого проекта.

Задания и их статусы хранятся в PostgreSQL; Redis обслуживает брокер, кеш и общий ограничитель запросов к источнику. При недоступности Redis внешние запросы не выполняются. Локальная политика источника — один запрос в секунду и одна история в шесть минут; пятиминутный cooldown refresh не гарантирует немедленной загрузки. Для локальных проверок адаптера можно задать `DEADLOCK_API_BASE_URL`; по умолчанию используется `https://api.deadlock-api.com/v1`.

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

19 октября 2026 года проверен полный контейнерный запуск на Windows через Docker Desktop (Engine 28.3.2): `docker compose up --build -d --wait` успешно собрал образы, применил миграции и запустил API, PostgreSQL и Redis со статусом healthy. Оба health endpoint вернули `{"status":"ok"}` через опубликованный localhost-порт. Все 13 интеграционных тестов прошли внутри одноразового контейнера с отдельными PostgreSQL и Redis из `compose.test.yaml`. После проверки тестовые контейнеры удалены, основные сервисы оставлены работающими; volumes не удалялись.
