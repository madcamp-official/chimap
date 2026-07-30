import { readFile, writeFile } from "node:fs/promises";
import { parkRouteSnapshotSchema } from "@chimap/contracts";

import { calculateParkRouteDatasetChecksum } from "../parks/park-route-import-service.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function validate(file: string, writeChecksum: boolean): Promise<void> {
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  const declared = raw.datasetChecksum;
  const { datasetChecksum: _removed, ...withoutChecksum } = raw;
  const checksum = calculateParkRouteDatasetChecksum(withoutChecksum as never);
  if (writeChecksum) {
    raw.datasetChecksum = checksum;
    await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`);
  } else if (declared !== checksum) {
    throw new Error(`datasetChecksum 불일치: expected ${checksum}`);
  }
  const snapshot = parkRouteSnapshotSchema.parse(raw);
  const expected = Number(argument("--expected-count") ?? "152");
  if (snapshot.routes.length !== expected) {
    throw new Error(`route count ${snapshot.routes.length}, expected ${expected}`);
  }
  for (const route of snapshot.routes) {
    const serialized = JSON.stringify(route).toLowerCase();
    if (serialized.includes("placeholder") || serialized.includes("fallback")) {
      throw new Error(`${route.routeId}: placeholder/fallback은 배포할 수 없습니다.`);
    }
  }
  process.stdout.write(`${JSON.stringify({
    valid: true,
    datasetId: snapshot.datasetId,
    routeCount: snapshot.routes.length,
    datasetChecksum: checksum,
  }, null, 2)}\n`);
}

async function send(file: string): Promise<void> {
  await validate(file, false);
  if (process.argv.includes("--dry-run")) return;
  const url = argument("--url");
  const token = process.env.PARK_ROUTE_IMPORT_TOKEN;
  if (url === undefined || token === undefined) {
    throw new Error("--url과 PARK_ROUTE_IMPORT_TOKEN이 필요합니다.");
  }
  const body = await readFile(file, "utf8");
  const snapshot = parkRouteSnapshotSchema.parse(JSON.parse(body));
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": snapshot.datasetId,
    },
    body,
    signal: AbortSignal.timeout(Number(argument("--timeout-ms") ?? "15000")),
  });
  const responseBody = await response.text();
  process.stdout.write(`${JSON.stringify({
    status: response.status,
    ok: response.ok,
    response: responseBody.slice(0, 10_000),
  }, null, 2)}\n`);
  if (!response.ok) process.exitCode = 2;
}

const command = process.argv[2];
const file = argument("--file") ?? process.argv[3];
if (file === undefined) throw new Error("snapshot --file이 필요합니다.");
if (command === "validate") {
  await validate(file, process.argv.includes("--write-checksum"));
} else if (command === "send") {
  await send(file);
} else {
  throw new Error("명령은 validate 또는 send여야 합니다.");
}
