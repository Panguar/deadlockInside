import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const exported = spawnSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "api",
    "python",
    "-c",
    "import json; from deadlock.main import create_app; print(json.dumps(create_app().openapi(), separators=(',', ':'))) ",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, POSTGRES_PASSWORD: "openapi-schema-generation" },
  },
);

if (exported.error) throw exported.error;
if (exported.status !== 0) {
  throw new Error(`Could not export FastAPI OpenAPI schema: ${exported.stderr.trim()}`);
}

const schema = JSON.parse(exported.stdout);
const schemaPath = resolve(packageRoot, "openapi.json");
const typesPath = resolve(packageRoot, "src/schema.d.ts");
await mkdir(dirname(typesPath), { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
await writeFile(typesPath, astToString(await openapiTS(schema)));
