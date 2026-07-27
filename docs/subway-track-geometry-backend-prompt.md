# CHIMap 지하철 실제 선형 geometry 백엔드 구현 프롬프트

아래 프롬프트를 authoritative CHIMap Expo 모노레포의 백엔드 작업 세션에 그대로 전달한다.

---

당신은 CHIMap 모노레포의 백엔드 개발을 담당한다. 현재 지하철 추천 경로가 지도에서 실제 선로를 따라가지 않고 역사와 역사를 직선으로 연결하는 문제를 해결하라. 추측으로 선을 만들거나 프론트엔드에서 보간하는 임시방편은 금지한다. 실제로 사용할 권리가 확인된 선로 또는 운행 shape 데이터를 수집·검증·저장하고, API의 기존 `RouteLeg.coordinates`에 조밀하고 순서가 올바른 좌표를 내려주는 것이 목표다.

## 작업 전 확인과 안전 조건

1. 저장소 root, 현재 branch, HEAD, dirty worktree를 먼저 출력한다.
2. 기존 사용자 변경은 보존하고 관련 없는 파일을 수정하지 않는다.
3. 백엔드 책임 branch는 `feat/api/subway-track-geometry`를 사용한다. 장기 iOS branch나 generated `apps/mobile/ios` 커밋을 만들지 않는다.
4. 별도 요청이 없으면 commit, push, production 배포를 하지 않는다.
5. 먼저 아래 파일을 실제로 읽고 이 프롬프트의 진단이 현재 코드에도 맞는지 확인한다.
   - `packages/contracts/src/index.ts`
   - `apps/api/src/transit/migrations.ts`
   - `apps/api/src/transit/transit-repository.ts`
   - `apps/api/src/transit/subway-topology-importer.ts`
   - `apps/api/src/providers/subway-route-planner.ts`
   - `apps/api/src/providers/subway-route-planner.test.ts`
   - `apps/mobile/src/platform/maps/native-route-map.native.tsx`
   - `data/subway_service_lines.csv`
   - `data/subway_line_stations.csv`
   - `data/subway_segments.csv`
6. 현재 코드 구조가 아래 설명과 달라졌다면 달라진 사실을 먼저 보고하고, 같은 최종 동작을 만족하는 방향으로 계획을 조정한다.

## 현재 문제와 확인된 원인

- 모바일은 `native-route-map.native.tsx`에서 각 `RouteLeg.coordinates`를 `NaverMapPolylineOverlay`에 그대로 전달한다. 모바일이 역사 사이의 점을 임의로 만드는 구조가 아니다.
- 계약의 `RouteLeg.coordinates: Coordinate[]`는 이미 상세 선형을 담을 수 있으므로, 이 문제 때문에 새 API 필드를 추가할 필요는 없다.
- 현재 `subway_segments`에는 `straight_distance_meters`만 있고 실제 선로 `LineString`이 없다.
- `data/subway_segments.csv` 역시 양 끝 역과 직선거리만 포함하며 geometry가 없다.
- `SubwayRoutingEdge`에도 선형 좌표가 없다.
- `getSubwayRoutingGraph()`는 지하철 간선의 거리로 `straight_distance_meters`만 읽는다.
- `subwayCoreLegs()`는 같은 노선의 탑승 구간을 만든 뒤 `coordinates: rideStations.map(coordinate)`를 사용한다. 결국 API는 역사 좌표만 전달하고 모바일은 그 점들을 직선으로 이을 수밖에 없다.
- 현재 마이그레이션 최신 버전은 8이며 PostGIS는 이미 사용 중이다.
- 대전 1호선의 현재 service line ID는 `SL_035A73FB3875`이고, 현재 topology 데이터 기준 22개 역/42개 방향성 segment가 route-ready 상태다.

## 목표 동작

