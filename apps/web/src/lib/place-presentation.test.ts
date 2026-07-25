import type { Place } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { placeKindLabel } from "./place-presentation.js";

const basePlace: Place = {
  id: "kakao:place:26964230",
  name: "KAIST 본원",
  address: "대전 유성구 구성동 23",
  roadAddress: "대전 유성구 대학로 291",
  category: "교육,학문 > 학교 > 대학교",
  location: { lng: 127.36129293525407, lat: 36.37053284796117 },
};

describe("장소 검색 결과 좌표 성격", () => {
  it("학교 POI는 캠퍼스 중심으로 표시한다", () => {
    expect(placeKindLabel(basePlace)).toBe("캠퍼스 중심");
  });

  it("주소 결과와 출입구 결과를 구분한다", () => {
    expect(
      placeKindLabel({
        ...basePlace,
        id: "kakao:address:kaist",
        name: "한국과학기술원",
        category: "주소",
      }),
    ).toBe("도로명 주소");
    expect(
      placeKindLabel({
        ...basePlace,
        id: "kakao:place:kaist-north-gate",
        name: "한국과학기술원 북문",
      }),
    ).toBe("출입구");
  });
});
