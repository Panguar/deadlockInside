import { expect, test } from "@playwright/test";

const envelope = (data: unknown, meta = {}) => ({ data, meta: { source: "test", updated_at: "2026-10-27T12:00:00Z", stale: false, sample_size: 1, ...meta } });
const account = { account_id: "76561198000000001", personaname: "Alex", avatar_url: "https://avatars.steamstatic.com/alex.jpg", default_period: "30", csrf_token: "csrf-test" };

test("anonymous favorites page offers Steam sign in", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: envelope(null) }));
  await page.goto("/account/favorites");
  await expect(page.getByRole("heading", { name: "Войдите через Steam" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Войти через Steam" })).toHaveAttribute("href", "/api/v1/auth/login");
});

test("favorites page changes saved period, removes favorites and logs out", async ({ page }) => {
  let savedPeriod = "30";
  let favorites = [{ account_id: "1234567890", personaname: "Rival", avatar_url: null }];
  const mutationMethods: string[] = [];
  const csrfHeaders: string[] = [];
  const origins: string[] = [];
  const recordMutation = (request: import("@playwright/test").Request) => {
    mutationMethods.push(request.method());
    csrfHeaders.push(request.headers()["x-csrf-token"] ?? "");
    origins.push(request.headers().origin ?? "");
  };
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: envelope({ ...account, default_period: savedPeriod }) }));
  await page.route("**/api/v1/account/favorites**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: envelope(favorites) });
    if (route.request().method() === "DELETE") { recordMutation(route.request()); favorites = []; return route.fulfill({ json: envelope(null) }); }
    return route.fulfill({ json: envelope(favorites) });
  });
  await page.route("**/api/v1/account/preferences", async (route) => {
    recordMutation(route.request());
    savedPeriod = (route.request().postDataJSON() as { default_period: string }).default_period;
    return route.fulfill({ json: envelope({ default_period: savedPeriod }) });
  });
  await page.route("**/api/v1/auth/logout", (route) => { recordMutation(route.request()); return route.fulfill({ json: envelope(null) }); });
  await page.goto("/account/favorites");
  await expect(page.getByText("Rival")).toBeVisible();
  await page.getByLabel("Период по умолчанию").selectOption("90");
  await expect.poll(() => savedPeriod).toBe("90");
  await page.getByRole("button", { name: "Убрать" }).click();
  await expect(page.getByText("Сохранённых профилей пока нет.")).toBeVisible();
  await page.getByRole("navigation", { name: "Основная навигация" }).getByText("Alex").click();
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("main").getByRole("link", { name: "Войти через Steam" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Сохранённых профилей пока нет.")).toHaveCount(0);
  expect(mutationMethods).toEqual(["PATCH", "DELETE", "POST"]);
  expect(csrfHeaders).toEqual(["csrf-test", "csrf-test", "csrf-test"]);
  expect(origins).toEqual([new URL(page.url()).origin, new URL(page.url()).origin, new URL(page.url()).origin]);
});

test("mutation failures stay visible and keep account state unchanged", async ({ page }) => {
  const favorite = { account_id: "1234567890", personaname: "Rival", avatar_url: null };
  const failure = (message: string) => ({ status: 503, json: { error: { code: "temporarily_unavailable", message } } });
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: envelope(account) }));
  await page.route("**/api/v1/account/favorites**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: envelope([favorite]) });
    return route.fulfill(failure("Favorite removal failed"));
  });
  await page.route("**/api/v1/account/preferences", (route) => route.fulfill(failure("Preference save failed")));
  await page.route("**/api/v1/auth/logout", (route) => route.fulfill(failure("Logout failed")));

  await page.goto("/account/favorites");
  const period = page.getByLabel("Период по умолчанию");
  await period.selectOption("90");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Preference save failed");
  await expect(period).toHaveValue("30");

  await page.getByRole("button", { name: "Убрать" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Favorite removal failed");
  await expect(page.getByText("Rival")).toBeVisible();

  await page.getByRole("navigation", { name: "Основная навигация" }).getByText("Alex").click();
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByRole("alert")).toHaveText("Logout failed");
  await expect(page.getByRole("navigation", { name: "Основная навигация" }).getByText("Alex")).toBeVisible();
  await expect(page.getByText("Rival")).toBeVisible();
});
test("homepage shows stale community data and refuses unsafe news links", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: envelope(null) }));
  await page.route("**/api/v1/community/online", (route) => route.fulfill({ json: envelope({ player_count: 4321 }, { stale: true }) }));
  await page.route("**/api/v1/community/news", (route) => route.fulfill({ json: envelope([{ gid: "1", title: "Patch", url: "javascript:alert(1)", date: "2026-10-27T11:00:00Z", excerpt: "Plain excerpt" }]) }));
  await page.goto("/");
  await expect(page.getByText("Последнее известное значение · устарело")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Patch" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Patch/ })).toHaveCount(0);
  await expect(page.getByText("Plain excerpt")).toBeVisible();
});