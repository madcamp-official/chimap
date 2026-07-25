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
const cliConfig = {
  ...config,
  database: {
    ...config.database,
    poolMax: Math.min(config.database.poolMax, 2),
  },
};
const transit = new TransitService({ config: cliConfig, logger });
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
  await transit.initialize();
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
    case "sync-area": {
      const coordinate = {
        lat: coordinateArgument("lat"),
        lng: coordinateArgument("lng"),
      };
      const radiusMeters = Number(
        argument("radiusMeters") ??
          config.transit.maxNearbyStopDistanceMeters,
      );
      const maxRoutes = Number(argument("maxRoutes") ?? 40);
      const concurrency = Math.min(
        Math.max(Number(argument("concurrency") ?? 2), 1),
        4,
      );
      if (
        !Number.isInteger(radiusMeters) ||
        radiusMeters < 1 ||
        radiusMeters > config.transit.maxNearbyStopDistanceMeters
      ) {
        throw new Error("--radiusMeters 범위를 확인해 주세요.");
      }
      if (!Number.isInteger(maxRoutes) || maxRoutes < 1 || maxRoutes > 200) {
        throw new Error("--maxRoutes 범위를 확인해 주세요.");
      }
      const nearby = await transit.getNearbyStops(
        coordinate,
        radiusMeters,
      );
      const routes = new Map<
        string,
        { cityCode: string; routeId: string }
      >();
      for (const stop of nearby.items) {
        if (stop.cityCode === null || stop.nodeId === null) {
          continue;
        }
        const response = await transit.getRoutesByStop(
          stop.cityCode,
          stop.nodeId,
        );
        for (const route of response.items) {
          routes.set(`${route.cityCode}:${route.routeId}`, {
            cityCode: route.cityCode,
            routeId: route.routeId,
          });
        }
      }
      const selected = [...routes.values()].slice(0, maxRoutes);
      let nextIndex = 0;
      let synced = 0;
      let failed = 0;
      const failureCodes = new Set<string>();
      const workers = Array.from(
        { length: Math.min(concurrency, selected.length) },
        async () => {
          while (nextIndex < selected.length) {
            const route = selected[nextIndex];
            nextIndex += 1;
            if (route !== undefined) {
              try {
                await transit.syncRoute(route.cityCode, route.routeId);
                synced += 1;
              } catch (error) {
                failed += 1;
                failureCodes.add(
                  error instanceof TagoApiError
                    ? error.resultCode
                    : "UNEXPECTED_ERROR",
                );
              }
            }
          }
        },
      );
      await Promise.all(workers);
      printJson({
        coordinate,
        radiusMeters,
        nearbyStopCount: nearby.items.length,
        discoveredRouteCount: routes.size,
        syncedRouteCount: synced,
        failedRouteCount: failed,
        failureCodes: [...failureCodes],
      });
      if (selected.length > 0 && synced === 0) {
        throw new Error("선택한 TAGO 노선을 하나도 동기화하지 못했습니다.");
      }
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
        rejectedRows: result.rejectedRows,
        headers: result.headers,
      });
      break;
    }
    case "stats":
      printJson(await transit.repository.stats());
      break;
    default:
      throw new Error(
        "명령은 health, nearby, arrivals, route-stops, vehicles, sync-route, sync-area, import-stops, stats 중 하나여야 합니다.",
      );
  }
}

try {
  await run();
} finally {
  await transit.close();
}
