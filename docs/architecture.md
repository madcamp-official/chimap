# 시스템 아키텍처

## 1. 운영 토폴로지

```text
Browser
  ├─ NAVER Web Dynamic Map SDK
  ├─ localStorage/sessionStorage
  └─ HTTPS /api/v1
       ↓
Cloudflare Tunnel
       ↓ 127.0.0.1:3000
Docker Compose
  ├─ chimap-api
  │    Node.js 24 / Express 5 / 단일 프로세스
  │    └─ :9091 내부 metrics
  ├─ chimap-postgres
  │    PostgreSQL 18 / PostGIS 3.6 / named volume
  ├─ chimap-prometheus
  │    15초 수집 / 15일·2GiB / named volume
  ├─ chimap-alertmanager
  │    경보 그룹·억제·재전송 / 120시간 보존
  └─ chimap-alert-relay
       Slack·Discord·일반 webhook 형식 변환

systemd
  ├─ chimap-backup.timer
  ├─ chimap-backup-verify.timer
  └─ chimap-transit-sync.timer
```

PostgreSQL 5432는 host에 공개하지 않습니다. Cloudflare Tunnel origin은
API의 loopback 포트만 사용합니다. API metrics 9091은 Compose 내부에서만
접근하고 Prometheus 9090은 host loopback에만 공개합니다. Docker bridge
MTU는 NAVER TLS 경로의 handshake 안정성을 위해 1400으로 고정합니다.
Alertmanager 9093도 host loopback에만 공개하고 relay는 host port를
노출하지 않습니다.

## 2. 애플리케이션 컴포넌트

```text
React Web
  ├─ IntroSequence
  ├─ WalkingProfileDialog
  │    필수 출생연도/신장/체중/생물학적 성별
  ├─ PlaceCombobox                │
  │    캠퍼스 중심/주소/출입구    │
  ├─ GoalForm                     │
  ├─ RecommendationCard          │ HTTPS
  ├─ RouteDetails                │
  └─ MapView                     │
                                  ↓
Express API
  ├─ PlaceLookupService
  │    ├─ KakaoLocalClient
  │    ├─ NaverGeocodingClient
  │    └─ MemoryCache + single-flight
  │
  ├─ RecommendationService
  │    ├─ CandidateGenerator
  │    ├─ RecommendationEngine
  │    └─ CachedMobilityProvider
  │         └─ TagoTransitMobilityProvider
  │              ├─ Kakao walking
  │              ├─ Kakao road geometry
  │              └─ TransitService
  │                   ├─ TAGO client
  │                   └─ TransitRepository
  │
  ├─ AppMetrics
  │    ├─ HTTP·검색·추천·오류
  │    ├─ DB pool·교통 통계·공급자 설정
  │    └─ 백업·교통 동기화 상태 파일
  └─ PostgreSQL Pool
```

외부 응답은 provider 경계에서 Zod로 검증하고 WGS84 내부 모델로
정규화합니다. API 응답도 공유 계약 패키지로 다시 검증합니다.

## 3. 검색 시퀀스

### 자동완성

```text
입력 300ms
  → GET /api/v1/places?scope=suggest
  → Kakao keyword
      ├─ 결과 있음: 반환
      └─ 0건/복구 가능한 장애
           → Kakao address
              ├─ 결과 있음: 반환
              └─ 0건/복구 가능한 장애
                   → NAVER geocode
```

### 명시 검색

```text
Enter/검색 버튼
  → GET /api/v1/places?scope=resolve
  → Kakao keyword + address 병렬
  → 병합·20m 중복 제거·정렬
      ├─ 결과 있음: 반환
      └─ 최종 0건/복구 가능한 장애: NAVER geocode
```

Kakao/NAVER의 400·401·403 설정 오류는 보완으로 숨기지 않습니다. 외부 공급자
자체 장애가 발생하면 정상 0건과 구분된 API 오류를 반환합니다.

## 4. 추천 시퀀스

