import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { loadConfig, type TagoServiceKind } from "../config.js";
import { createLogger } from "../logger.js";
import { KakaoMobilityProvider } from "../providers/kakao-provider.js";
import { RouteGeometryService } from "../providers/route-geometry.js";
import {
  buildBusGeometryWarmPlan,
  busGeometryWarmPairsPerChunk,
  chunkBusGeometryWarmStops,
  parseBusGeometryAlgorithm,
  parseBusGeometryWarmConcurrency,
} from "./bus-geometry-warm-options.js";
import { buildBusSubwayTransferEdges } from "../transit/bus-subway-transfer-builder.js";
import { importBusStopsFile } from "../transit/csv-importer.js";
import { importSubwayStationsFile } from "../transit/subway-csv-importer.js";
import { importSubwayProviderMapFile } from "../transit/subway-provider-map-importer.js";
import {
  importSubwaySegmentShapesDirectory,
  parseSubwaySegmentShapesDirectory,
} from "../transit/subway-segment-shape-importer.js";
import { importSubwayTopologyDirectory } from "../transit/subway-topology-importer.js";
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

function optionalIntegerArgument(name: string): number | undefined {
  const raw = argument(name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`--${name}은 정수여야 합니다.`);
  }
  return value;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function inputPath(value: string): string {
  return isAbsolute(value)
    ? value
    : resolve(process.env.INIT_CWD ?? process.cwd(), value);
}

const syncAreaSchema = z
  .object({
    id: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(100),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radiusMeters: z.number().int().min(50).max(2000).default(500),
    maxRoutes: z.number().int().min(1).max(200).default(40),
  })
  .strict();

const syncAreasFileSchema = z
  .object({
    areas: z.array(syncAreaSchema).min(1).max(20),
  })
  .strict();

type SyncArea = z.infer<typeof syncAreaSchema>;

function safeFailureCode(error: unknown): string {
  if (error instanceof TagoApiError) {
    return error.resultCode;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9]{2,10}$/u.test(error.code)
  ) {
    return `DATABASE_${error.code}`;
  }
  return "UNEXPECTED_ERROR";
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

async function syncArea(area: SyncArea, concurrency: number) {
  const nearby = await transit.getNearbyStops(
    { lat: area.lat, lng: area.lng },
    area.radiusMeters,
  );
  const routes = new Map<
    string,
    { cityCode: string; routeId: string }
  >();
  const failureCodes = new Set<string>();
  let failedStopRouteLookupCount = 0;
  for (const stop of nearby.items) {
    if (stop.cityCode === null || stop.nodeId === null) {
      continue;
    }
    let response;
    try {
      response = await transit.getRoutesByStop(
        stop.cityCode,
        stop.nodeId,
      );
    } catch (error) {
      if (!(error instanceof TagoApiError)) {
        throw error;
      }
      failedStopRouteLookupCount += 1;
      failureCodes.add(safeFailureCode(error));
      continue;
    }
    for (const route of response.items) {
      routes.set(`${route.cityCode}:${route.routeId}`, {
        cityCode: route.cityCode,
        routeId: route.routeId,
      });
    }
  }
  const selected = [...routes.values()].slice(0, area.maxRoutes);
  let nextIndex = 0;
  let synced = 0;
  let failed = 0;
  const failedRoutes: Array<{
    cityCode: string;
    routeId: string;
    code: string;
  }> = [];
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
            const code = safeFailureCode(error);
            failureCodes.add(code);
            failedRoutes.push({ ...route, code });
          }
        }
      }
    },
  );
  await Promise.all(workers);
  if (selected.length === 0) {
    failed = 1;
    failureCodes.add("NO_ROUTES_DISCOVERED");
  }
  return {
    id: area.id,
    name: area.name,
    coordinate: { lat: area.lat, lng: area.lng },
    radiusMeters: area.radiusMeters,
    nearbyStopCount: nearby.items.length,
    discoveredRouteCount: routes.size,
    selectedRouteCount: selected.length,
    syncedRouteCount: synced,
    failedStopRouteLookupCount,
    failedRouteCount: failed,
    failureCodes: [...failureCodes],
    failedRoutes,
  };
}