1. 지하철 `RIDE` leg의 polyline이 실제 선로나 실제 운행 shape를 따라간다.
2. 여러 역을 지나는 하나의 지하철 leg는 해당 방향의 인접 segment geometry를 끊김 없이 합친 좌표를 반환한다.
3. 역순 경로도 좌표 순서가 출발역에서 도착역 방향으로 유지된다.
4. 지하철 leg의 `distanceMeters`는 실제 선형 길이를 사용한다. 이렇게 해야 모바일 카드의 도보/버스/지하철 거리 비율도 정확해진다.
5. geometry가 없는 노선 때문에 전체 추천 API가 장애가 나면 안 된다. 제한적인 fallback은 허용하되 반드시 관측 가능해야 하며, 대전 1호선 staging 공개 gate에서는 fallback이 0이어야 한다.

## 비목표와 금지 사항

- 역사 사이의 직선을 점만 늘려 보간하지 않는다. 점 개수가 많아져도 실제 선로가 되지 않는다.
- NAVER 지도 타일의 화면 픽셀을 스크래핑하거나 역추적하지 않는다.
- 출처와 라이선스가 불명확한 블로그, 임의 GitHub 파일, 상업 지도 화면의 좌표를 production 데이터에 넣지 않는다.
- 모바일에서 선로를 추정하거나 별도 지도 API를 호출하게 만들지 않는다.
- 환승 통로의 실내 보행 geometry까지 이번 작업에 억지로 포함하지 않는다. 환승 `WALK` leg는 별도 데이터가 없다면 기존 fallback을 유지하되 문서에 한계를 기록한다.

## 1. 실제 선형 데이터 확보

다음 우선순위로 합법적으로 재배포/서비스 가능한 원천을 확인한다.

1. 운영기관 또는 공공데이터의 GTFS `shapes.txt`
2. 운영기관/지자체/국가 공간정보의 철도 중심선 GeoJSON, Shapefile 또는 WFS
3. 위와 동등한 공식 공개데이터

각 데이터셋에 대해 source URL, 제공기관, 데이터 버전/기준일, 라이선스, 가공 여부를 기록한다. 서비스 사용과 변형/재배포가 허용되는지 확인할 수 없으면 실제 데이터를 임의로 채우지 말고 blocker로 보고한다.

GTFS를 쓸 경우 `shape_id`, `trip_id`, `route_id`, `stop_sequence`, 가능하면 `shape_dist_traveled`를 이용해 service line과 방향을 매핑한다. 전체 노선 GeoJSON만 있을 경우에는 다음 절차를 사용한다.

- GeoJSON 좌표 순서는 `[longitude, latitude]`, API 계약은 `{ lat, lng }`임을 명시적으로 변환한다.
- 각 역을 노선 선형에 snap하고 `ST_LineLocatePoint` 또는 동등한 방식으로 진행 위치를 구한다.
- 역 순서에 따라 진행 위치가 단조 증가/감소하는지 확인한다.
- 인접 역 진행 위치 사이를 `ST_LineSubstring` 또는 동등한 로직으로 분할한다.
- 반대 방향 segment는 동일 geometry의 좌표 순서를 뒤집어 저장한다.
- 분기 노선은 `service_line_id`/운행 pattern별 shape를 명시적으로 고른다. 어느 branch인지 모호한 shape는 자동 추정으로 통과시키지 않는다.

## 2. 데이터 파일과 검증 가능한 importer

기존 시간/거리 CSV에 긴 좌표 문자열을 억지로 넣지 말고, 예를 들어 `data/subway_segment_shapes.geojson` 같은 별도 파일을 추가한다. 각 Feature는 최소한 다음 property를 가져야 한다.

```json
{
  "type": "Feature",
  "properties": {
    "service_line_id": "SL_035A73FB3875",
    "from_source_station_key": "...",
    "to_source_station_key": "...",
    "geometry_source": "...",
    "geometry_license": "...",
    "geometry_version": "..."
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [[127.0, 36.0], [127.0001, 36.0001]]
  }
}
```

`subway-topology-importer.ts` 또는 별도 importer가 이 파일을 함께 읽게 하고 다음을 fail-fast 검증한다.

