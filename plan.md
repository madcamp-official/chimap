# CHIMap 실제 데이터 운영 구현 계획과 완료 상태

기준 시각은 2026-07-26 KST입니다. 실제 데이터 전환, NAVER Client Secret
재발급, 운영 재배포, 백업·교통 동기화 자동화와 장애 알림 계층까지
완료했습니다. `bf05003`까지의 기반 구현·CI는 `feat/tago-transit`에
반영됐고, 이후 개인화 한 걸음 길이·조기 하차 우선·지도 도보 표현 변경도
운영 배포와 검증을 마쳐 같은 기능 브랜치에 반영했습니다. 외부 webhook
입력과 기본 브랜치 병합·보호 규칙 설정은 남아 있습니다. 운영 수치와
검증 근거는
[구현·운영 현황](./docs/current-state.md)을 참고합니다.

## 1. 확정된 기술 결정

- 장소·주소·역지오코딩·도보는 Kakao 우선, NAVER 주소 보완
- 버스 정류장·노선·도착·차량은 TAGO
- PostgreSQL 18 + PostGIS에 정적 교통 데이터만 영속 저장
- Docker Compose가 단일 Node API와 PostgreSQL을 관리
- Prometheus는 내부 지표를 수집하고 Alertmanager→relay로 경보 전달
- Cloudflare Tunnel은 `127.0.0.1:3000`으로 연결
- Compose bridge MTU는 NAVER TLS 연결을 위해 1400으로 고정
- 별도 프로세스 관리자를 추가하지 않음
- 운영 도메인은 `https://chimap.madcamp-kaist.org`
- 사용자 검색·위치·추천 요청과 실시간 원문은 영구 저장하지 않음

## 2. 구현 단계

| 단계 | 상태 | 결과 |
| --- | --- | --- |
| 공개 계약 단순화 | 완료 | health 최소화, route source `KAKAO\|TAGO`, 검색 meta |
| 장소·주소 검색 | 완료 | suggest/resolve, 중복 제거, NAVER 보완, 캐시 |
| 역지오코딩 | 완료 | Kakao→NAVER, GPS 좌표 전용 복구 |
| 프런트 검색 UX | 완료 | 300ms, Enter/버튼, AbortSignal, 선택 필수, 중심/주소/출입구 표시 |
| 추천 결과 UX | 완료 | 간략 기본 카드, 이동수단 비중, 자세히/접기, 경로 변경 시 상세 닫힘, 접근성 상태 |
| 지도 | 완료 | NAVER SDK, Kakao 도로 geometry, 승차·환승·하차, 접근 차량 1대, SVG 복구 |
| PostgreSQL/PostGIS | 완료 | migration, COPY, 공간 검색, 정류장번호 정확 병합, transaction |
| TAGO 실제 버스 | 완료 | 정류장·노선·도착·차량, KAIST/대전역 동기화 |
| 추천 | 완료 | 노선 0건 제외, 500m→800m→1.2km 확장, 직행/1회 환승, Kakao 도보·도로 매칭 |
| 개인화 한 걸음 길이 | 완료 | 계정 없이 출생연도·신장·체중·필수 생물학적 성별, `HAN_2026_V1`, localStorage v2 |
| 목표 도보 조정 | 완료 | 실제 TAGO 정류장 순서로 조기 하차 우선, 부족 시 늦은 탑승·양쪽 조합 |
| 목표 기본 선택 | 완료 | 남은 목표가 있으면 GOAL/최접근, 달성 후 FAST |
| Compose 운영 | 완료 | API/DB/Prometheus/Alertmanager/relay healthcheck, MTU 1400 |
| 실제 데이터 import | 완료 | 전국 정류장과 대전 초기 노선 |
| 백업·restore | 완료 | 일일 systemd timer, checksum, 월간 별도 DB 복구 검증 |
| 교통 정기 동기화 | 완료 | KAIST·대전역 45개 노선, 일일 timer, 상태 지표 |
| 모니터링 | 완료 | Prometheus 15초 수집, 20개 경보 규칙, Alertmanager/relay |
| 외부 알림 URL | 사용자 작업 | Alertmanager/relay 배포·형식 검증, 루트 `needs.md`의 webhook 입력 필요 |
| 공개 배포·E2E | 완료 | 검색→추천→지도→저장·반응형 검증 |
| NAVER Secret 재발급 | 완료 | 교체 후 geocode/reverse 200과 번들 미검출 확인 |
| Git 기능 브랜치 | 완료 | 개인화·조기 하차·지도 표현까지 `feat/tago-transit`에 반영 |
| Git 기본 브랜치 | 사용자 작업 | `main` 병합, 수동 공개 E2E와 보호 규칙 설정 |

