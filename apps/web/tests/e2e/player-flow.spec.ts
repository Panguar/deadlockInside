import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const accountId = "1234567890";
const matchId = "9223372036854775000";
const instant = "2026-10-18T12:00:00Z";

const envelope = <T>(data: T, sampleSize = 1, nextCursor: string | null = null) => ({
  data,
  meta: {
    source: "controlled-test-api",
    updated_at: instant,
    sample_size: sampleSize,
    coverage: "unknown",
    stale: false,
    next_cursor: nextCursor,
  },
});

const profile = (rankBadge: number | null = 18) =>
  envelope({
    account_id: accountId,
    personaname: "Alex",
    avatar_url: "https://avatars.steamstatic.com/alex.jpg",
    rank_badge: rankBadge,
    profile_updated_at: instant,
  });

const history = (heroId = "7", nextCursor: string | null = null) =>
  envelope(
    [
      {
        match_id: matchId,
        started_at: instant,
        duration_s: 1800,
        hero_id: heroId,
        kills: 10,
        deaths: 2,
        assists: 8,
        net_worth: 22000,
        player_damage: 32000,
        player_match_outcome: 1,
        status: "complete",
      },
    ],
    1,
    nextCursor,
  );

const match = envelope({
  match_id: matchId,
  started_at: instant,
  duration_s: 1800,
  game_mode: 1,
  match_mode: 1,
  winning_team: 0,
  status: "complete",
  players: [
    {
      account_id: accountId,
      personaname: "Alex",
      hero_id: "7",
      hero_name: "Abrams",
      team: 0,
      kills: 10,
      deaths: 2,
      assists: 8,
      net_worth: 22000,
      player_damage: 32000,
      player_match_outcome: 1,
      items: [{ item_id: "18446744073709551000" }],
    },
    {
      account_id: "76561198000000001",
      personaname: "Rival",
      hero_id: "4",
      hero_name: "Dynamo",
      team: 1,
      kills: 2,
      deaths: 9,
      assists: 3,
      net_worth: 12000,
      player_damage: 18000,
      player_match_outcome: 2,
      items: [],
    },
  ],
});

