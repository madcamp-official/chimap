# TAGO 버스 데이터 연동

## 기존 구조 분석

변경 전 CHIMap은 React 19/Vite 웹, Express 5 BFF, 공유 Zod 계약으로 구성되어
있었다. 웹의 출발지·목적지 입력은 `PlaceCombobox`, 상태는 Zustand,
서버 상태는 TanStack Query가 담당한다. `CandidateGenerator`가 provider의
대중교통 경로를 받아 조기 하차/추가 도보 후보를 만들고, 기존 추천 엔진이
마감시간·환승·걸음 수 점수를 계산한다. `MapView`는 선택 결과의
`RouteLeg.coordinates`를 NAVER 지도에 그린다.

별도 DB, migration, Supabase/PostgreSQL/PostGIS, Redis는 없었다. LRU 메모리
캐시와 single-flight만 사용했다. 정류장, 노선, 도착 예정, 차량 위치가
분리된 모델도 없었고, `src/providers/mock-provider.ts` 한 파일에 대전 장소,
버스/지하철 노선, 정류장명과 시간이 하드코딩되어 있었다. 이 fixture는
`src/test-fixtures`로 이동했고 production TypeScript 빌드에서 제외된다.

## 신청해야 하는 공공데이터

공공데이터포털에서 다음 TAGO OpenAPI 활용신청이 필요하다.

- 국토교통부_(TAGO)_버스정류소정보
- 국토교통부_(TAGO)_버스노선정보
- 국토교통부_(TAGO)_버스도착정보
- 국토교통부_(TAGO)_버스위치정보

공통 일반 인증키를 `DATA_GO_KR_SERVICE_KEY`에 넣거나 서비스별 키를 각각
설정한다. 서비스별 키가 있으면 서비스별 키가 우선한다. 모든 키는 Express
서버에서만 읽으며 `VITE_`, `NEXT_PUBLIC_`, `REACT_APP_` 변수로 만들면 안
된다. 브라우저에 넣은 키는 번들과 개발자 도구에서 누구나 읽고 호출량을
소진할 수 있다.

공공데이터포털이 표시하는 Encoding 키는 URL encoding된 값이고 Decoding
키는 원래 값이다. 클라이언트는 `%2B`, `%3D`가 포함된 Encoding 키는 그대로
붙이고 Decoding 키만 한 번 encode해 이중 인코딩을 막는다. 요청 URL과 키는
로그 및 오류 응답에 기록하지 않는다.

## 환경 설정

루트 `.env.example`을 `.env`로 복사하고 값을 입력한다. 실제 키와 전국 파일은
Git에 추가하지 않는다.

```dotenv
DATA_GO_KR_SERVICE_KEY=
TAGO_BUS_STOP_SERVICE_KEY=
TAGO_BUS_ROUTE_SERVICE_KEY=
TAGO_BUS_ARRIVAL_SERVICE_KEY=
TAGO_BUS_LOCATION_SERVICE_KEY=
BUS_STOPS_DATA_PATH=
TRANSIT_DB_PATH=.data/transit.sqlite
```

대전 테스트 기본 도시코드는 `25`일 뿐, 애플리케이션 로직은 주변 정류장
응답의 `cityCode`와 `getCtyCodeList` 결과를 사용한다.

API, Vite, transit CLI, mock 개발 서버는 모두 저장소 루트 `.env`만 읽는다.
앱별 `.env` 파일을 만들지 않는다. timeout/retry, 캐시 TTL, 반경/환승,
속도/정차시간까지 포함한 전체 목록과 기본값은 루트
`.env.example`을 단일 템플릿으로 사용한다.

| 설정 | 기본값 |
|---|---:|
| `TAGO_HTTP_TIMEOUT_MS` / `TAGO_HTTP_RETRY_COUNT` | 7000 / 2 |
| nearby/route/route-stops TTL | 300 / 86400 / 86400초 |
| arrival/location TTL | 20 / 10초 |
| `TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS` | 500m |
| `TRANSIT_MAX_TRANSFER_COUNT` | 1 |
| 도보/버스 평균 속도 | 4.5 / 20km/h |
| 중간 정류장 정차시간 | 25초 |

## 전국 정류장 파일 import

공공데이터포털의 전국버스정류소표준데이터 CSV를 서버가 읽을 수 있는 위치에
저장하고 `BUS_STOPS_DATA_PATH`를 설정한다. 파일이 없으면 임의 데이터가
생성되지 않는다.

```bash
pnpm bus:import-stops
pnpm bus:stats
```

다른 파일을 한 번만 지정할 수도 있다.

```bash
pnpm bus:import-stops -- --path /srv/data/bus-stops.csv
```

importer는 UTF-8, UTF-8 BOM, CP949를 처리하고 한국어/영문 헤더 별칭을 자동
매핑한다. 필수 헤더가 없거나 좌표가 잘못되면 DB를 변경하기 전에 오류를
낸다. SQLite에 transaction upsert하므로 같은 파일을 다시 실행해도 중복되지
않는다.

파일의 `정류장번호`는 `source_stop_no`에 저장하며 TAGO `nodeId`로 간주하지
않는다. TAGO 주변 정류장이 조회되면 `(city_code, node_id)`를 먼저 찾고,
없으면 30m 안의 이름 유사도가 높은 CSV 정류장 하나만 연결한다. 후보가
모호하면 자동 병합하지 않고 안전한 구조화 로그를 남긴다.

