import { expect, test } from "@playwright/test";

test("헤더 요약과 왼쪽 검색 폼이 주요 화면 폭에서 겹치지 않는다", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const currentStepsDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    window.sessionStorage.setItem("chimap:intro-seen-v1", "1");
    window.localStorage.setItem(
      "chimap:preferences",
      JSON.stringify({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate,
      }),
    );
    window.localStorage.setItem(
      "chimap:ui-experience-v1",
      JSON.stringify({
        version: 1,
        successfulRecommendationCount: 0,
        densityPreference: "auto",
        motionPreference: "reduced",
        telemetryConsent: "denied",
      }),
    );
  });

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("form", { name: "출발지와 목적지 검색" }),
    ).toBeVisible();
    await expect(page.getByLabel("현재 걸음")).toHaveValue("5200");
    await expect(page.locator(".map-provider-chip")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);

    const brand = await page.locator(".brand").boundingBox();
    const summary = await page.locator(".header-step-summary").boundingBox();
    const status = await page.locator(".header-status").boundingBox();
    expect(brand).not.toBeNull();
    expect(summary).not.toBeNull();
    expect(status).not.toBeNull();
    if (brand === null || summary === null || status === null) {
      continue;
    }

    if (width >= 768) {
      expect(brand.x + brand.width).toBeLessThanOrEqual(summary.x);
      expect(summary.x + summary.width).toBeLessThanOrEqual(status.x);
    } else {
      expect(summary.y).toBeGreaterThanOrEqual(brand.y + brand.height);
      expect(summary.y).toBeGreaterThanOrEqual(status.y + status.height);
    }
  }
});
