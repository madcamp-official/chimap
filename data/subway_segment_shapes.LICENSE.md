# 지하철 선로 형상 데이터 라이선스

`subway_segment_shapes.geojson`의 현재 형상은 OpenStreetMap의 route 관계를
가공해 생성한 파생 데이터베이스입니다.

- 원저작권: © OpenStreetMap contributors
- 라이선스: Open Database License 1.0 (ODbL-1.0)
- 안내: https://www.openstreetmap.org/copyright
- ODbL 전문: https://opendatacommons.org/licenses/odbl/1-0/

각 Feature의 `geometry_source_url`, `geometry_source_hash`,
`geometry_version`, `geometry_updated_at`에서 사용한 관계와 스냅샷을 확인할 수
있습니다. 내부 노선과 원본 관계의 전체 연결은 `subway_geometry_sources.json`에
기록합니다.

이 파일과 GeoJSON을 공개하거나 재배포할 때 위 저작권·라이선스 고지를 함께
제공해야 합니다. 향후 공식 운영기관 형상이 추가되면 해당 Feature에 기록된 별도
라이선스 조건도 함께 적용합니다.
