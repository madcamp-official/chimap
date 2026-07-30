import { haversineDistanceMeters } from "@chimap/contracts";

import { ValhallaClient } from "../providers/valhalla/valhalla-client.js";

function optionalValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredValue(name: string): string {
  const found = optionalValue(name);
  if (found === undefined) throw new Error(`${name}이 필요합니다.`);
  return found;
}

function coordinate(text: string) {
  const parts = text.split(",");
  if (parts.length !== 2) throw new Error("좌표 형식은 lng,lat입니다.");
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    Math.abs(lng) > 180 ||
    Math.abs(lat) > 90
  ) {
    throw new Error("좌표 형식은 WGS84 lng,lat입니다.");
  }
  return { lng, lat };
}

const timeoutMs = Number(optionalValue("--timeout-ms") ?? "3500");
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  throw new Error("--timeout-ms는 양의 정수여야 합니다.");
}
const origin = coordinate(requiredValue("--from"));
const destination = coordinate(requiredValue("--to"));
const startedAt = performance.now();
const route = await new ValhallaClient({
  baseUrl: requiredValue("--base-url"),
  timeoutMs,
  retryCount: 0,
}).route({ origin, destination });

process.stdout.write(`${JSON.stringify({
  success: true,
  durationMilliseconds: Math.round(performance.now() - startedAt),
  distanceMeters: route.distanceMeters,
  durationSeconds: route.durationSeconds,
  coordinateCount: route.coordinates.length,
  startSnapDistanceMeters: Math.round(
    haversineDistanceMeters(origin, route.coordinates[0]!),
  ),
  endSnapDistanceMeters: Math.round(
    haversineDistanceMeters(destination, route.coordinates.at(-1)!),
  ),
}, null, 2)}\n`);
