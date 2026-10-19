import { expect, test } from "@playwright/test";

const now = "2026-10-19T12:00:00Z";
const heroes = [
  { hero_id: "84", name: "Король крыс", class_name: "hero_ratking", client_version: null },
  { hero_id: "65", name: "Венатор", class_name: "hero_priest", client_version: null },
  { hero_id: "13", name: "Хейз", class_name: "hero_haze", client_version: null },
  { hero_id: "__proto__", name: "Неизвестный герой", class_name: "hero_unlisted", client_version: null },
  { hero_id: "constructor", name: "Новый герой", class_name: "hero_unreleased", client_version: null },
];

const envelope = <T>(data: T) => ({
  data,
  meta: {
    source: "controlled-test-api",
    updated_at: now,
    sample_size: 3,
    coverage: "unknown",
    stale: false,
    next_cursor: null,
  },
});

test("hero analytics and detail show verified English names beneath Russian names", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/v1/heroes/stats") {
      return route.fulfill({
        json: envelope(heroes.map((hero) => ({
          ...hero,
          matches: 100,
          wins: 50,
          losses: 50,
          win_rate: 0.5,
          kda: 3,
          kda_sample_size: 100,
        }))),
      });
    }
    if (pathname === "/api/v1/heroes/84") {
      return route.fulfill({
        json: envelope({ ...heroes[0], stats: null }),
      });
    }
    throw new Error(`Unmocked API request in browser test: ${route.request().method()} ${pathname}`);
  });

  await page.goto("/heroes");
  const board = page.locator(".hero-table");
  await expect(board).toContainText("Король крыс");
  await expect(board).toContainText("Rat King");
  await expect(board).toContainText("Venator");
  await expect(board).toContainText("Haze");
  await expect(board.locator("tbody tr").filter({ hasText: "Неизвестный герой" }).locator("small")).toHaveText("Герой");
  await expect(board.locator("tbody tr").filter({ hasText: "Новый герой" }).locator("small")).toHaveText("Герой");
  await expect(board).not.toContainText(/hero_/);

  await page.getByRole("link", { name: /Король крыс/ }).click();
  await expect(page.getByRole("heading", { name: "Король крыс" })).toBeVisible();
  await expect(page.locator(".hero-detail-heading .eyebrow")).toHaveText("Rat King");
  await expect(page.locator(".hero-detail-page")).not.toContainText(/hero_/);
});