async function writeSyncStatus(
  path: string,
  status: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function run(): Promise<void> {
  if (command === "validate-subway-segment-shapes") {
    const directoryValue =
      argument("directory") ?? config.subwayTopologyDataDir;
    const directory =
      directoryValue === undefined ? undefined : inputPath(directoryValue);
    if (directory === undefined) {
      throw new Error(
        "SUBWAY_TOPOLOGY_DATA_DIR 또는 --directory를 설정해 주세요.",
      );
    }
    const result = await parseSubwaySegmentShapesDirectory(directory);
    printJson({ directory, ...result.report });
    return;
  }
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
    case "warm-bus-geometry": {
      const cityCode = argument("cityCode") ?? config.tagoDefaultCityCode;
      const routeId = requiredArgument("routeId");
      const algorithmVersion = parseBusGeometryAlgorithm(argument("algorithm"));
      const fromNodeOrder = optionalIntegerArgument("fromNodeOrder");
      const toNodeOrder = optionalIntegerArgument("toNodeOrder");
      const concurrency = parseBusGeometryWarmConcurrency(
        argument("concurrency"),
      );
      const routeStops = await transit.getRouteStops(cityCode, routeId);
      const plan = buildBusGeometryWarmPlan(routeStops, {
        algorithmVersion,
        ...(fromNodeOrder === undefined ? {} : { fromNodeOrder }),
        ...(toNodeOrder === undefined ? {} : { toNodeOrder }),
        maxApiCalls: Number(argument("maxApiCalls") ?? 5),
      });
      const chunks = algorithmVersion === "transit-v2"
        ? [plan.stops]
        : chunkBusGeometryWarmStops(
            plan.stops,
            busGeometryWarmPairsPerChunk(concurrency),
          );
      const forceRefresh = process.argv.includes("--force");
      if (process.argv.includes("--dryRun")) {
        printJson({
          cityCode,
          routeId,
          algorithmVersion,
          routeStopCount: routeStops.length,
          selectedStopCount: plan.stops.length,
          fromNodeOrder: plan.stops[0]!.nodeOrder,
          toNodeOrder: plan.stops.at(-1)!.nodeOrder,
          estimatedApiCalls: plan.estimatedApiCalls,
          maxApiCalls: plan.maxApiCalls,
          chunkCount: chunks.length,
          concurrency,
          forceRefresh,
          dryRun: true,
        });
        break;
      }
      if (config.kakaoRestApiKey === undefined) {
        throw new Error("KAKAO_REST_API_KEY를 설정해 주세요.");
      }
      const service = new RouteGeometryService({
        provider: new KakaoMobilityProvider(config.kakaoRestApiKey),
        repository: transit.repository,
        algorithmVersion,
      });
      const results = new Array<Awaited<ReturnType<
        RouteGeometryService["resolveBusGeometry"]
      >>>(chunks.length);
      let nextChunk = 0;
      const workers = Array.from(
        { length: Math.min(concurrency, chunks.length) },
        async () => {
          while (nextChunk < chunks.length) {
            const chunkIndex = nextChunk;
            nextChunk += 1;
            results[chunkIndex] = await service.resolveBusGeometry({
              stops: chunks[chunkIndex]!,
              forceRefresh,
            });
          }
        },
      );
      await Promise.all(workers);
      const detailed = results.every((result) => result.quality === "DETAILED");
      printJson({
        cityCode,
        routeId,
        algorithmVersion,
        routeStopCount: routeStops.length,
        selectedStopCount: plan.stops.length,
        fromNodeOrder: plan.stops[0]!.nodeOrder,
        toNodeOrder: plan.stops.at(-1)!.nodeOrder,
        estimatedApiCalls: plan.estimatedApiCalls,
        maxApiCalls: plan.maxApiCalls,
        chunkCount: chunks.length,
        concurrency,
        forceRefresh,
        quality: detailed ? "DETAILED" : "APPROXIMATE",
        chunks: results.map((result, index) => ({
          index,
          fromNodeOrder: chunks[index]![0]!.nodeOrder,
          toNodeOrder: chunks[index]!.at(-1)!.nodeOrder,
          quality: result.quality,
          reason: result.reason,
          vertexCount: result.coordinates.length,
        })),
      });
      if (!detailed) {
        throw new Error("버스 형상 warm-up이 일부 구간에서 실패했습니다.");
      }
      break;
    }
    case "sync-area": {
      const area = syncAreaSchema.parse({
        id: "single-area",
        name: "single-area",
        lat: coordinateArgument("lat"),
        lng: coordinateArgument("lng"),
        radiusMeters: Number(
        argument("radiusMeters") ??
          config.transit.maxNearbyStopDistanceMeters,
        ),
        maxRoutes: Number(argument("maxRoutes") ?? 40),
      });
      const concurrency = Math.min(
        Math.max(Number(argument("concurrency") ?? 2), 1),
        4,
      );
      const result = await syncArea(area, concurrency);
      printJson(result);
      if (
        result.failureCodes.length > 0 ||
        (result.selectedRouteCount > 0 && result.syncedRouteCount === 0)
      ) {
        throw new Error("TAGO 영역 동기화가 부분 실패했습니다.");
      }
      break;
    }
    case "sync-areas": {
      const path = requiredArgument("path");
      const statusPath = requiredArgument("statusPath");
      const concurrency = Math.min(
        Math.max(Number(argument("concurrency") ?? 2), 1),
        4,
      );
      const input = syncAreasFileSchema.parse(
        JSON.parse(await readFile(path, "utf8")),
      );
      let previousLastSuccessAt: string | null = null;
      try {
        const previous = JSON.parse(await readFile(statusPath, "utf8")) as {
          lastSuccessAt?: unknown;
        };
        previousLastSuccessAt =
          typeof previous.lastSuccessAt === "string"
            ? previous.lastSuccessAt
            : null;
      } catch {
        previousLastSuccessAt = null;
      }

      const attemptedAt = new Date().toISOString();
      const results = [];
      for (const area of input.areas) {
        try {
          results.push(await syncArea(area, concurrency));
        } catch (error) {
          results.push({
            id: area.id,
            name: area.name,
            coordinate: { lat: area.lat, lng: area.lng },
            radiusMeters: area.radiusMeters,
            nearbyStopCount: 0,
            discoveredRouteCount: 0,
            selectedRouteCount: 0,
            syncedRouteCount: 0,
            failedStopRouteLookupCount: 0,
            failedRouteCount: 1,
            failureCodes: [safeFailureCode(error)],
            failedRoutes: [],
          });
        }
      }
      const syncedRouteCount = results.reduce(
        (total, result) => total + result.syncedRouteCount,
        0,
      );
      const failedRouteCount = results.reduce(
        (total, result) => total + result.failedRouteCount,
        0,
      );
      const failedStopRouteLookupCount = results.reduce(
        (total, result) => total + result.failedStopRouteLookupCount,
        0,
      );
      const success =
        syncedRouteCount > 0 &&
        failedRouteCount === 0 &&
        failedStopRouteLookupCount === 0;
      const status = {
        attemptedAt,
        success,
        lastSuccessAt: success ? new Date().toISOString() : previousLastSuccessAt,
        areaCount: results.length,
        syncedRouteCount,
        failedStopRouteLookupCount,
        failedRouteCount,
        failureCodes: [
          ...new Set(results.flatMap((result) => result.failureCodes)),
        ],
        failedRoutes: results.flatMap((result) => result.failedRoutes),
        transit: await transit.repository.stats(),
        areas: results,
      };
      await writeSyncStatus(statusPath, status);
      printJson(status);
      if (!success) {
        throw new Error(
          "교통 데이터 정기 동기화가 완전히 성공하지 못했습니다.",
        );
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
    case "import-subway-stations": {
      const path = argument("path") ?? config.subwayStationsDataPath;
      if (path === undefined) {
        throw new Error(
          "SUBWAY_STATIONS_DATA_PATH 또는 --path를 설정해 주세요.",
        );
      }
      const result = await importSubwayStationsFile(
        path,
        transit.repository,
      );
      printJson({
        path,
        sourceRows: result.sourceRowCount,
        imported: result.rows.length,
        duplicateRows: result.duplicateRows,
      });
      break;
    }
    case "import-subway-topology": {
      const directory =
        argument("directory") ?? config.subwayTopologyDataDir;
      if (directory === undefined) {
        throw new Error(
          "SUBWAY_TOPOLOGY_DATA_DIR 또는 --directory를 설정해 주세요.",
        );
      }
      const result = await importSubwayTopologyDirectory(
        directory,
        transit.repository,
      );
      printJson({
        directory,
        serviceLines: result.serviceLines.length,
        routeReadyLines: result.serviceLines.filter(
          (line) => line.isRouteReady,
        ).length,
        lineStations: result.lineStations.length,
        segments: result.segments.length,
        headways: result.headways.length,
        transfers: result.transfers.length,
      });
      break;
    }
    case "import-subway-segment-shapes": {
      const directoryValue =
        argument("directory") ?? config.subwayTopologyDataDir;
      const directory =
        directoryValue === undefined ? undefined : inputPath(directoryValue);
      if (directory === undefined) {
        throw new Error(
          "SUBWAY_TOPOLOGY_DATA_DIR 또는 --directory를 설정해 주세요.",
        );
      }
      const report = await importSubwaySegmentShapesDirectory(
        directory,
        transit.repository,
      );
      printJson({ directory, ...report });
      break;
    }
    case "import-subway-provider-map": {
      const path =
        argument("path") ??
        (config.subwayTopologyDataDir === undefined
          ? undefined
          : join(
              config.subwayTopologyDataDir,
              "subway_provider_station_map_template.csv",
            ));
      if (path === undefined) {
        throw new Error(
          "SUBWAY_TOPOLOGY_DATA_DIR 또는 --path를 설정해 주세요.",
        );
      }
      const rows = await importSubwayProviderMapFile(
        path,
        transit.repository,
      );
      printJson({ path, sourceRows: rows.length });
      break;
    }
    case "build-bus-subway-transfers": {
      if (config.kakaoRestApiKey === undefined) {
        throw new Error("KAKAO_REST_API_KEY를 설정해 주세요.");
      }
      const concurrency = Math.min(
        Math.max(Number(argument("concurrency") ?? 2), 1),
        4,
      );
      const limit = Math.min(
        Math.max(Number(argument("limit") ?? 20_000), 1),
        20_000,
      );
      const result = await buildBusSubwayTransferEdges({
        repository: transit.repository,
        walkingProvider: new KakaoMobilityProvider(config.kakaoRestApiKey),
        concurrency,
        limit,
      });
      printJson(result);
      if (result.failed > 0) {
        throw new Error("일부 버스-지하철 환승 간선 생성에 실패했습니다.");
      }
      break;
    }
    case "sync-subway-stations": {
      const concurrency = Math.min(
        Math.max(Number(argument("concurrency") ?? 4), 1),
        4,
      );
      printJson(await transit.syncSubwayStationMappings(concurrency));
      break;
    }
    case "subway-departures": {
      printJson(
        await transit.getSubwayDepartures({
          stationId: requiredArgument("stationId"),
          direction:
            argument("direction") === "D" ? "D" : "U",
          at: new Date(argument("at") ?? Date.now()),
          limit: Math.min(
            Math.max(Number(argument("limit") ?? 3), 1),
            100,
          ),
        }),
      );
      break;
    }
    case "stats":
      printJson(await transit.repository.stats());
      break;
    default:
      throw new Error(
        "명령은 health, nearby, arrivals, route-stops, vehicles, sync-route, warm-bus-geometry, sync-area, sync-areas, import-stops, import-subway-stations, import-subway-topology, validate-subway-segment-shapes, import-subway-segment-shapes, sync-subway-stations, subway-departures, stats 중 하나여야 합니다.",
      );
  }
}

try {
  await run();
} finally {
  await transit.close();
}
