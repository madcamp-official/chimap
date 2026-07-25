import { expect, test } from "@playwright/test";

function kstDateTimeLocal(hoursFromNow: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(Date.now() + hoursFromNow * 60 * 60 * 1000))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

test("KAIST에서 대전역까지 건강 경로를 비교하고 선택을 저장한다", async ({
  page,
}) => {
  await page.goto("/");

  const intro = page.getByRole("dialog", { name: "CHIMap 시작 화면" });
  await expect(intro).toBeVisible();
  await expect(page.getByText("LOAD HEALTHY ROUTE")).toBeVisible();
  await page.getByRole("button", { name: "인트로 건너뛰기" }).click();
  await expect(intro).toBeHidden();

  const origin = page.getByRole("combobox", { name: "출발지" });
  await origin.fill("대전 유성구 대학로 291");
  await page.getByRole("button", { name: "출발지 검색" }).click();
  await page
    .getByRole("option", { name: /^한국과학기술원/u })
    .click();

  const destination = page.getByRole("combobox", { name: "목적지" });
  await destination.fill("대전역");
  await page.getByRole("button", { name: "목적지 검색" }).click();
  await page
    .getByRole("option", { name: /^대전역 대전 동구 중앙로/u })
    .click();

  await page.getByLabel("현재 걸음 수").fill("5200");
  await page.getByLabel("하루 목표").fill("8000");
  await page.getByLabel("도착 마감시간").fill(kstDateTimeLocal(3));
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
  const mapStatus = page.locator(".map-region .sr-only[role='status']");
  if (process.env.E2E_REQUIRE_NAVER_MAP === "1") {
    await expect(mapStatus).toHaveText(
      "네이버 지도가 준비됐어요. 경로 계산에는 KAKAO 도보와 TAGO 버스를 사용합니다.",
    );
  } else {
    await expect(mapStatus).toContainText("네이버 지도");
  }
  await expect(
    page.getByLabel("지도와 경로 데이터 제공자"),
  ).toContainText(
    /NAVER\s*지도\s*\+\s*KAKAO\s*검색\/도보\s*\+\s*TAGO\s*버스/u,
  );

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
    "한국과학기술원",
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
