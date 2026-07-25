import { fileURLToPath } from "node:url";

import { loadConfig, type TagoServiceKind } from "../config.js";
import { createLogger } from "../logger.js";
import { importBusStopsFile } from "../transit/csv-importer.js";
import { TagoApiError } from "../transit/tago-client.js";
import { TransitService } from "../transit/transit-service.js";

try {
  process.loadEnvFile(
    fileURLToPath(new URL("../../../../.env", import.meta.url)),
  );
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code !== "ENOENT") {
    throw error;
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function requiredArgument(name: string): string {
  const value = argument(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} 값을 입력해 주세요.`);
  }
  return value;
}

function coordinateArgument(name: "lat" | "lng"): number {
  const value = Number(requiredArgument(name));
  if (!Number.isFinite(value)) {
    throw new Error(`--${name}은 숫자여야 합니다.`);
  }
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

const config = loadConfig();
const logger = createLogger({ ...config, logLevel: "silent" });
const transit = new TransitService({ config, logger });
const command = process.argv[2];

async function health(): Promise<void> {
  const services: TagoServiceKind[] = [
    "stop",
    "route",
    "arrival",
    "location",
  ];
  const results = [];
  for (const service of services) {
    const startedAt = performance.now();
    if (!transit.hasServiceKey(service)) {
      results.push({
        service,
        keyPresent: false,
        success: false,
        resultCode: "CONFIGURATION_ERROR",
        durationMs: 0,
        itemCount: 0,
      });
      continue;
    }
    try {
      const items = await transit.getCityCodes(service);
      results.push({
        service,
        keyPresent: true,
        success: true,
        resultCode: "00",
        durationMs: Math.round(performance.now() - startedAt),
        itemCount: items.length,
      });
    } catch (error) {
      results.push({
        service,
        keyPresent: true,
        success: false,
        resultCode:
          error instanceof TagoApiError
            ? error.resultCode
            : "UNEXPECTED_ERROR",
        durationMs: Math.round(performance.now() - startedAt),
        itemCount: 0,
      });
    }
  }
  printJson({ baseUrl: config.tagoBaseUrl, services: results });
}

async function run(): Promise<void> {
  switch (command) {
    case "health":
      await health();
      break;
    case "nearby": {
      const result = await transit.getNearbyStops({
        lat: coordinateArgument("lat"),
        lng: coordinateArgument("lng"),
      });
      printJson(result);
      break;
    }
    case "arrivals": {
      const items = await transit.getArrivals(
        argument("cityCode") ?? config.tagoDefaultCityCode,
        requiredArgument("nodeId"),
      );
      printJson({ items });
      break;
    }
    case "route-stops": {
      const items = await transit.getRouteStops(
        argument("cityCode") ?? config.tagoDefaultCityCode,
        requiredArgument("routeId"),
      );
      printJson({ items });
      break;
    }
    case "vehicles": {
      const items = await transit.getVehiclePositions(
        argument("cityCode") ?? config.tagoDefaultCityCode,
        requiredArgument("routeId"),
      );
      printJson({ items });
      break;
    }
    case "sync-route": {
      const result = await transit.syncRoute(
        argument("cityCode") ?? config.tagoDefaultCityCode,
        requiredArgument("routeId"),
      );
      printJson({
        route: result.route,
        stopCount: result.stops.length,
      });
      break;
    }
    case "import-stops": {
      const path = argument("path") ?? config.busStopsDataPath;
      if (path === undefined) {
        throw new Error(
          "BUS_STOPS_DATA_PATH 또는 --path를 설정해 주세요.",
        );
      }
      const result = await importBusStopsFile(
        path,
        transit.repository,
      );
      printJson({
        path,
        encoding: result.encoding,
        imported: result.imported,
        headers: result.headers,
      });
      break;
    }
    case "stats":
      printJson(transit.repository.stats());
      break;
    default:
      throw new Error(
        "명령은 health, nearby, arrivals, route-stops, vehicles, sync-route, import-stops, stats 중 하나여야 합니다.",
      );
  }
}

try {
  await run();
} finally {
  transit.repository.close();
}