async function mockProfileFlow(
  page: Page,
  options: {
    empty?: boolean;
    rank?: number | null;
    matchData?: typeof match;
    slowHeroId?: string;
    failedRefresh?: boolean;
    missingProfile?: boolean;
    refreshSucceeds?: boolean;
    analyticsPendingCalls?: number;
    coldMatch?: boolean;
    hasNextCursor?: boolean;
    slowCursor?: boolean;
    slowJobResponseMs?: number;
  } = {},
) {
  let profileReads = 0;
  let jobReads = 0;
  let analyticsReads = 0;
  let refreshStarted = false;
  let matchReads = 0;
  const analyticsQueries: string[] = [];
  (page as Page & { analyticsQueries?: string[] }).analyticsQueries = analyticsQueries;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    const response = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (path === "/api/v1/auth/me") return response(envelope(null));
    if (path === "/api/v1/community/online") return response(envelope({ player_count: 1234 }));
    if (path === "/api/v1/community/news") return response(envelope([]));
    if (path === "/api/v1/players/search") {
      return response(envelope([
        { account_id: accountId, personaname: "Alex", avatar_url: null },
        { account_id: "987654321", personaname: "Alex", avatar_url: null },
      ], 2));
    }
    if (path === "/api/v1/heroes") {
      return response(envelope([
        { hero_id: "7", name: "Abrams", class_name: "Боец", client_version: null },
        { hero_id: "4", name: "Dynamo", class_name: "Поддержка", client_version: null },
      ], 2));
    }
    if (path === "/api/v1/heroes/stats") {
      analyticsReads += 1;
      analyticsQueries.push(url.search);
      (page as Page & { analyticsQueries?: string[] }).analyticsQueries = analyticsQueries;
      if (analyticsReads <= (options.analyticsPendingCalls ?? 0)) {
        return response({ error: { code: "analytics_snapshot_unavailable", message: "queued", request_id: "test" } }, 503);
      }
      return response(envelope([{
        hero_id: "7",
        name: "Abrams",
        class_name: "Боец",
        matches: 1200,
        wins: 618,
        losses: 582,
        win_rate: 0.515,
        kda: 3.2,
        kda_sample_size: 1160,
      }], 1200));
    }
    if (path === "/api/v1/heroes/7") {
      return response(envelope({ hero_id: "7", name: "Abrams", class_name: "Боец", client_version: null, stats: null }));
    }
    if (path === `/api/v1/players/${accountId}/refresh` && method === "POST") {
      refreshStarted = true;
      return response(envelope({ job_id: "11111111-1111-4111-8111-111111111111" }), 202);
    }
    if (path === "/api/v1/refresh-jobs/11111111-1111-4111-8111-111111111111") {
      jobReads += 1;
      (page as Page & { jobReads?: number }).jobReads = jobReads;
      if (options.slowJobResponseMs) await new Promise((resolve) => setTimeout(resolve, options.slowJobResponseMs));
      return response(envelope({
        job_id: "11111111-1111-4111-8111-111111111111",
        status: options.coldMatch || (options.refreshSucceeds && jobReads > 1) ? "succeeded" : options.failedRefresh ? "failed" : "running",
        attempts: 1,
        created_at: instant,
        updated_at: instant,
        error_code: options.failedRefresh ? "provider_unavailable" : null,
      }));
    }
    if (path === `/api/v1/players/${accountId}`) {
      profileReads += 1;
      return (options.failedRefresh || (options.missingProfile && !refreshStarted))
        ? response({ error: { code: "player_not_found", message: "not found", request_id: "test" } }, 404)
        : response(profile(options.rank === undefined ? 18 : options.rank));
    }
    if (path === `/api/v1/players/${accountId}/stats`) {
      return response(envelope({
        sample_size: options.empty ? 0 : 1,
        decided_matches: options.empty ? 0 : 1,
        wins: options.empty ? 0 : 1,
        win_rate: options.empty ? null : 1,
        kda: options.empty ? null : 9,
        kda_sample_size: options.empty ? 0 : 1,
        heroes: [],
      }, options.empty ? 0 : 1));
    }
    if (path === `/api/v1/players/${accountId}/matches`) {
      const heroId = url.searchParams.get("hero_id") ?? "7";
      const cursor = url.searchParams.get("cursor");
      if (cursor && options.slowCursor) {
        await new Promise<void>((resolve) => {
          (page as Page & { releaseCursorResponse?: () => void }).releaseCursorResponse = resolve;
        });
      }
      if (heroId === options.slowHeroId) {
        await new Promise<void>((resolve) => {
          (page as Page & { releaseSlowResponse?: () => void }).releaseSlowResponse = resolve;
        });
      }
      return response(options.empty ? envelope([], 0) : history(cursor ? "7" : heroId, options.hasNextCursor && !cursor ? "cursor-old" : null));
    }
    if (path === `/api/v1/matches/${matchId}` && options.matchData) {
      matchReads += 1;
      if (options.coldMatch && matchReads === 1) {
        return response(envelope({ job_id: "11111111-1111-4111-8111-111111111111" }), 202);
      }
      return response(options.matchData);
    }
    throw new Error(`Unmocked API request in browser test: ${method} ${url.pathname}${url.search}`);
  });
}

test("keyboard search disambiguates same-name players and opens a match", async ({ page }) => {
  await mockProfileFlow(page, { matchData: match, coldMatch: true });
  await page.route("https://avatars.steamstatic.com/alex.jpg", (route) => route.fulfill({ status: 404 }));
  await page.route("https://assets-bucket.deadlock-api.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWioAAAAASUVORK5CYII=", "base64") }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator(".brand img")).toHaveAttribute("src", "/deadlock-insight.png");
  await page.getByRole("heading", { name: /Каждый матч/ }).waitFor();
  const screenshotDir = resolve(process.cwd(), "../../.superpowers/screenshots");
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, "desktop-home.png"), fullPage: true });
  const search = page.getByRole("combobox", { name: "Поиск игрока" });
  await search.fill("Alex");
  await expect(page.getByRole("option")).toHaveCount(2);
  await search.press("ArrowDown");
  await search.press("Enter");

  await expect(page).toHaveURL(new RegExp(`/players/${accountId}`));
  await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible();
  await expect(page.getByText("Ранг 18")).toBeVisible();
  await expect(page.getByText("Источник может содержать не все матчи")).toBeVisible();
  await expect(page.getByRole("button", { name: "Обновить профиль" })).toBeVisible();
  await expect(page.locator(".player-avatar img")).toHaveCount(0);
  await expect(page.locator(".player-avatar")).toContainText("A");
  await expect(page.locator(".match-hero .hero-sigil")).toHaveAttribute("src", /assets-bucket\.deadlock-api\.com/);
  await page.screenshot({ path: resolve(screenshotDir, "desktop-profile.png"), fullPage: true });

  await page.getByLabel("Герой").selectOption("7");
  await expect(page).toHaveURL(/hero_id=7/);
  await expect(page.getByRole("link", { name: /Матч 9223372036854775000/ })).toBeVisible();
  await page.getByRole("link", { name: /Матч 9223372036854775000/ }).click();
  await page.waitForURL(new RegExp(`/matches/${matchId}`));
  await expect(page.getByRole("heading", { name: /Матч 9223372036854775000/ })).toBeVisible();
  await expect(page.getByText("18446744073709551000")).toBeVisible();
  await expect(page.getByText("Dynamo")).toBeVisible();
  await expect(page.locator(".player-table .hero-portrait").first()).toHaveAttribute("src", /assets-bucket\.deadlock-api\.com/);
});