## 3. 완료된 공개 계약

- `GET /api/v1/health`: `status`, `timestamp`
- `GET /api/v1/readiness`: DB, PostGIS, migration, 공급자, 교통 통계
- `GET /api/v1/places`: `suggest|resolve`, 공급자·전략·성능 저하 meta
- `GET /api/v1/places/reverse`: Place 또는 정상 0건
- `POST /api/v1/recommendations`: baseline, 최대 3개 추천, warning
- 공개 route source: `KAKAO | TAGO`

자세한 필드와 오류 코드는 [API 레퍼런스](./docs/api-reference.md)에
기록합니다.

## 4. 완료 기준 검증

- 검색 버튼과 Enter가 실제 결과를 반환함
- 사용자가 결과를 선택해야 추천 가능
- GPS 주소 확인과 좌표 복구가 동작함
- `stops`, `linkedStops`, `routes`, `routeStops`가 모두 0보다 큼
- `/api/v1/readiness` HTTP 200
- KAIST→대전역 추천이 실제 경로를 반환
- 최초 개인화에서 출생연도·신장·체중·생물학적 성별을 모두 요구하고
  직접 보폭 입력이나 20m 보행 측정 필드를 제공하지 않음
- 원본 개인화 프로필은 브라우저 localStorage v2에만 저장되고 API에는
  파생된 `walkingMetric`만 전달됨
- 조기 하차 후보를 늦은 탑승보다 먼저 조회하며 목표 ±5%를 충족하면
  늦은 탑승 후보를 만들지 않음
- KAIST→대전역 8,000보 검증에서 조기 하차 7,995보, 오차 -5보 반환
- KAIST 본원 중심→대전 갤러리아 추천이 확장 정류장과 실제 승차 도보를
  포함해 반환
- NAVER 지도에 경로가 표시됨
- 버스 선이 TAGO 정류장 순서를 보존하며 실제 도로 굴곡을 따라 표시됨
- 중간 정류장은 숨기고 첫 승차·환승·최종 하차만 표시됨
- 선택한 버스 구간마다 탑승 지점에 접근 중인 차량을 최대 1대만 표시
- 기본 추천 카드에서는 핵심 비교 정보만 표시하고 전체 이동 단계는 사용자가
  `자세히`를 선택한 경로에만 표시
- SDK 장애 시 동일 실제 좌표 SVG가 표시됨
- NAVER geocode/reverse가 운영 컨테이너에서 HTTP 200
- 일일 백업과 별도 PostGIS restore가 실제 통계로 통과
- Prometheus 3개 target `up`, 지표·20개 경보 규칙 정상
- 정기 교통 동기화 45개 성공·0개 실패
- Alertmanager와 relay의 Slack 형식 HTTP 전달 검증
- 외부 운영 채널 전달은 webhook 입력 후 별도 확인
- 타입검사, 테스트, build, 공개 strict E2E 통과
- 기반 commit GitHub CI run `30162100952`의 두 job 통과
- 폐기 대상 용어·변수 내용 검색 0건
- 공개 health 계약과 운영 도메인 정상

## 5. 운영 계획

### 매일

- health/readiness와 컨테이너 health 확인
- systemd timer의 `pg_dump -Fc` 백업 결과와 checksum 확인
- systemd timer의 TAGO 동기화 성공 시각과 실패 노선 확인
- Prometheus에서 검색 0건률, NAVER 보완률, 429/5xx, p95, TAGO timeout 확인

### 매주

- 일간 7개·주간 4개 보존 상태 확인
- route sync 실패 코드와 DB 증가량 검토
- 공급자 쿼터·알림 임계치 검토

### 매월

- systemd timer의 별도 임시 DB restore 검증 결과 확인
- migration checksum, PostGIS, 공간 질의, 네 교통 통계 확인
- 외부 공급자 콘솔의 도메인·IP·API 선택 상태 점검

### 확장 시

- Redis 공유 캐시, single-flight, rate limit 도입
- API 인스턴스 수×pool 크기가 PostgreSQL connection budget을 넘지 않게 조정
- API 컨테이너 수평 확장과 무중단 origin 전환