```text
RecommendationRequest
  → 브라우저 프로필로 HAN_2026_V1 한 걸음 길이 계산
  → 원본 프로필을 제외한 walkingMetric 전송
  → 입력·마감·거리 검증
  → 출발/도착 500m PostGIS 주변 정류장 + 운행 노선 확인
  → 연결 경로 없음: 800m → 최대 1.2km 단계 확장
  → 노선 0건 정류장 제외
  → 직행 후보, 필요 시 최대 1회 환승 후보
  → TAGO 도착정보 + 노선 정류장 순서
  → Kakao 도보 구간 + 버스 도로 매칭 geometry
  → baseline이 목표 ±5% 밖이면 실제 TAGO 정류장 순서로 운동 후보 생성
       ├─ 마지막 버스 조기 하차 상위 4개 우선
       ├─ 범위 내 후보 없음: 첫 버스 늦은 탑승 상위 2개
       └─ 여전히 없음: 늦은 탑승+조기 하차 조합 상위 1개
  → 마감/추가시간 필터
  → 중복 제거
  → FAST/BALANCED/GOAL 선택
  → 남은 목표가 있으면 GOAL을 primaryRecommendationId로 지정
  → RecommendationResponse
```

추천 전체 timeout은 20초입니다. 후보 생성기 기준 대중교통 경로 호출은
1회, 조정 도보 호출은 최대 8회로 합계 최대 9회이며 동시성은 3입니다.
조기 하차 후보가 목표 범위에 들어오면 늦은 탑승과 양쪽 조합 호출은
생략합니다.

## 5. 데이터 저장 경계

### PostgreSQL에 저장

- 전국 공개 버스 정류장
- CSV 정류장과 TAGO `(cityCode,nodeId)` 연결
- TAGO 노선 기본정보
- 노선별 정류장 순서
- migration version/name/checksum

### PostgreSQL에 저장하지 않음

- 검색어와 장소 검색 결과
- GPS·출발지·목적지
- 걸음 수·목표·마감시간
- 출생연도·신장·체중·생물학적 성별 원본 프로필
- 추천 요청·응답
- 실시간 버스 도착과 차량 위치
- 공급자 원문과 API 키

검색·경로·실시간 자료는 프로세스 메모리 TTL 후 제거합니다. 개인화 걸음
프로필과 사용자 환경설정은 브라우저 localStorage version 2 계약으로만
저장하고, API에는 `stepLengthMeters`, `RESEARCH_ESTIMATE`,
`HAN_2026_V1`로 구성된 파생 `walkingMetric`만 전달합니다. version 1
선호는 읽기 호환만 유지하고 개인화 온보딩을 다시 요구하며, 새 저장은
version 2만 사용합니다. 인트로 완료 상태는 sessionStorage에 저장합니다.

## 6. 캐시와 동시성

| 항목 | TTL |
| --- | --- |
| 장소 검색 성공 | 10분 |
| 장소 검색 정상 0건 | 60초 |
| 역지오코딩 | 24시간 |
| TAGO 주변 정류장 | 기본 300초 |
| TAGO 노선·노선 정류장 | 기본 24시간 |
| TAGO 도착 | 기본 20초 |
| TAGO 차량 | 기본 10초 |
| Kakao 도보 | 30분 |
| Kakao 버스 도로 geometry | 24시간 |

같은 key의 진행 중 요청은 하나의 Promise를 공유합니다. 캐시와 IP rate
limit은 프로세스 로컬이므로 현재 API는 단일 인스턴스로 운영합니다.

## 7. 장애 모델

- Kakao Local 복구 가능 장애: NAVER 주소 보완
- 주소 공급자 모두 정상 0건: 빈 결과 또는 `place: null`
- 자격 증명·API 선택 오류: HTTP 503 `SERVICE_NOT_READY`
- 공급자 timeout: HTTP 504 `UPSTREAM_TIMEOUT`
- 공급자 사용량 제한: HTTP 429 `UPSTREAM_RATE_LIMIT`
- TAGO 일부 실시간 실패: 정적 실제 경로가 있으면 warning과 함께 계속
- 확장 범위 내 운행 정류장 없음: 위치 구체화 안내와 `NO_TRANSIT_ROUTE`
- 운행 정류장은 있으나 직행/1회 환승 연결 없음: 연결 범위 안내와
  `NO_TRANSIT_ROUTE`
