import {
  placeSearchResponseSchema,
  recommendationResponseSchema,
} from "@chimap/contracts";
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
  let vehicleResponseCount = 0;
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/transit/bus/routes/") &&
        response.url().includes("/vehicles?")) {
      vehicleResponseCount += 1;
    }
  });
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
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toHaveCount(0);
  const fastDetails = page.getByRole("button", {
    name: "빠른 경로 자세히",
  });
  await expect(fastDetails).toHaveAttribute("aria-expanded", "false");
  await fastDetails.click();
  await expect(
    page.getByRole("button", { name: "빠른 경로 상세 접기" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("heading", { name: "빠른 경로" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toBeVisible();
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
  const busLegs = page.locator(".bus-leg-meta");
  await expect.poll(() => busLegs.count()).toBeGreaterThan(0);
  const selectedBusLegCount = await busLegs.count();
  if (process.env.E2E_REQUIRE_NAVER_MAP === "1") {
    await expect(page.locator(".map-marker-boarding")).toHaveCount(1);
    await expect(page.locator(".map-marker-transfer")).toHaveCount(
      Math.max(0, selectedBusLegCount - 1),
    );
    await expect(page.locator(".map-marker-alighting")).toHaveCount(1);
    await expect(page.locator(".map-marker-stop")).toHaveCount(0);
  }
  await expect.poll(() => vehicleResponseCount).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const vehicleMarkers = page.locator(".map-marker-vehicle");
  expect(await vehicleMarkers.count()).toBeLessThanOrEqual(
    await busLegs.count(),
  );
  for (const marker of await vehicleMarkers.all()) {
    await expect(marker).not.toContainText(/^버스/u);
    await expect(marker).toHaveAttribute("title", /탑승 예정 차량.*정류장 전/u);
  }

  await balanced.click();
  await expect(balanced).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toHaveCount(0);
  const balancedDetails = page.getByRole("button", {
    name: "균형 경로 자세히",
  });
  await balancedDetails.click();
  await expect(
    page.getByRole("button", { name: "균형 경로 상세 접기" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("heading", { name: "균형 경로" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "균형 경로 간략히 보기" }).click();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toHaveCount(0);

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

test("KAIST 본원 중심 좌표에서도 운행 정류장을 확장 탐색한다", async ({
  request,
}) => {
  const originResponse = await request.get(
    "/api/v1/places?query=%ED%95%9C%EA%B5%AD%EA%B3%BC%ED%95%99%EA%B8%B0%EC%88%A0%EC%9B%90&scope=resolve&limit=8",
  );
  const destinationResponse = await request.get(
    "/api/v1/places?query=%EA%B3%A0%EC%9D%B4%EB%B9%84%ED%86%A0%20%EB%8C%80%EC%A0%84%EA%B0%A4%EB%9F%AC%EB%A6%AC%EC%95%84%EC%A0%90&scope=resolve&limit=8",
  );
  expect(originResponse.ok()).toBe(true);
  expect(destinationResponse.ok()).toBe(true);

  const originSearch = placeSearchResponseSchema.parse(
    await originResponse.json(),
  );
  const destinationSearch = placeSearchResponseSchema.parse(
    await destinationResponse.json(),
  );
  const origin = originSearch.items.find(
    (place) => place.id === "kakao:place:26964230",
  );
  const destination = destinationSearch.items.find(
    (place) => place.id === "kakao:place:1079245597",
  );
  expect(origin).toBeDefined();
  expect(destination).toBeDefined();

  const response = await request.post("/api/v1/recommendations", {
    data: {
      origin,
      destination,
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      currentSteps: 0,
      goalSteps: 8000,
      maxExtraMinutes: 90,
      strideLengthMeters: 0.7,
      safetyBufferMinutes: 3,
    },
  });
  expect(response.ok()).toBe(true);

  const result = recommendationResponseSchema.parse(await response.json());
  expect(result.recommendations.length).toBeGreaterThan(0);
  const fast = result.recommendations.find(
    (recommendation) => recommendation.type === "FAST",
  );
  expect(fast).toBeDefined();
  const fastBusLegs = fast?.legs.filter((leg) => leg.mode === "BUS") ?? [];
  expect(fastBusLegs.length).toBeGreaterThan(0);
  for (const leg of fastBusLegs) {
    expect(leg.bus).toBeDefined();
    expect(leg.coordinates.length).toBeGreaterThan(
      leg.bus?.stops.length ?? 0,
    );
    const stopCoordinates = new Set(
      leg.bus?.stops.map(
        (stop) => `${stop.longitude.toFixed(7)}:${stop.latitude.toFixed(7)}`,
      ),
    );
    expect(
      leg.coordinates.some(
        (coordinate) =>
          !stopCoordinates.has(
            `${coordinate.lng.toFixed(7)}:${coordinate.lat.toFixed(7)}`,
          ),
      ),
    ).toBe(true);
  }
  expect(
    fast?.estimationNotes?.some((note) =>
      note.includes("Kakao 자동차 도로 경로에 매칭"),
    ),
  ).toBe(true);
  const firstBusIndex =
    fast?.legs.findIndex((leg) => leg.mode === "BUS") ?? -1;
  const boardingWalkMeters =
    fast?.legs
      .slice(0, firstBusIndex)
      .reduce((total, leg) => total + leg.distanceMeters, 0) ?? 0;
  expect(boardingWalkMeters).toBeGreaterThan(500);
});
