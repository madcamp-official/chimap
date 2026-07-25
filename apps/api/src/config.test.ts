import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("환경변수 보안 경계", () => {
  it("NAVER 서버 Client Secret을 브라우저 공개 변수로 사용할 수 없다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        NAVER_MAP_NCP_KEY_ID: "public-client-id",
        NAVER_MAP_NCP_KEY: "server-client-secret",
        VITE_NAVER_MAP_NCP_KEY_ID: "server-client-secret",
      }),
    ).toThrow(/브라우저 공개 NAVER Key ID/u);
  });
});
