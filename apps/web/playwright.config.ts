import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "PORT=8080 WEB_ORIGIN=http://127.0.0.1:5173 LOG_LEVEL=silent pnpm --dir ../api dev:mock",
      url: "http://127.0.0.1:8080/api/v1/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command:
        "VITE_API_BASE_URL=http://127.0.0.1:8080 VITE_APP_MODE=demo pnpm dev --mode e2e --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
