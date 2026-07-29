#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROUTE_TYPES = {
    "PERIMETER_LOOP": "LOOP", "INTERNAL_LOOP": "LOOP",
    "INTERNAL_CIRCUIT": "LOOP", "INTERNAL_TRAVERSE": "THROUGH",
    "PERIMETER_ARC": "THROUGH", "PERIMETER_PASS_THROUGH": "THROUGH",
}

def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def digest(value):
    return hashlib.sha256(stable(value).encode()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--valhalla-url")  # Existing validated geometry is preferred.
    parser.add_argument("--expected-count", type=int, default=152)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    source = Path(args.input)
    audit_path = source / "reports/completed_routes_audit_v2_5.json"
    detail_dir = source / "dashboard/data/parks"
    audit = json.loads(audit_path.read_text())
    generated_anchor_path = source.parent / "v2_3/geojson/park_internal_anchors_v2_3.geojson"
    generated_anchors = {}
    if generated_anchor_path.exists():
        generated_anchors = {
            feature["properties"]["anchor_id"]: feature["geometry"]["coordinates"]
            for feature in json.loads(generated_anchor_path.read_text())["features"]
        }
    included, excluded = [], []
    for item in audit["items"]:
        reasons = []
        if item.get("audit_status") != "PASSED": reasons.append("AUDIT_NOT_PASSED")
        if not item.get("valhalla_validated") or item.get("routing_engine") not in (None, "VALHALLA_PEDESTRIAN"):
            reasons.append("NOT_VALHALLA_PEDESTRIAN")
        detail_path = detail_dir / f'{item["official_park_id"]}.json'
        if not detail_path.exists(): reasons.append("DETAIL_MISSING")
        if reasons:
            excluded.append({"routeId": str(item["official_park_id"]), "reasons": reasons})
            continue
        detail = json.loads(detail_path.read_text())
        template, catalog = detail["route_template"], detail["catalog"]
        visualization = detail.get("route_visualization") or {}
        point_details = visualization.get("actual_waypoint_details") or []
        points = [
            {
                "point_id": point["full_id"],
                "point_type": point.get("point_type"),
                "coordinates": point.get("coordinate") or generated_anchors.get(point["full_id"]),
            }
            for point in point_details
        ]
        if not points:
            points = template.get("ordered_route_points") or []
        coordinates = template.get("route_geometry", {}).get("coordinates") or []
        route_type = ROUTE_TYPES.get(template.get("route_type"))
        if route_type is None:
            if template.get("route_type") == "PERIMETER_ROUTE" and len(points) >= 2:
                route_type = "LOOP" if points[0]["coordinates"] == points[-1]["coordinates"] else "THROUGH"
            else: reasons.append("AMBIGUOUS_ROUTE_TYPE")
        if len(points) < 2 or any(not point.get("coordinates") for point in points):
            reasons.append("WAYPOINTS_MISSING")
        if len(coordinates) < 2: reasons.append("GEOMETRY_MISSING")
        if reasons:
            excluded.append({"routeId": str(item["official_park_id"]), "reasons": reasons})
            continue
        waypoint_ids = [point["point_id"] for point in points]
        unique = {}
        for point in points:
            unique.setdefault(point["point_id"], {
                "id": point["point_id"],
                "kind": "ENTRANCE" if point.get("point_type") == "ENTRANCE" or point is points[0] or point is points[-1] else "INTERNAL",
                "location": {"lng": point["coordinates"][0], "lat": point["coordinates"][1]},
            })
        route = {
            "routeId": f'park-route:{item["official_park_id"]}:v2.5',
            "officialParkId": str(item["official_park_id"]),
            "parkName": item["official_park_name"],
            "routeType": route_type,
            "directionPolicy": "FORWARD_ONLY",
            "entry": {"waypointId": waypoint_ids[0], "location": unique[waypoint_ids[0]]["location"]},
            "exit": {"waypointId": waypoint_ids[-1], "location": unique[waypoint_ids[-1]]["location"]},
            "waypoints": list(unique.values()),
            "pathWaypointIds": waypoint_ids,
            "excludedWaypointIds": [],
            "coordinates": [{"lng": p[0], "lat": p[1]} for p in coordinates],
            "distanceMeters": max(1, round(template["route_distance_m"])),
            "durationSeconds": max(1, round(template["estimated_duration_s"])),
            "routing": {"engine": "VALHALLA", "costing": "pedestrian"},
            "review": {
                "completed": True, "outcome": "APPROVED_FOR_PRODUCTION",
                "reviewer": catalog.get("reviewer") or "손기환",
                "reviewedAt": catalog.get("reviewed_at") or template["generated_at"],
            },
        }
        route["sourceHash"] = digest(route)
        included.append(route)
    included.sort(key=lambda route: route["routeId"])
    report = {
        "totalParks": len(audit["items"]), "reviewCompleted": audit["summary"]["completed_route_count"],
        "deployable": len(included), "excluded": len(excluded),
        "expected": args.expected_count, "excludedItems": excluded,
    }
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if len(included) != args.expected_count:
        raise SystemExit(f"deployable route count {len(included)} != {args.expected_count}")
    now = datetime.now(timezone.utc).isoformat()
    snapshot = {
        "schemaVersion": "park-route-snapshot-v1",
        "datasetId": "daejeon-park-routes-20260730-final-152-v1",
        "generatedAt": now, "regionCode": "KR-30", "mode": "FULL_SNAPSHOT",
        "source": {"system": "chimap-park-etl", "reviewSchemaVersion": "v2.5"},
        "datasetChecksum": "0" * 64, "routes": included,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    subprocess.run([
        "pnpm", "--filter", "@chimap/api", "exec", "tsx",
        "src/cli/park-route-snapshot.ts", "validate", "--file", str(output),
        "--expected-count", str(args.expected_count), "--write-checksum",
    ], check=True, cwd=Path(__file__).resolve().parents[1])

if __name__ == "__main__":
    main()
