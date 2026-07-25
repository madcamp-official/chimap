import { expect, test } from "@playwright/test";

test("KAIST에서 대전역까지 건강 경로를 비교하고 선택을 저장한다", async ({
  page,
}) => {
  await page.goto("/");

  const intro = page.getByRole("dialog", { name: "CHIMap 시작 화면" });
  await expect(intro).toBeVisible();
  await expect(page.getByText("LOAD HEALTHY ROUTE")).toBeVisible();
  await page.getByRole("button", { name: "인트로 건너뛰기" }).click();
  await expect(intro).toBeHidden();

  await expect(page.getByText("데모 데이터")).toBeVisible();
  await expect(page.getByText("현재는 데모 경로를 보여드려요.")).toBeVisible();

  const origin = page.getByRole("combobox", { name: "출발지" });
  await origin.fill("KAIST");
  await page
    .getByRole("option", { name: /한국과학기술원 KAIST/u })
    .click();

  const destination = page.getByRole("combobox", { name: "목적지" });
  await destination.fill("대전역");
  await page.getByRole("option", { name: /대전역/u }).click();

  await page.getByLabel("현재 걸음 수").fill("5200");
  await page.getByLabel("하루 목표").fill("8000");
  await page.getByLabel("최대 추가 허용시간 숫자").fill("25");

  await page.getByRole("button", { name: "건강 경로 찾기" }).click();

  const fast = page.getByRole("button", {
    name: /빠른 경로, 예상 도착/u,
  });
  const balanced = page.getByRole("button", {
    name: /균형 경로, 예상 도착/u,
  });
  const goal = page.getByRole("button", {
    name: /목표 달성 경로, 예상 도착/u,
  });
  await expect(fast).toBeVisible();
  await expect(balanced).toBeVisible();
  await expect(goal).toBeVisible();
  await expect(
    page.getByText("네이버 지도 키 없이 경로선 미리보기로 표시 중"),
  ).toBeVisible();

  await balanced.click();
  await expect(balanced).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "균형 경로" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("chimap:last-trip")),
    )
    .toContain("BALANCED");
  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("chimap:preferences")),
    )
    .toContain('"maxExtraMinutes":25');

  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "CHIMap 시작 화면" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "출발지" })).toHaveValue(
    "한국과학기술원 KAIST",
  );
  await expect(page.getByRole("combobox", { name: "목적지" })).toHaveValue(
    "대전역",
  );
  await expect(page.getByLabel("하루 목표")).toHaveValue("8000");
  await expect(page.getByLabel("최대 추가 허용시간 숫자")).toHaveValue("25");

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
  }
});
