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
  │
  └─ chimap-postgres
       PostgreSQL 18 / PostGIS 3.6 / named volume
```

PostgreSQL 5432는 host에 공개하지 않습니다. Cloudflare Tunnel origin은
API의 loopback 포트만 사용합니다.

## 2. 애플리케이션 컴포넌트

```text
React Web
  ├─ IntroSequence
  ├─ PlaceCombobox ───────────────┐
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
  │              └─ TransitService
  │                   ├─ TAGO client
  │                   └─ TransitRepository
  │
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
  → 입력·마감·거리 검증
  → 출발/도착 500m PostGIS 주변 정류장
  → 저장된 TAGO 노선 또는 필요 시 TAGO 조회
  → 직행 후보, 필요 시 최대 1회 환승 후보
  → TAGO 도착정보 + 노선 정류장 순서
  → Kakao 도보 구간
  → 마감/추가시간 필터
  → 중복 제거
  → FAST/BALANCED/GOAL 선택
  → RecommendationResponse
```

추천 전체 timeout은 15초이며 대중교통 호출은 최대 5회, 도보 호출은 최대
4회, 합계 최대 9회입니다. 후보 호출 동시성은 3입니다.

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
- 추천 요청·응답
- 실시간 버스 도착과 차량 위치
- 공급자 원문과 API 키

검색·경로·실시간 자료는 프로세스 메모리 TTL 후 제거합니다. 사용자 환경설정
일부는 브라우저 localStorage에 versioned 계약으로 저장하고, 인트로 완료
상태는 sessionStorage에 저장합니다.

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
| 정류장명 해석 | 6시간 |

같은 key의 진행 중 요청은 하나의 Promise를 공유합니다. 캐시와 IP rate
limit은 프로세스 로컬이므로 현재 API는 단일 인스턴스로 운영합니다.

## 7. 장애 모델

- Kakao Local 복구 가능 장애: NAVER 주소 보완
- 주소 공급자 모두 정상 0건: 빈 결과 또는 `place: null`
- 자격 증명·API 선택 오류: HTTP 503 `SERVICE_NOT_READY`
- 공급자 timeout: HTTP 504 `UPSTREAM_TIMEOUT`
- 공급자 사용량 제한: HTTP 429 `UPSTREAM_RATE_LIMIT`
- TAGO 일부 실시간 실패: 정적 실제 경로가 있으면 warning과 함께 계속
- 지도 SDK 실패: 추천 응답은 유지하고 실제 좌표 SVG 표시
- PostgreSQL/readiness 실패: 신규 배포 origin 승격 금지

서버 로그에는 request ID, path, provider, strategy, count, duration, status와
안전한 result code만 기록합니다. 검색어·좌표·키·원문은 기록하지 않습니다.

## 8. 종료와 재시작

Docker Compose가 `unless-stopped` 정책으로 API와 DB를 재시작합니다. API는
SIGTERM/SIGINT를 받으면 새 HTTP 연결을 중단하고 최대 10초 안에 기존 요청을
정리한 뒤 PostgreSQL pool을 닫습니다.

별도 프로세스 관리자를 두지 않아 Compose와 애플리케이션의 재시작·로그·종료
책임이 겹치지 않습니다.

## 9. PM2를 사용하지 않는 이유

현재 구조에 PM2 cluster를 추가하면 worker마다 메모리 캐시, single-flight와
IP rate limit이 분리됩니다. 그 결과 같은 Kakao/NAVER/TAGO 호출이 중복될
수 있고 worker 수만큼 PostgreSQL pool connection이 늘어납니다. Docker와
PM2가 재시작·로그·graceful shutdown을 동시에 관리하는 문제도 생깁니다.

따라서 현재는 Docker Compose의 단일 Node 프로세스를 유지합니다. 다중
인스턴스가 필요해질 때 PM2 cluster가 아니라 공유 상태를 먼저 도입하고 API
컨테이너를 수평 확장합니다.

## 10. 수평 확장 전제

1. Redis 기반 공유 캐시와 single-flight
2. Redis 또는 gateway 기반 공유 rate limit
3. API 인스턴스 수를 반영한 PostgreSQL connection budget
4. 공급자 전체 호출 예산과 회로 차단
5. 여러 API 컨테이너를 향하는 origin/load balancer

이 조건을 갖춘 뒤 API 컨테이너를 수평 확장합니다.