## 저장소와 migration

Node 24 내장 SQLite를 사용해 외부 ORM을 추가하지 않았다. 기본 파일은
`.data/transit.sqlite`이고 `TRANSIT_DB_PATH`로 바꿀 수 있다. migration은
`apps/api/migrations/001_transit.sql`과 런타임 migration 목록에 있다.

- `bus_stops`: CSV 식별자와 TAGO 식별자를 분리해 저장
- `bus_routes`: `(city_code, route_id)` unique
- `bus_route_stops`: 노선/정류장 관계와 `node_order`

PostGIS가 아니므로 좌표 bounding box를 먼저 조회한 뒤 Haversine 거리로
반경을 확정한다. 도착 예정과 차량 위치는 짧은 수명의 캐시에만 저장한다.

## 서버 API

버전 경로 `/api/v1/transit`와 호환 경로 `/api/transit`를 모두 제공한다.

- `GET /bus/stops/nearby?lat=&lng=&radiusMeters=`
- `GET /bus/stops/:nodeId/routes?cityCode=`
- `GET /bus/stops/:nodeId/arrivals?cityCode=`
- `GET /bus/routes/:routeId?cityCode=`
- `GET /bus/routes/:routeId/stops?cityCode=`
- `GET /bus/routes/:routeId/vehicles?cityCode=`
- `POST /recommendations`

TAGO raw 응답은 이 경계 밖으로 노출하지 않는다. `item`이 객체/배열인 경우,
빈 `items`, 문자열 숫자, 누락 필드를 공통 처리하고 `resultCode`가 정상이
아니면 service/operation/resultCode/retryable/occurredAt만 가진 안전한
오류로 변환한다. 5xx 및 네트워크 오류만 제한적으로 재시도한다.

캐시 TTL은 주변 정류장 5분, 노선/경유정류장 24시간, 도착 20초, 차량 10초다.
모든 cache miss는 single-flight로 중복 호출을 합친다.

## 경로 추천 방식

TAGO는 출발지와 목적지를 넣어 완성 경로를 반환하는 API가 아니다. CHIMap은
기존 추천 엔진과 점수식을 유지하고 다음 버스 그래프 후보를 입력한다.

1. 출발지/목적지 500m 안의 연결된 정류장을 각각 최대 8개 선택한다.
2. 정류장별 노선 `routeId` 교집합을 구한다.
3. 노선 경유정류장의 `nodeOrder`로 탑승 정류장이 하차 정류장보다 앞인지
   확인하여 반대 방향을 제외한다.
4. 직행이 아닌 경우 출발 노선 하류와 목적 노선 상류에서 동일 정류장 또는
   100m 안의 환승점을 찾고 최대 1회 환승 후보를 만든다.
5. 최초 탑승 도착정보가 있으면 실제 대기시간을 사용한다. 없으면 배차간격의
   절반, 배차간격도 없으면 10분을 사용하고 `예상`으로 표시한다.
6. 버스 승차시간은 경유 정류장 좌표 간 거리, 평균 버스 속도, 중간 정류장
   정차시간으로 추정한다.
7. 기존 FAST/BALANCED/GOAL 점수와 마감시간 필터를 그대로 적용한다.

정류장 좌표를 이은 선은 실제 도로 shape가 아니며 UI의 추정 안내에도 이를
표시한다. 선택 경로의 버스만 10초마다 차량 위치를 조회하고, background 탭과
unmount 상태에서는 polling을 중지한다.

## 지역 및 장애 처리

TAGO 연계 범위와 실시간 필드는 지역마다 다를 수 있다. 정류소별 경유노선
operation이 비어 있거나 지원되지 않으면 이미 동기화한 `bus_route_stops`
관계를 우선 사용한다. 실시간 도착/차량이 없으면 정적 경로는 유지하되
`realtimeAvailable=false` 또는 예상 배지를 표시한다.

외부 API 오류 시 fixture로 자동 전환하지 않는다. 네트워크 오류 때 이미
import된 실제 정류장만 반환할 수 있으면 `partial=true`로 명시한다. 키가
없으면 `TRANSIT_NOT_CONFIGURED` 오류를 반환한다.

mock 데이터는 `pnpm --filter @chimap/api dev:mock`으로 실행하는 별도 개발
진입점과 테스트 fixture에만 존재한다. 운영 `server.ts`와 production 빌드에는
fixture import가 포함되지 않으며, `USE_MOCK_TRANSIT_DATA=true`는 production
설정 검증에서도 거부된다.

## 진단 명령

```bash
pnpm tago:health
pnpm tago:test-nearby -- --lat 36.37 --lng 127.36
pnpm tago:test-arrivals -- --cityCode 25 --nodeId DJB...
pnpm tago:test-route-stops -- --cityCode 25 --routeId DJB...
pnpm tago:test-vehicles -- --cityCode 25 --routeId DJB...
pnpm bus:sync-route -- --cityCode 25 --routeId DJB...
pnpm bus:stats
```

health 출력은 키 존재 여부, 서비스 성공 여부, resultCode, 시간, item 수만
포함하며 실제 키와 전체 URL은 출력하지 않는다.
