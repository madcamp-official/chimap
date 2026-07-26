# TAGO 버스 연동

CHIMap의 버스 정류장·노선·도착·차량은 국토교통부 TAGO를 사용합니다.
전국 공개 정류장 CSV는 검색 기반 공간 인덱스를 제공하고 TAGO가 도시별
식별자와 실시간 정보를 보완합니다.

이 문서는 현재 TAGO client·service·repository 구현을 기준으로 합니다.
테이블·migration과 브라우저에 저장하지 않는 데이터 경계는
[데이터베이스 스키마와 저장 계약](./database-schema.md)을 함께 봅니다.

## 1. 서비스와 키

| 서비스 | 환경변수 | base path |
| --- | --- | --- |
| 정류장 | `TAGO_BUS_STOP_SERVICE_KEY` | `BusSttnInfoInqireService` |
| 노선 | `TAGO_BUS_ROUTE_SERVICE_KEY` | `BusRouteInfoInqireService` |
| 도착 | `TAGO_BUS_ARRIVAL_SERVICE_KEY` | `ArvlInfoInqireService` |
| 차량 | `TAGO_BUS_LOCATION_SERVICE_KEY` | `BusLcInfoInqireService` |

개별 키가 비어 있으면 `DATA_GO_KR_SERVICE_KEY`를 공통 값으로 사용할 수
있습니다. readiness는 네 서비스 호출에 사용할 키가 모두 있어야
통과합니다.

기본 host:

```text
https://apis.data.go.kr/1613000
```

응답 형식은 JSON으로 고정합니다.

## 2. 사용하는 operation

| 목적 | 서비스 | operation |
| --- | --- | --- |
| 도시코드 | 각 서비스 | `getCtyCodeList` |
| 좌표 주변 정류장 | 정류장 | `getCrdntPrxmtSttnList` |
| 정류장 경유 노선 | 정류장 | `getSttnThrghRouteList` |
| 노선번호 목록 | 노선 | `getRouteNoList` |
| 노선 기본정보 | 노선 | `getRouteInfoIem` |
| 노선 정류장 순서 | 노선 | `getRouteAcctoThrghSttnList` |
| 정류장 도착정보 | 도착 | `getSttnAcctoArvlPrearngeInfoList` |
| 정류장·노선 도착정보 | 도착 | `getSttnAcctoSpcifyRouteBusArvlPrearngeInfoList` |
| 노선 차량 위치 | 차량 | `getRouteAcctoBusLcList` |

정류장 경유 노선 operation은 공급자 계약에 맞춰 정류소 ID parameter를
소문자 `nodeid`로 보냅니다. 다른 operation은 문서에 정의된 `nodeId`,
`routeId`, `cityCode`를 사용합니다.

pagination은 `totalCount`와 `numOfRows`를 기준으로 모든 page를 조회합니다.
단일 object와 array 형태를 모두 array로 정규화합니다.

## 3. 데이터 역할

| 데이터 | 저장 | 용도 |
| --- | --- | --- |
| 전국 정류장 CSV | PostgreSQL | 전국 공간 검색 기반 |
| TAGO 정류장 | PostgreSQL | `(cityCode,nodeId)`, 최신 이름·좌표 |
| TAGO 노선 | PostgreSQL | 노선번호·유형·시종점·배차 |
| 노선 정류장 순서 | PostgreSQL | 진행 방향·승하차·환승 |
| 도착정보 | 메모리만 | 현재 대기시간 |
| 차량 위치 | 메모리만 | 지도 차량 marker |

도착과 차량 원문은 영구 저장하지 않습니다.

## 4. 주변 정류장 조회

1. PostGIS에서 요청 좌표 500m 안의 정류장을 거리 순으로 조회합니다.
2. TAGO ID 연결 정류장이 8개 이상이고 DB 결과의 80% 이상이면 DB 결과를
   우선 사용합니다.
3. 연결 범위가 부족하면 TAGO 주변 정류장을 호출합니다.
4. TAGO 결과를 CSV 정류장과 reconcile합니다.
5. 실제 공급자가 일시 실패하고 DB 정류장이 있으면 `partial=true`로
   DB 결과를 반환할 수 있습니다.

API는 최대 100개를 반환합니다.

위 500m는 공개 주변 정류장 API와 일반 조회의 상한입니다. 추천 계산은
`TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS`를 별도 적용해 500m→800m→기본
1.2km 순으로 확장합니다. 각 단계에서 정류장별 실제 노선을 확인해 0건인
정류장을 제외하고, 양쪽에 운행 정류장이 있어도 직행/1회 환승 연결이
없으면 다음 단계로 진행합니다.

## 5. CSV↔TAGO reconcile

정확한 `(city_code,node_id)`가 있으면 해당 row의 이름·좌표·ARS를
갱신합니다.

없으면:

