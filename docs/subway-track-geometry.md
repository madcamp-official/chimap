# 전국 지하철 선로 형상 운영

CHIMap은 `X-Route-Geometry: track-v1`을 보낸 클라이언트의 지하철 leg에 실제
선로 형상을 반환합니다. 헤더가 없거나 값이 다르면 기존 역사 좌표 직선을
반환하므로 구버전 앱과 웹의 응답 계약은 바뀌지 않습니다. 운행시간, 배차,
환승, 운임 및 추천 점수 계산도 기존 값을 유지합니다.

## 데이터와 라이선스

- 내부 노선↔외부 관계 매핑: [`data/subway_geometry_sources.json`](../data/subway_geometry_sources.json)
- 공개 가능한 파생 GeoJSON: [`data/subway_segment_shapes.geojson`](../data/subway_segment_shapes.geojson)
- 생성 coverage·checksum: [`data/subway_segment_shapes.report.json`](../data/subway_segment_shapes.report.json)
- 재배포 고지: [`data/subway_segment_shapes.LICENSE.md`](../data/subway_segment_shapes.LICENSE.md)

현재 공식 국토교통부 도시철도 전체노선 데이터는 역·노선 정보만 제공하고 실제
선로 LineString은 제공하지 않습니다. 따라서 공식 형상이 확인되지 않은 구간은
OpenStreetMap `route=subway/train/light_rail` 관계를 사용합니다. 원저작권은
© OpenStreetMap contributors이며 ODbL-1.0이 적용됩니다. 각 Feature는 원본 관계
URL, 응답 SHA-256, OSM 스냅샷 시각과 라이선스를 포함합니다. 공식 GTFS 또는
중심선이 확보되면 같은 내부 segment key로 교체합니다.

형상 구축 중 원본 토폴로지의 2,318개 방향 구간 가운데 코레일 1호선 양주–덕계
사이에 인천 2호선 마전역이 잘못 삽입된 4개 구간을 발견했습니다. 이 구간은
38~42km를 90~180초에 이동하는 불가능한 edge였고 정상 양주↔덕계 edge가 이미
존재하므로, 관련 segment 4개와 headway 40개를 제거했습니다. 따라서 운영 gate의
정확한 유효 구간 수는 2,314개입니다. 마곡·동구릉·동해선 동래역의 잘못된 좌표
3건도 OSM 역 node와 선로 relation을 기준으로 교정했습니다. 이전 값, 교정 값,
근거 URL은 source manifest의 `source_data_corrections`에 보존합니다.

## 재생성과 import

Node.js 24에서 다음 순서로 실행합니다.

```bash
pnpm subway:generate-shapes
pnpm subway:validate-shapes -- --directory data
pnpm subway:import-shapes -- --directory data
```

생성기는 manifest에 명시한 OSM relation만 조회하고 원본 OSM relation/Overpass 응답을
`/tmp/chimap-osm-route-relations`에 보존합니다. 임의 곡선이나 역 사이 보간은
사용하지 않습니다. importer는 중복/알 수 없는 key, 한국 영역, LineString과
최소 점 수, 250m 끝점 오차, 75m 인접 구간 단절, 방향, 출처·라이선스,
route-ready 전 구간 coverage를 fail-fast로 검사합니다.

DB import는 하나의 transaction에서 실행됩니다. 원본에 가까운 좌표는 공개
GeoJSON에 보존하고, API 표시용 DB geometry만 EPSG:5179에서 3m 허용오차로
단순화한 뒤 EPSG:4326으로 저장합니다. 실제 길이는 단순화 전 geometry의
PostGIS geography 길이로 계산합니다. 검증이나 import가 실패하면 기존 DB는
그대로 유지됩니다.

## 호환성 및 fallback

`track-v1` 요청에서도 한 subway leg의 구간 하나라도 형상이 없거나 끝점·연속성
검증에 실패하면 그 leg 전체를 기존 역 좌표 직선으로 반환합니다. 정상 형상과
직선을 섞어 단절을 감추지 않습니다. 서버와 모바일 persisted cache namespace는
geometry profile을 포함합니다. 응답 JSON 필드는 추가하지 않습니다.

모바일 지도에는 지하철 경로가 있으면 항상
`선로 데이터: © OpenStreetMap contributors 외` 링크를 표시합니다. 이는 fallback
상황의 과잉 고지는 허용하지만 OSM 파생 형상을 고지 없이 표시하는 상황을 막습니다.

## 배포 gate와 관측

1. migration 10과 importer를 먼저 배포합니다.
2. GeoJSON을 검증하고 staging DB에 import하되 기능은 헤더로 비활성 상태를
   유지합니다.
3. 출처 링크와 `track-v1` 헤더가 포함된 앱을 배포합니다.
4. staging에서 30개 노선의 `geometryCount/segmentCount`를 확인합니다.
5. 2,314/2,314일 때만 새 앱 요청을 운영으로 보냅니다.

운영 지표는 노선별 `chimap_subway_track_geometry_coverage_ratio`, 원인별
`chimap_subway_track_geometry_fallback_total`, 출처 범주별 응답 정점 histogram을
제공합니다. 활성화 시 기존 2,314개 유효 구간의 fallback은 0이어야 합니다. 그래프
cache를 가진 API 프로세스는 import 후 재시작하거나 cache TTL이 지난 뒤 검증합니다.

필수 시각 기준 사례는 정부청사역→시청역→탄방역이며, 정방향·역방향·급곡선·
분기·종점·환승을 iOS와 Android에서 확대 확인합니다. production DB import와 앱
스토어 배포는 별도 승인 및 DB backup 확인 후 수행합니다.