test("empty history and unknown rank stay explicitly empty and nullable", async ({ page }) => {
  await mockProfileFlow(page, { empty: true, rank: null });
  await page.goto(`/players/${accountId}`);
  await expect(page.getByText("Ранг не определён")).toBeVisible();
  await expect(page.getByText("Матчей пока нет")).toBeVisible();
  await expect(page.getByText("—").first()).toBeVisible();
});

test("failed profile refresh reports failure without inventing a profile", async ({ page }) => {
  await mockProfileFlow(page, { failedRefresh: true });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Обновить профиль" }).click();
  await expect(page.getByText("Не удалось обновить профиль. Попробуйте ещё раз.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
});

test("successful refresh rereads the stored profile after its job completes", async ({ page }) => {
  await mockProfileFlow(page, { missingProfile: true, refreshSucceeds: true });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Обновить профиль" }).click();
  await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Ранг 18")).toBeVisible();
});

test("profile refresh polling stops when the profile page unmounts", async ({ page }) => {
  await mockProfileFlow(page, { missingProfile: true });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Обновить профиль" }).click();
  await expect.poll(() => (page as Page & { jobReads?: number }).jobReads ?? 0).toBeGreaterThan(0);
  await page.goto("/");
  const pollsAfterNavigation = (page as Page & { jobReads?: number }).jobReads ?? 0;
  await page.waitForTimeout(1700);
  expect((page as Page & { jobReads?: number }).jobReads ?? 0).toBe(pollsAfterNavigation);
});

test("profile refresh stops after its bounded polling window", async ({ page }) => {
  await mockProfileFlow(page, { missingProfile: true });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Обновить профиль" }).click();
  await expect(page.getByRole("status")).toContainText("Обновление занимает больше времени", { timeout: 25_000 });
  const pollsAtTimeout = (page as Page & { jobReads?: number }).jobReads ?? 0;
  expect(pollsAtTimeout).toBeGreaterThan(0);
  expect(pollsAtTimeout).toBeLessThanOrEqual(12);
  await page.waitForTimeout(1700);
  expect((page as Page & { jobReads?: number }).jobReads ?? 0).toBe(pollsAtTimeout);
});

test("a slow response for an old hero filter cannot replace the selected filter", async ({ page }) => {
  await mockProfileFlow(page, { slowHeroId: "4" });
  await page.goto(`/players/${accountId}`);
  await expect(page.getByLabel("Герой")).toBeVisible();
  await page.getByLabel("Герой").selectOption("4");
  await expect.poll(() => Boolean((page as Page & { releaseSlowResponse?: () => void }).releaseSlowResponse)).toBe(true);
  await page.getByLabel("Герой").selectOption("7");
  await expect(page.getByRole("link", { name: /Победа.*Abrams/ })).toBeVisible();
  (page as Page & { releaseSlowResponse?: () => void }).releaseSlowResponse?.();
  await expect(page.getByRole("link", { name: /Dynamo/ })).toHaveCount(0);
  await expect(page).toHaveURL(/hero_id=7/);
});

test("mobile profile layout has no horizontal overflow", async ({ page }) => {
  await mockProfileFlow(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/players/${accountId}`);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  const screenshotDir = resolve(process.cwd(), "../../.superpowers/screenshots");
  await mkdir(screenshotDir, { recursive: true });
  await page.screenshot({ path: resolve(screenshotDir, "mobile-profile.png"), fullPage: true });
});

test("hero analytics treats a queued snapshot as pending and keeps filters in the URL", async ({ page }) => {
  await mockProfileFlow(page, { analyticsPendingCalls: 3 });
  await page.goto("/heroes");
  await expect(page.getByRole("status")).toContainText("Снимок аналитики готовится");
  await page.getByLabel("С даты").fill("2026-10-01");
  await page.getByLabel("По дату").fill("2026-10-07");
  await page.getByLabel("Средний ранг матча от").fill("100");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page).toHaveURL(/from=2026-10-01/);
  await expect(page).toHaveURL(/min_average_badge=100/);
  await expect(page.getByRole("cell", { name: "Abrams" })).toBeVisible();
});

test("global analytics sends applied filters and carries them into hero detail", async ({ page }) => {
  await mockProfileFlow(page);
  await page.goto("/heroes");
  await expect(page.getByRole("cell", { name: "Abrams" })).toBeVisible();
  await page.getByLabel("С даты").fill("2026-10-01");
  await page.getByLabel("По дату").fill("2026-10-10");
  await page.getByLabel("Средний ранг матча от").fill("12");
  await page.getByLabel("Средний ранг матча до").fill("34");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByRole("cell", { name: "Abrams" })).toBeVisible();
  const analyticsQueries = (page as Page & { analyticsQueries?: string[] }).analyticsQueries ?? [];
  expect(analyticsQueries).toContain("?from=2026-10-01T00%3A00%3A00Z&to=2026-10-11T00%3A00%3A00.000Z&min_average_badge=12&max_average_badge=34");
  await page.getByRole("link", { name: /Abrams/ }).click();
  await expect(page).toHaveURL(/from=2026-10-01/);
  await expect(page).toHaveURL(/max_average_badge=34/);
});

test("hero detail preserves filter context and polls queued analytics", async ({ page }) => {
  await mockProfileFlow(page, { analyticsPendingCalls: 2 });
  await page.goto("/heroes/7?from=2026-10-01&to=2026-10-10&min_average_badge=12&max_average_badge=34");
  await expect(page.getByRole("status")).toContainText("Снимок аналитики готовится");
  await expect(page.getByRole("heading", { name: "Abrams" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Все герои/ })).toHaveAttribute("href", "/heroes?from=2026-10-01&to=2026-10-10&min_average_badge=12&max_average_badge=34");
  const analyticsQueries = (page as Page & { analyticsQueries?: string[] }).analyticsQueries ?? [];
  expect(analyticsQueries).toContain("?from=2026-10-01T00%3A00%3A00Z&to=2026-10-11T00%3A00%3A00.000Z&min_average_badge=12&max_average_badge=34");
});

test("malformed URL dates show a controlled filter error", async ({ page }) => {
  await mockProfileFlow(page);
  await page.goto(`/players/${accountId}?to=not-a-date`);
  await expect(page.locator(".error-copy")).toContainText("некорректную дату");
  await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible();
  await page.goto("/heroes?from=2026-02-31&to=2026-03-01");
  await expect(page.locator(".error-copy")).toContainText("некорректную дату");
  await expect(page.getByRole("heading", { name: "Аналитика героев" })).toBeVisible();
});

test("a delayed load-more page cannot append to a newly selected hero filter", async ({ page }) => {
  await mockProfileFlow(page, { hasNextCursor: true, slowCursor: true });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Загрузить ещё матчи" }).click();
  await expect.poll(() => Boolean((page as Page & { releaseCursorResponse?: () => void }).releaseCursorResponse)).toBe(true);
  await page.getByLabel("Герой").selectOption("4");
  await expect(page.getByRole("link", { name: /Победа.*Dynamo/ })).toBeVisible();
  (page as Page & { releaseCursorResponse?: () => void }).releaseCursorResponse?.();
  await expect(page.getByRole("link", { name: /Abrams/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Dynamo/ })).toHaveCount(1);
});

test("refresh polling uses an elapsed deadline and leaves the job running", async ({ page }) => {
  await mockProfileFlow(page, { missingProfile: true, slowJobResponseMs: 20_000 });
  await page.goto(`/players/${accountId}`);
  await page.getByRole("button", { name: "Обновить профиль" }).click();
  await expect(page.getByRole("status")).toContainText("продолжается в фоне", { timeout: 21_000 });
  expect((page as Page & { jobReads?: number }).jobReads ?? 0).toBe(1);
});