1. TAGO `node_id`와 CSV `source_stop_no`가 정확히 같은 단일 row 연결
2. 정확 일치가 없으면 TAGO 좌표 30m 안의 미연결 CSV row 탐색
3. 정규화한 이름 유사도 0.82 이상만 후보
4. 1위가 2위보다 0.1 이상 높으면 기존 row에 TAGO ID 연결
5. 후보가 비슷하면 ambiguous event 기록
6. 적합 후보가 없으면 TAGO row 추가

노선 동기화 transaction 안의 ambiguous 정류장은 별도 TAGO row로
저장해 route-stop 관계를 잃지 않습니다.

## 6. 노선 조회와 동기화

- 정류장 노선 관계가 DB에 있으면 DB 우선
- 노선 정보가 DB에 없으면 TAGO 조회 후 upsert
- 노선 정류장 관계가 없으면 TAGO 전체 순서를 받아 저장
- `sync-route`는 노선과 전체 정류장 관계를 한 transaction으로 교체
- transaction 실패 시 이전 관계 유지
- PostgreSQL deadlock `40P01`만 transaction 전체를 최대 두 번 재시도

전국 정류장은 일괄 적재하지만 노선 관계는 사용 지역을 중심으로 점진적으로
동기화합니다. 운영 timer는 매일 KAIST 1.2km와 대전역 500m를 갱신하고
상태 파일에 마지막 성공 시각과 실패 노선·코드를 기록합니다.

## 7. 캐시·timeout·재시도

| 항목 | 기본값 |
| --- | --- |
| HTTP timeout | 7초 |
| HTTP retry count | 2 |
| 주변 정류장 TTL | 300초 |
| 노선 TTL | 86,400초 |
| 노선 정류장 TTL | 86,400초 |
| 도착 TTL | 20초 |
| 차량 TTL | 10초 |

HTTP 500/502/503/504와 공급자 세션 포화 result code `99`의 알려진 메시지만
제한 재시도합니다. 설정 오류, 잘못된 응답과 일반 공급자 오류는 반복하지
않습니다.

## 8. CLI

```bash
pnpm tago:health
pnpm tago:test-nearby -- --lat 36.3723 --lng 127.3604
pnpm tago:test-arrivals -- --cityCode 25 --nodeId <nodeId>
pnpm tago:test-route-stops -- --cityCode 25 --routeId <routeId>
pnpm tago:test-vehicles -- --cityCode 25 --routeId <routeId>

pnpm bus:import-stops -- --path "/path/bus data.csv"
pnpm bus:sync-route -- --cityCode 25 --routeId <routeId>
pnpm bus:sync-area -- \
  --lat 36.3723 --lng 127.3604 \
  --radiusMeters 1200 --maxRoutes 60 --concurrency 2
pnpm bus:sync-areas -- \
  --path ops/transit-sync-areas.json \
  --statusPath /var/backups/chimap/transit-sync/transit-sync-latest.json
pnpm bus:stats
```

CLI는 root `.env`를 Node `process.loadEnvFile`로 읽고 DB pool을 최대
2 connections로 제한합니다. JSON 출력에 키 원문은 포함하지 않습니다.

## 9. 오류 매핑

| TAGO 상황 | API |
| --- | --- |
| 키 누락 | 503 `TRANSIT_NOT_CONFIGURED` |
| timeout | 504 `UPSTREAM_TIMEOUT` |
| 사용자 요청 취소 | 408 `UPSTREAM_TIMEOUT` |
| 공급자 응답 오류 | 502 `UPSTREAM_ERROR` |
| 실제 경로 없음 | 404 `NO_TRANSIT_ROUTE` |
| 일부 실시간 실패 | 가능한 정적 경로 + warning |

로그는 서비스 종류, operation을 노출하지 않는 안전한 result code, 결과 수,
처리시간만 기록합니다. service key와 원문 응답은 제외합니다.

`NO_TRANSIT_ROUTE`의 사용자 메시지는 운행 정류장 자체를 찾지 못한 경우와,
운행 정류장은 있지만 직행/1회 환승 연결이 없는 경우를 구분합니다.

## 10. 운영 관측

- 네 서비스 health 성공률
- result code별 발생 수
- timeout과 retry 비율
- 도시·노선 sync 성공/실패 수
- ambiguous 정류장 연결 수
- linked stop 증가량
- 도착 실시간 사용률
- 공급자 일일 호출량과 quota

## 11. 공식 자료

- [TAGO 버스정류소정보](https://www.data.go.kr/data/15098534/openapi.do)
- [TAGO 버스노선정보](https://www.data.go.kr/data/15098529/openapi.do)
- [TAGO 버스도착정보](https://www.data.go.kr/data/15098530/openapi.do)
- [TAGO 버스위치정보](https://www.data.go.kr/data/15098533/openapi.do)
