# Локальный runbook

Этот документ описывает эксплуатационный Compose на одной машине. Публичного адреса и хостинга пока нет. Compose публикует только web на loopback `127.0.0.1:8080`; API, PostgreSQL и Redis не имеют host-портов. Он использует отдельное имя проекта `deadlock-inside-release` и отдельные volumes, не подключая dev volumes из `compose.yaml`.

## Секреты и первый запуск

Скопируйте `.env.production.example` как `.env.production`, задайте отдельный пароль PostgreSQL из случайных букв и цифр длиной не менее 32 символов. Не используйте dev/test пароль и не передавайте пароль в командной строке. Файл `.env.production` игнорируется Git. `DEADLOCK_API_KEY` не нужен для обычного публичного API источника и не задан в Compose.

```sh
cp .env.production.example .env.production
# Отредактируйте .env.production локальным редактором.
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml config --quiet
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml up --build -d --wait
curl --fail http://127.0.0.1:8080/
```

Если порт занят, измените `WEB_PORT` в локальном env-файле. Для завершения используйте `docker compose ... down`: именованные volumes сохраняются. Не добавляйте `-v` к команде остановки.

## HTTPS и reverse proxy

При будущем размещении оставьте API, PostgreSQL и Redis во внутренней сети. Направьте HTTPS reverse proxy только на web-сервис, настройте TLS, ограничения размера/частоты запросов и передачу `X-Forwarded-For`. В `TRUSTED_PROXY_NETWORKS` внесите точные CIDR адреса доверенного proxy в JSON-массиве. Не доверяйте произвольным forwarded-заголовкам. Текущая публикация loopback доступна только локальному proxy на этой машине; сама по себе она не обеспечивает TLS или публичное размещение.

## Миграции, обновление и откат

`migrate` запускает `alembic upgrade head` один раз. API, worker и beat ждут успешного завершения миграций; ошибка миграции останавливает запуск зависимых приложений. Не запускайте несколько экземпляров beat.

Перед обновлением сделайте backup. Затем из корня репозитория:

```sh
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml up --build -d --wait
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml ps
curl --fail http://127.0.0.1:8080/api/v1/heroes
```

Изменения приложения можно откатить, вернув предыдущий checkout/image и повторив `up --build`. Не запускайте Alembic downgrade на рабочей базе. Если новая схема несовместима со старой версией, восстановите проверенную копию в отдельную БД по процедуре ниже, проверьте counts и UI/API, затем отдельно согласуйте переключение приложения на восстановленную БД. До выбора площадки не выполняйте внешнее переключение или публикацию.

## Резервные копии и восстановление

Команда backup создаёт custom-format archive в `.backups`, ограничивает доступ к каталогу и файлу, атомарно переименовывает завершённую копию и удаляет только собственные `deadlock-*.dump` старше семи суток:

```sh
sh scripts/backup-db.sh
```

Запланируйте её ежедневно через системный scheduler, например в 03:00 по локальному времени. Каталог `.backups` хранится на том же компьютере, поэтому для аварии диска перенесите копии в защищённое независимое хранилище с собственным контролем доступа. Не выводите env-файл или пароль в scheduler log.

Восстановление требует путь к архиву и имя новой БД. Скрипт принимает только безопасные PostgreSQL identifiers до 63 символов, запрещает имя настроенной рабочей БД и отказывается от уже существующей базы. Он создаёт отдельную БД и не использует `DROP`, `--clean` или замену существующих данных:

```sh
sh scripts/restore-db.sh .backups/deadlock-YYYYMMDDTHHMMSSZ.dump deadlock_restore_check
```

После успешного восстановления команда выводит число игроков, матчей и участников, а также один account ID для выборочной сверки. До переключения приложения проверьте эти значения с состоянием на момент backup и откройте профиль/матч через API или отдельный локальный клиент. Не запускайте downgrade или очистку исходной БД для проверки восстановления. Имена восстановительных БД намеренно остаются занятыми, пока оператор не проверит содержимое и не решит, что с ними делать.

## Диагностика

```sh
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml ps
docker compose --project-name deadlock-inside-release --env-file .env.production -f compose.production.yaml logs --tail=200 migrate api worker beat web
curl --fail http://127.0.0.1:8080/api/v1/heroes
```

`/health/live` проверяет процесс API, `/health/ready` дополнительно проверяет PostgreSQL и Redis. Задания обновления доступны через API и сохраняют код отказа; сверяйте job ID из ответа с логами worker. Ошибка источника может временно вернуть stale данные или завершить job как failed; исправьте сетевую/источниковую причину и запросите новый refresh. Не повторяйте запросы массово: внешний источник имеет собственные ограничения частоты.

Полностью синтетический сценарий поиска/профиля/матча запускается отдельным проектом `deadlock-inside-smoke` на порту 8081 через `SMOKE_FIXTURE=1 sh scripts/smoke.sh`. Скрипт требует явного флага, задаёт `DEADLOCK_API_BASE_URL` только override-файлом и не меняет основной локальный release-проект. Если запускать CLI helper в Docker Desktop, задайте `SMOKE_BASE_URL=http://host.docker.internal:8081`; при запуске на хосте используется loopback по умолчанию.