- 지도 SDK 실패: 추천 응답은 유지하고 실제 좌표 SVG 표시
- PostgreSQL/readiness 실패: 신규 배포 origin 승격 금지

서버 로그에는 request ID, path, provider, strategy, count, duration, status와
안전한 result code만 기록합니다. 검색어·좌표·키·원문은 기록하지 않습니다.

## 8. 종료와 재시작

Docker Compose가 `unless-stopped` 정책으로 API, DB, Prometheus,
Alertmanager와 relay를 재시작합니다. API는 SIGTERM/SIGINT를 받으면 사용자 HTTP와 metrics
server의 새 연결을 중단하고 최대 10초 안에 기존 요청을 정리한 뒤
PostgreSQL pool을 닫습니다.

별도 프로세스 관리자를 두지 않아 Compose와 애플리케이션의 재시작·로그·종료
책임이 겹치지 않습니다.

## 9. 백업과 모니터링

- 일일 백업은 `pg_dump -Fc`, archive 목록 검증, SHA-256 기록을 원자적으로
  수행합니다.
- 일간 7개와 일요일 주간 4개를 보존합니다.
- 월간 복구 시험은 최신 checksum을 먼저 검증하고 별도 PostGIS 18
  컨테이너의 `template0` 기반 빈 DB에 복원합니다.
- 일일 교통 갱신은 KAIST 1.2km와 대전역 500m의 실제 노선·정류장 순서를
  다시 받고 원자적 상태 파일에 성공 시각과 실패 노선을 기록합니다.
- Prometheus는 HTTP 상태·처리시간, 검색 전략·0건·보완, 추천 결과, 안전한
  오류 분류, DB pool, 정적 교통 row, 공급자 설정, 백업·동기화와 알림 전달
  상태를 수집합니다.
- label에는 검색어, 좌표, 차량번호, node/route ID, 키와 원문을 넣지
  않습니다.
- 20개 경보 규칙은 availability, API 품질, 백업, 교통 동기화와 알림 전달
  상태를 평가합니다.
- Alertmanager는 긴급 경보를 10초, 주의 경보를 30초 동안 묶은 뒤 relay로
  보내며 복구 상태도 전달합니다. relay는 비밀 URL을 runtime에만 읽고
  메시지에 경보명·요약·조치 설명·상태 확인 링크를 제공합니다.
- 외부 URL이 없을 때 relay health는 내부 수신 가능 상태를 유지하되
  `chimap_alert_relay_configured=0`을 노출합니다. Prometheus는 이를
  `ChimapAlertDeliveryNotConfigured`로 표시하며, 전달 실패 횟수에는
  포함하지 않아 경보가 자기 자신을 증폭하지 않게 합니다.

## 10. PM2를 사용하지 않는 이유

현재 구조에 PM2 cluster를 추가하면 worker마다 메모리 캐시, single-flight와
IP rate limit이 분리됩니다. 그 결과 같은 Kakao/NAVER/TAGO 호출이 중복될
수 있고 worker 수만큼 PostgreSQL pool connection이 늘어납니다. Docker와
PM2가 재시작·로그·graceful shutdown을 동시에 관리하는 문제도 생깁니다.

따라서 현재는 Docker Compose의 단일 Node 프로세스를 유지합니다. 다중
인스턴스가 필요해질 때 PM2 cluster가 아니라 공유 상태를 먼저 도입하고 API
컨테이너를 수평 확장합니다.

## 11. 수평 확장 전제

1. Redis 기반 공유 캐시와 single-flight
2. Redis 또는 gateway 기반 공유 rate limit
3. API 인스턴스 수를 반영한 PostgreSQL connection budget
4. 공급자 전체 호출 예산과 회로 차단
5. 여러 API 컨테이너를 향하는 origin/load balancer

이 조건을 갖춘 뒤 API 컨테이너를 수평 확장합니다.
