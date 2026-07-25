import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distPath = fileURLToPath(new URL("../dist", import.meta.url));
if (!distPath.endsWith("/apps/api/dist")) {
  throw new Error("API dist 정리 경로를 확인하지 못했습니다.");
}
rmSync(distPath, { recursive: true, force: true });
