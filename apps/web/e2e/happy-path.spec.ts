import {
  placeSearchResponseSchema,
  recommendationResponseSchema,
} from "@chimap/contracts";
import { expect, test } from "@playwright/test";

test("KAIST에서 대전역까지 건강 경로를 비교하고 선택을 저장한다", async ({
  page,
}) => {
  test.setTimeout(90_000);
  let vehicleResponseCount = 0;
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/transit/bus/routes/") &&
        response.url().includes("/vehicles?")) {
      vehicleResponseCount += 1;
    }
  });
  await page.addInitScript(() => {
    if (window.name !== "chimap-e2e-initialized") {
      window.sessionStorage.clear();
      window.localStorage.clear();
      window.name = "chimap-e2e-initialized";
    }
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const intro = page.getByRole("dialog", { name: "CHIMap 시작 화면" });
  const skipIntro = page.getByRole("button", { name: "인트로 건너뛰기" });
  if (await skipIntro.isVisible().catch(() => false)) {
    await skipIntro.click({ force: true }).catch(() => undefined);
  }
  await expect(intro).toBeHidden();
  const walkingProfile = page.getByRole("dialog", {
    name: "내 건강 경로 설정",
  });
  await expect(walkingProfile).toBeVisible();
  await page.getByLabel("만 나이").fill("26");
  await page.getByLabel("신장").fill("170");
  await page.getByLabel("체중").fill("65");
  await page.getByLabel("하루 목표 걸음").fill("8000");
  await page.getByLabel("여성").check();
  await page.getByRole("button", { name: "이 값으로 시작" }).click();
  await expect(walkingProfile).toBeHidden();

  const origin = page.getByRole("combobox", { name: "출발지" });
  await origin.fill("대전 유성구 대학로 291");
  await page.getByRole("button", { name: "출발지 검색" }).click();
  await page
    .getByRole("option", { name: /^KAIST 본원/u })
    .click();

  const destination = page.getByRole("combobox", { name: "도착지" });
  await destination.fill("대전역");
  await page.getByRole("button", { name: "도착지 검색" }).click();
  await page
    .getByRole("option", { name: /^대전역 대전 동구 중앙로/u })
    .click();

  await page.getByLabel("현재 걸음").fill("5200");
  await page.getByLabel("현재 걸음").press("Enter");

  const recommendationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/v1/recommendations"),
  );
  await page.getByRole("button", { name: "건강 경로 찾기" }).click();
  const recommendationPayload = recommendationResponseSchema.parse(
    await (await recommendationResponsePromise).json(),
  );
  const balancedRecommendation = recommendationPayload.recommendations.find(
    (recommendation) => recommendation.type === "BALANCED",
  );
  const goalRecommendation = recommendationPayload.recommendations.find(
    (recommendation) => recommendation.type === "GOAL",
  );
  expect(goalRecommendation).toBeDefined();
  const transitRecommendation = [
    balancedRecommendation,
    goalRecommendation,
  ].find((recommendation) =>
    recommendation?.legs.some((leg) => leg.mode === "BUS"),
  );
  if (transitRecommendation === undefined) {
    throw new Error("버스 상세를 검증할 BALANCED 또는 GOAL 경로가 없습니다.");
  }
  const transitRecommendationTitle =
    transitRecommendation.type === "BALANCED"
      ? "2배 걸음 경로"
      : "목표 근접 경로";

  const fast = page.getByRole("button", {
    name: /빠른 경로, 예상 도착/u,
  });
  const goal = page.getByRole("button", {
    name: /목표 근접 경로, 예상 도착/u,
  });
  await expect(fast).toBeVisible();
  await expect(goal).toBeVisible();
  await expect(page.getByText("목표에 가까움", { exact: true }))
    .toBeVisible();
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
  await expect(page.locator(".data-sources-footer")).toContainText(
    "데이터 제공: NAVER 지도 · KAKAO 장소/도보 · 국토교통부 TAGO 버스·지하철",
  );
  await expect(
    page.getByRole("heading", { name: "역과 다음 출발 시간" }),
  ).toBeVisible();
  await expect(
    page.locator(".recommendation-list ~ .nearby-subway-panel"),
  ).toHaveCount(1);
  await expect(
    page.getByText("TAGO 시간표 기반 예상", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("실시간 지연 미반영")).toBeVisible();
  await expect(page.locator(".subway-endpoint-card")).toHaveCount(2);
  await expect(page.locator(".map-provider-chip")).toHaveCount(0);

  // FAST는 지하철 단독일 수 있고, 유효 고유 후보가 두 개면 BALANCED가
  // GOAL로 승격될 수 있으므로 존재하는 비-FAST 버스 경로를 사용한다.
  const transitRecommendationButton = page.getByRole("button", {
    name: new RegExp(`${transitRecommendationTitle}, 예상 도착`, "u"),
  });
  await transitRecommendationButton.click();
  await expect(transitRecommendationButton).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toHaveCount(0);
  const transitRecommendationDetails = page.getByRole("button", {
    name: `${transitRecommendationTitle} 자세히`,
  });
  await transitRecommendationDetails.click();
  await expect(
    page.getByRole("button", {
      name: `${transitRecommendationTitle} 상세 접기`,
    }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("heading", { name: transitRecommendationTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toBeVisible();

  const busLegs = page.locator(".bus-leg-meta");
  await expect.poll(() => busLegs.count()).toBeGreaterThan(0);
  if (process.env.E2E_REQUIRE_NAVER_MAP === "1") {
    await expect(page.locator(".map-marker-origin")).toHaveCount(1);
    await expect(page.locator(".map-marker-transfer")).toHaveCount(
      transitRecommendation.transferCount,
    );
    await expect(page.locator(".map-marker-destination")).toHaveCount(1);
    await expect(page.locator(".map-marker-boarding")).toHaveCount(0);
    await expect(page.locator(".map-marker-alighting")).toHaveCount(0);
    await expect(page.locator(".map-marker-stop")).toHaveCount(0);
  } else {
    const preview = page.locator(".route-preview-svg");
    await expect(preview.locator("[data-marker-role='origin']")).toHaveCount(1);
    await expect(preview.locator("[data-marker-role='transfer']")).toHaveCount(
      transitRecommendation.transferCount,
    );
    await expect(preview.locator("[data-marker-role='destination']")).toHaveCount(1);
  }
  await expect.poll(() => vehicleResponseCount).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const vehicleMarkers = page.locator(".map-marker-vehicle");
  for (const marker of await vehicleMarkers.all()) {
    await expect(marker.locator(".map-marker-vehicle-body")).toHaveCount(1);
    const heading = Number(await marker.getAttribute("data-heading"));
    expect(Number.isFinite(heading)).toBe(true);
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
    await expect(marker.locator(".map-marker-vehicle-number")).toHaveCSS(
      "color",
      "rgb(255, 255, 255)",
    );
    await expect(marker.locator(".map-marker-vehicle-number")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(marker).toHaveAttribute(
      "title",
      /분 후 도착|이동 구간 운행 중/u,
    );
  }
  if (process.env.E2E_REQUIRE_NAVER_MAP === "1") {
    const naverMap = page.locator(".naver-map");
    const cameraFitCount = await naverMap.getAttribute(
      "data-camera-fit-count",
    );
    await naverMap.hover();
    await page.mouse.wheel(0, -600);
    const responsesBeforeWaiting = vehicleResponseCount;
    // One completed refresh proves that live polling does not reset a user's
    // camera. Requiring two responses makes the assertion depend on TAGO
    // latency as well as the 10-second client interval.
    await expect
      .poll(() => vehicleResponseCount, { timeout: 25_000 })
      .toBeGreaterThanOrEqual(responsesBeforeWaiting + 1);
    await expect(naverMap).toHaveAttribute(
      "data-camera-fit-count",
      cameraFitCount ?? "1",
    );
  }

  await page.getByRole("button", {
    name: `${transitRecommendationTitle} 간략히 보기`,
  }).click();
  await expect(
    page.getByRole("list", { name: "텍스트 이동 단계" }),
  ).toHaveCount(0);

  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("chimap:preferences")),
    )
    .toContain('"version":3');
  await expect
    .poll(async () =>
      page.evaluate(() => localStorage.getItem("chimap:last-trip")),
    )
    .toBeNull();

  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "CHIMap 시작 화면" }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "출발지" })).toHaveValue(
    "KAIST 본원",
  );
  await expect(page.getByRole("combobox", { name: "도착지" })).toHaveValue(
    "대전역",
  );
  await expect(page.getByLabel("현재 걸음")).toHaveValue("5200");
  await expect(page.locator('[aria-label="오늘의 걸음 요약"]')).toContainText(
    "8,000걸음",
  );

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
      walkingMetric: {
        stepLengthMeters: 0.69,
        source: "RESEARCH_ESTIMATE",
        modelVersion: "HAN_2026_V1",
      },
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
      note.includes("요청 범위 멀티모달 그래프"),
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