- Feature key가 기존 `subway_segments`의 복합키와 정확히 일치한다.
- 같은 방향성 segment key가 중복되지 않는다.
- geometry type이 `LineString`, SRID가 4326이고 점이 2개 이상이다.
- 모든 위경도가 finite이고 한국 서비스 범위에 합리적으로 위치한다.
- 첫 점은 from 역, 마지막 점은 to 역에 더 가깝다. 반대라면 importer가 명시적으로 reverse하고 그 사실을 집계한다.
- 양 끝점과 대응 역의 거리가 허용 오차 이내인지 검증한다. 초기 권장 상한은 250m이며 실제 원천의 역 좌표 성격을 확인해 더 엄격하게 조정한다.
- 같은 노선의 연속 segment 사이 간격이 허용 오차 이내인지 검증한다. 끊김을 조용히 직선으로 메우지 않는다.
- 동일 역쌍 양방향 geometry가 서로 reverse 관계인지 검증한다.
- geometry source/license/version이 비어 있지 않다.
- route-ready 노선별 전체 segment 대비 geometry coverage를 출력한다.

DB에는 원본에 가까운 geometry를 보존한다. API payload용 단순화가 필요하면 한국 미터 좌표계(예: EPSG:5179)로 변환한 후 5~10m 이하의 허용 오차로 `ST_SimplifyPreserveTopology`를 적용하고 다시 4326으로 변환한다. 위경도 degree를 meter처럼 취급하지 않는다. 단순화 전후의 양 끝점과 주요 곡선이 보존되는지 fixture로 검증하고, 임의 vertex cap으로 경로를 훼손하지 않는다.

## 3. DB migration v9

기존 migration을 수정하지 말고 `apps/api/src/transit/migrations.ts`에 version 9를 추가한다. 기존 레코드가 있으므로 첫 migration에서는 nullable로 추가하고, importer/backfill과 coverage gate로 완전성을 보장한다.

권장 스키마는 다음과 같다. 실제 명명은 저장소 관례에 맞추되 의미는 유지한다.

```sql
ALTER TABLE subway_segments
  ADD COLUMN IF NOT EXISTS track_geometry geometry(LineString, 4326),
  ADD COLUMN IF NOT EXISTS track_distance_meters integer,
  ADD COLUMN IF NOT EXISTS geometry_source varchar(160),
  ADD COLUMN IF NOT EXISTS geometry_license varchar(240),
  ADD COLUMN IF NOT EXISTS geometry_version varchar(120),
  ADD COLUMN IF NOT EXISTS geometry_updated_at timestamptz;

ALTER TABLE subway_segments
  ADD CONSTRAINT subway_segments_track_distance_check
    CHECK (track_distance_meters IS NULL OR track_distance_meters > 0),
  ADD CONSTRAINT subway_segments_track_metadata_check
    CHECK (
      track_geometry IS NULL OR
      (geometry_source IS NOT NULL AND geometry_license IS NOT NULL
       AND geometry_version IS NOT NULL AND geometry_updated_at IS NOT NULL)
    );
```

typed geometry column 자체가 type/SRID를 제한하지만 `ST_NPoints(track_geometry) >= 2`도 importer와 DB constraint 중 적절한 곳에서 보장한다. 공간 진단 쿼리가 필요하면 GiST index를 추가할 수 있으나, 일반 route lookup은 기존 segment 복합키를 사용한다.

Importer는 geometry를 넣을 때 아래와 동등한 방식으로 실제 길이를 함께 계산한다.

```sql
track_distance_meters = ROUND(ST_Length(track_geometry::geography))::integer
```

`straight_distance_meters`는 fallback/품질 비교를 위해 삭제하지 않는다.

## 4. repository와 routing graph

`SubwayRoutingEdge`에 다음과 동등한 필드를 추가한다.

```ts
coordinates: Coordinate[] | null;
geometrySource: string | null;
```

`getSubwayRoutingGraph()`의 ride segment query가 다음을 수행하게 한다.

- `track_geometry`의 좌표를 `ST_AsGeoJSON` 또는 `ST_DumpPoints`로 순서대로 읽는다.
- GeoJSON `[lng, lat]`를 `{ lat, lng }`로 안전하게 변환한다.
- `distanceMeters`는 `track_distance_meters ?? straight_distance_meters`를 사용한다.
- malformed JSON, 점 1개 이하, non-finite 좌표는 무시하지 말고 데이터 오류로 처리한다.
- `TRANSFER` edge의 `coordinates`는 `null`로 두거나 별도 명확한 fallback을 사용한다.

