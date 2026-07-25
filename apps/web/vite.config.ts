import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  envDir: "../..",
  ...(mode === "e2e"
    ? {
        define: {
          "import.meta.env.VITE_NAVER_MAP_NCP_KEY_ID": JSON.stringify(""),
        },
      }
    : {}),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: "jsdom",
    env: {
      VITE_API_BASE_URL: "http://localhost:8080",
      VITE_NAVER_MAP_NCP_KEY_ID: "",
    },
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
  },
}));
