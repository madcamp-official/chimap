import { haversineDistanceMeters } from "@chimap/contracts";
import { ValhallaClient } from "../providers/valhalla/valhalla-client.js";

function value(name: string): string {
  const index = process.argv.indexOf(name);
  const found = index < 0 ? undefined : process.argv[index + 1];
  if (found === undefined) throw new Error(`${name}이 필요합니다.`);
  return found;
}
function coordinate(text: string) {
  const [lng, lat] = text.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("좌표 형식은 lng,lat입니다.");
  return { lng: lng!, lat: lat! };
}
const origin = coordinate(value("--from"));
const destination = coordinate(value("--to"));
const started = performance.now();
const route = await new ValhallaClient({
  baseUrl: value("--base-url"),
  timeoutMs: Number(value("--timeout-ms")),
  retryCount: 0,
}).route({ origin, destination });
process.stdout.write(JSON.stringify({
  success: true,
  durationMilliseconds: Math.round(performance.now() - started),
  distanceMeters: route.distanceMeters,
  durationSeconds: route.durationSeconds,
  coordinateCount: route.coordinates.length,
  startSnapDistanceMeters: Math.round(haversineDistanceMeters(origin, route.coordinates[0]!)),
  endSnapDistanceMeters: Math.round(haversineDistanceMeters(destination, route.coordinates.at(-1)!)),
}, null, 2) + "\n");
