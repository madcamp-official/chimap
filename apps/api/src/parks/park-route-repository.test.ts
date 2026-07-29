import { describe, expect, it, vi } from "vitest";

import { ParkRouteRepository } from "./park-route-repository.js";

describe("ParkRouteRepository direction view", () => {
  it("BOTH만 좌표와 path waypoint를 역순으로 추가한다", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          dataset_id: "dataset",
          route_id: "route",
          official_park_id: "park",
          park_name: "공원",
          direction_policy: "BOTH",
          entry_lng: 127.3,
          entry_lat: 36.3,
          exit_lng: 127.4,
          exit_lat: 36.4,
          coordinates: {
            coordinates: [
              [127.3, 36.3],
              [127.4, 36.4],
            ],
          },
          path_waypoint_ids: ["A", "B"],
          distance_meters: 100,
          duration_seconds: 80,
        },
      ],
    });
    const repository = new ParkRouteRepository({ query } as never);
    const result = await repository.findNearSegment({
      start: { lng: 127.3, lat: 36.3 },
      end: { lng: 127.4, lat: 36.4 },
      radiusMeters: 800,
      limit: 3,
    });
    expect(result).toHaveLength(2);
    expect(result[0]?.reversed).toBe(false);
    expect(result[1]).toMatchObject({
      reversed: true,
      entry: { lng: 127.4, lat: 36.4 },
      exit: { lng: 127.3, lat: 36.3 },
      pathWaypointIds: ["B", "A"],
      coordinates: [
        { lng: 127.4, lat: 36.4 },
        { lng: 127.3, lat: 36.3 },
      ],
    });
  });
});
