import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const source = readFileSync(new URL("../app/api/v1/[...path]/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function loadProxy(fetchImpl) {
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require,
    fetch: fetchImpl,
    process: { env: { DEADLOCK_API_INTERNAL_URL: "http://api.internal" } },
    Headers,
    Response,
    Request,
    URL,
    AbortSignal,
  };
  vm.runInNewContext(compiled, context, { filename: "apps/web/app/api/v1/[...path]/route.ts" });
  return module.exports;
}

function request(method, url, headers = {}, body) {
  const input = new Request(url, { method, headers, ...(body === undefined ? {} : { body }) });
  input.nextUrl = new URL(url);
  return input;
}

const context = (path) => ({ params: Promise.resolve({ path }) });

test("GET proxy preserves manual redirects, multiple cookies and session headers without caching", async () => {
  let received;
  const proxy = loadProxy(async (url, options) => {
    received = { url: String(url), options };
    return new Response(null, {
      status: 302,
      headers: [
        ["location", "https://steamcommunity.com/openid/login"],
        ["set-cookie", "login_state=one; Path=/; HttpOnly; SameSite=Lax"],
        ["set-cookie", "login_nonce=two; Path=/; HttpOnly; SameSite=Lax"],
      ],
    });
  });
  const result = await proxy.GET(request("GET", "https://web.example/api/v1/auth/login?return=%2F", {
    cookie: "session=abc", origin: "https://web.example", "x-csrf-token": "csrf-123",
  }), context(["auth", "login"]));
  assert.equal(received.url, "http://api.internal/api/v1/auth/login?return=%2F");
  assert.equal(received.options.redirect, "manual");
  assert.equal(received.options.cache, "no-store");
  assert.equal(received.options.method, "GET");
  assert.equal(received.options.body, undefined);
  assert.equal(received.options.headers.get("cookie"), "session=abc");
  assert.equal(received.options.headers.get("origin"), "https://web.example");
  assert.equal(received.options.headers.get("x-csrf-token"), "csrf-123");
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("location"), "https://steamcommunity.com/openid/login");
  assert.deepEqual(result.headers.getSetCookie(), [
    "login_state=one; Path=/; HttpOnly; SameSite=Lax",
    "login_nonce=two; Path=/; HttpOnly; SameSite=Lax",
  ]);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("PATCH and DELETE methods and mutation bodies are forwarded", async () => {
  const received = [];
  const proxy = loadProxy(async (url, options) => {
    received.push({ url: String(url), method: options.method, body: options.body && Buffer.from(options.body).toString("utf8") });
    return Response.json({ data: null, meta: {} });
  });
  const patch = request("PATCH", "https://web.example/api/v1/account/preferences", {
    "content-type": "application/json", origin: "https://web.example", "x-csrf-token": "csrf-abc",
  }, JSON.stringify({ default_period: "90" }));
  const patchResult = await proxy.PATCH(patch, context(["account", "preferences"]));
  const deleteResult = await proxy.DELETE(request("DELETE", "https://web.example/api/v1/account/favorites/123", { origin: "https://web.example", "x-csrf-token": "csrf-abc" }), context(["account", "favorites", "123"]));
  assert.equal(patchResult.status, 200);
  assert.equal(deleteResult.status, 200);
  assert.deepEqual(received, [
    { url: "http://api.internal/api/v1/account/preferences", method: "PATCH", body: "{\"default_period\":\"90\"}" },
    { url: "http://api.internal/api/v1/account/favorites/123", method: "DELETE", body: "" },
  ]);
});

test("upstream failure returns a generic non-cached 502 without leaking the upstream URL", async () => {
  const proxy = loadProxy(async () => { throw new Error("failed at http://api.internal/private?token=secret"); });
  const result = await proxy.GET(request("GET", "https://web.example/api/v1/auth/me"), context(["auth", "me"]));
  const body = await result.text();
  assert.equal(result.status, 502);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(body, /api_unavailable/);
  assert.doesNotMatch(body, /api\.internal|token=secret/);
});