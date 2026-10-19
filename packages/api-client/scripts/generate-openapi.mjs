import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const apiRoot = resolve(repositoryRoot, "apps/api");
const exported = spawnSync(
  "uv",
  [
    "run",
    "--frozen",
    "--no-sync",
    "python",
    "-c",
    "import json; from deadlock.main import create_app; print(json.dumps(create_app().openapi(), separators=(',', ':'))) ",
  ],
  {
    cwd: apiRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql+psycopg://schema:schema@127.0.0.1/schema",
      REDIS_URL: "redis://127.0.0.1:6379/0",
    },
  },
);

if (exported.error) throw exported.error;
if (exported.status !== 0) {
  throw new Error(`Could not export FastAPI OpenAPI schema with uv: ${exported.stderr.trim()}`);
}

const schema = JSON.parse(exported.stdout);
const schemaPath = resolve(packageRoot, "openapi.json");
const typesPath = resolve(packageRoot, "src/schema.d.ts");
await mkdir(dirname(typesPath), { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
await writeFile(typesPath, astToString(await openapiTS(schema)));