SQL이 payload용 단순화를 수행한다면 원본 geometry는 DB에 보존하고, 쿼리 결과에만 단순화 geometry를 사용한다. `MemoryCache`의 지하철 graph TTL이 현재 5분이므로 데이터 import/deploy 후 재시작 또는 명시적 cache 무효화 절차를 rollout 문서에 포함한다.

## 5. subway route leg 조립

`subwayCoreLegs()`에서 더 이상 `rideStations.map(coordinate)`를 정상 경로의 좌표로 사용하지 않는다.

각 `RIDE` edge에 대해 다음을 수행하는 작은 순수 함수를 만든다.

1. 저장된 좌표가 from 역 → to 역 방향인지 양 끝점 거리로 방어적으로 확인한다.
2. 반대면 reverse한다.
3. 연속 edge를 합칠 때 같은 경계 좌표는 한 번만 남긴다.
4. 경계가 완전히 같지 않으면 meter 단위 tolerance 안에서만 dedupe한다.
5. tolerance를 벗어난 gap은 직선으로 조용히 연결하지 말고 오류/metric으로 남긴다.

여러 ride edge의 geometry를 합친 배열을 지하철 leg의 `coordinates`로 넣는다. 모든 edge에 geometry가 있을 때는 역사 수보다 훨씬 많은 실제 선형 점이 내려가야 한다. 일부 geometry가 없을 때만 기존 역사 좌표 fallback을 사용할 수 있으며 다음 조건을 지킨다.

- 응답 생성은 계속 가능하게 한다.
- 로그/metric에 service line, from/to key, fallback 사유를 남긴다. 토큰이나 개인정보는 로그에 넣지 않는다.
- 가능하면 recommendation의 `estimationNotes` 같은 기존 설명 채널에 geometry fallback 사실을 노출한다.
- 정상 geometry와 fallback geometry를 한 leg 안에서 섞어 생기는 긴 직선 gap을 관측할 수 있게 한다.

외부 API 계약은 기존 `RouteLeg.coordinates`를 그대로 사용한다. 계약 모양 변경이 정말 필요하다고 판단되면 먼저 근거를 보고하고 `feat/contracts/*` 책임 범위로 분리하되, 이 문제만으로는 계약 변경이 필요하지 않다.

## 6. 관측성과 품질 gate

다음과 동등한 지표 또는 구조화 로그를 추가한다.

- route-ready 노선별 `subway_track_geometry_coverage`
- `subway_track_geometry_fallback_total`
- endpoint mismatch/reversed geometry/continuity gap 집계
- 응답 지하철 leg별 vertex 수와 geometry source(과도한 고카디널리티 label은 피한다)

대전 1호선 staging 활성화 조건:

- `SL_035A73FB3875`의 방향성 segment 42개 중 42개가 유효한 geometry를 갖는다.
- 양방향 및 전 구간 continuity 검증을 통과한다.
- 알려진 대전 구간 실기기 테스트에서 fallback counter가 증가하지 않는다.
- geometry가 준비되지 않은 다른 route-ready 노선은 명시적으로 비활성화하거나 관측 가능한 fallback 정책을 적용한다. 데이터가 불완전한데 100% 지원한다고 보고하지 않는다.

## 7. 필수 테스트

최소한 다음 자동 테스트를 추가한다.

### Importer 단위 테스트

- 정상 LineString import
- `[lng, lat]` 순서 보존
- 역방향 geometry 자동 reverse 및 집계
- 중복 segment key 거부
- 알 수 없는 segment key 거부
- 점 1개, NaN/범위 밖 좌표, 잘못된 geometry type 거부
- endpoint가 역에서 너무 먼 geometry 거부
- 연속 segment gap 거부
- source/license/version 누락 거부

### Repository/DB 테스트

- migration v9가 기존 DB에 적용됨
- LineString round-trip 후 좌표 순서가 유지됨
- `track_distance_meters`가 `ST_Length(...::geography)`와 일치함
- geometry가 있으면 실제 길이, 없으면 직선거리 fallback을 사용함
- reverse 방향 segment가 반대 좌표 순서를 가짐

