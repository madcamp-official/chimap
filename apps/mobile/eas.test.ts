import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

type EasConfig = {
  cli: { appVersionSource?: string };
  build: Record<string, unknown>;
  submit: Record<string, unknown>;
};

const eas = JSON.parse(
  readFileSync(fileURLToPath(new URL("./eas.json", import.meta.url)), "utf8"),
) as EasConfig;

describe("EAS Android release interface", () => {
  it("remote version source와 세 build profile만 노출한다", () => {
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(Object.keys(eas.build)).toEqual([
      "development",
      "staging-device",
      "play-internal",
    ]);
    expect(eas.build).toMatchObject({
      development: {
        developmentClient: true,
        distribution: "internal",
        environment: "development",
        env: { APP_ENV: "development" },
        android: { buildType: "apk" },
      },
      "staging-device": {
        distribution: "internal",
        environment: "preview",
        env: { APP_ENV: "staging" },
        android: { buildType: "apk" },
      },
      "play-internal": {
        distribution: "store",
        autoIncrement: true,
        environment: "production",
        env: { APP_ENV: "production" },
        android: { buildType: "app-bundle" },
      },
    });
  });

  it("internal draft submit만 허용하고 production track은 노출하지 않는다", () => {
    expect(Object.keys(eas.submit)).toEqual(["play-internal"]);
    expect(eas.submit["play-internal"]).toEqual({
      android: { track: "internal", releaseStatus: "draft" },
    });
    expect(JSON.stringify(eas)).not.toContain('"track":"production"');
  });
});
