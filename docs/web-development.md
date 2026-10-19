# Локальная разработка веб-приложения

Веб-приложение использует Node.js `24.21.0` из `.node-version` и закреплённый pnpm `11.25.0`. Перед разработкой поднимите API, PostgreSQL и Redis командами из `docs/local-development.md`, затем в корне репозитория выполните `pnpm install`.

`pnpm generate:api` экспортирует `create_app().openapi()` внутри работающего контейнера `api` и обновляет `packages/api-client/openapi.json` вместе с `packages/api-client/src/schema.d.ts`. После генерации можно проверить отсутствие незаписанных изменений командой `git diff --exit-code -- packages/api-client/openapi.json packages/api-client/src/schema.d.ts`.

`pnpm --dir apps/web dev` запускает сайт на `http://127.0.0.1:3000`. Браузер обращается к API через same-origin путь `/api/v1/*`; сервер Next.js пересылает запросы к `DEADLOCK_API_INTERNAL_URL`, по умолчанию `http://127.0.0.1:8000`. Переменная не публикуется в клиентском JavaScript.

Проверки Stage 6 запускаются из корня:

```powershell
pnpm typecheck
pnpm build
pnpm test:e2e
```

Playwright поднимает отдельный веб-процесс на `127.0.0.1:3100` с недоступным upstream `127.0.0.1:9`. Тесты перехватывают весь same-origin `/api/v1/*` трафик и завершаются ошибкой при незаданном ответе, поэтому browser fixtures не обращаются к основному API.