### Planner 단위 테스트

- 곡선 fixture A→B→C에서 생성된 subway leg 좌표 수가 역사 수보다 많음
- 중간 좌표가 A–C 직선에서 유의미하게 벗어나 실제 곡선을 보존함
- B 경계 좌표가 중복되지 않음
- C→A 역방향 결과의 첫/마지막 좌표가 뒤집힘
- 환승 경로에서도 노선별 subway leg geometry가 올바름
- geometry 누락 시 fallback과 metric/log가 작동함
- `distanceMeters`가 실제 segment 길이 합과 일치함

### API/통합 테스트

- 추천 응답이 기존 `routeLegSchema`를 통과함
- 알려진 대전 1호선 역쌍의 `SUBWAY` leg가 2점짜리 직선이 아닌 상세 polyline을 반환함
- 응답 좌표가 시작/종료 역 인근이며 전 구간이 대전 1호선 shape 범위 안에 있음
- 42/42 coverage query 결과를 fixture 또는 staging 검증으로 남김

테스트가 단순히 `coordinates.length > 2`만 확인해서는 안 된다. 직선 위에 보간점만 추가한 잘못된 구현도 통과하므로, 곡선 fixture의 중간점이 chord에서 벗어나는지까지 검증한다.

## 8. 실행할 검증 명령

저장소에 실제 존재하는 명령을 확인한 뒤 최소한 아래를 실행한다.

```bash
pnpm --filter @chimap/contracts build
pnpm --filter @chimap/api typecheck
pnpm --filter @chimap/api test
pnpm --filter @chimap/api build
```

DB 통합 테스트는 테스트용 PostGIS DB에서만 실행한다. staging import 전에는 dry-run 검증과 노선별 coverage 리포트를 먼저 출력한다. production DB import는 별도 승인 없이는 하지 않는다.

## 9. staging 검증 절차

1. migration v9 적용 전 DB backup/복구 경로를 확인한다.
2. geometry importer를 dry-run하고 rejected/reversed/gap/coverage 수치를 저장한다.
3. staging DB에 import한다.
4. 대전 1호선 42/42 coverage SQL 결과를 확인한다.
5. API를 재시작하거나 5분 graph cache를 명시적으로 무효화한다.
6. 알려진 역쌍 추천 응답 JSON에서 subway leg 좌표 수, 실제 거리, 첫/마지막 좌표를 확인한다.
7. iPhone 12 Pro의 CHIMap staging 앱에서 확대해 선이 실제 지하철 선형을 따라가는지 확인한다.
8. 정방향/역방향/여러 역/환승 포함 경로를 각각 확인한다.
9. fallback counter가 0인지 확인한다.

## 완료 조건

- 카드를 위한 거리 비율 계산에 사용되는 subway `distanceMeters`가 실제 선형 거리다.
- 대전 1호선의 모든 route-ready 방향성 segment가 합법적 출처의 유효한 geometry를 가진다.
- API의 subway leg가 실제 선로를 따르는 ordered coordinates를 반환한다.
- 모바일 코드를 수정하지 않아도 현재 `NaverMapPolylineOverlay`가 실제 선형을 그린다.
- 정방향, 역방향, 다중 역, 환승 경로가 자동 테스트와 staging 실기기 검증을 통과한다.
- geometry 누락/오류 fallback은 사용자 장애 없이 동작하며 관측 가능하다.
- source/license/version이 코드 또는 데이터 문서에서 추적 가능하다.
- 관련 테스트, typecheck, build가 모두 통과한다.

## 작업 완료 보고 형식

마지막에 다음을 빠짐없이 보고한다.

1. 실제 원인과 수정한 데이터 흐름
2. 사용한 geometry 원천, 제공기관, 기준일, 라이선스
3. DB migration과 importer 변경 파일
4. 노선별 전체 segment/유효 geometry/fallback coverage 표
5. 샘플 대전 경로의 수정 전·후 좌표 수와 거리 비교
6. 정방향·역방향·환승 테스트 결과
7. 실행한 명령과 결과
8. staging에만 남은 작업과 production 전 blocker
9. 수정한 파일 목록

---
