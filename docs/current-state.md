# 구현·운영 현황

이 문서는 2026-07-25 23:59 KST에 실제 소스, 실행 컨테이너, 공개 도메인,
PostgreSQL, systemd timer와 GitHub Actions를 대조한 배포 스냅샷입니다.
수시로 바뀌는 운영 수치는 새 배포 검증 때 갱신합니다.

## 1. 진행 이력 요약

### UI·도메인

- 지도 중심 검색·추천 화면과 반응형 구조 구현
- 등고선·경로 선·타이포그래피 기반 랜딩 인트로 적용
- 운영 도메인을 `chimap.madcamp-kaist.org`로 확정
- Cloudflare Tunnel과 공개 HTTPS 연결
- NAVER Web Dynamic Map 실제 인증과 경로 overlay 확인
- 추천 카드를 시간·이동수단·도보·환승 중심의 간략 기본 표시로 개편
- 상세 이동 단계는 카드별 `자세히/접기`로만 표시하고 경로 변경 시 자동 닫힘
- 운행 경고를 기본 접힌 안내로 이동하고 상세 열림 상태의 접근성 속성 적용

### 실제 검색·교통

- 검색 버튼과 Enter가 동작하지 않던 입력을 실제 장소 검색 API로 교체
- Kakao keyword/address/reverse와 NAVER geocode/reverse 보완 구현
- GPS 현재 위치와 좌표 전용 복구 구현
- 검색 결과에 캠퍼스 중심·도로명 주소·출입구 좌표 성격 표시
- TAGO 정류장·노선·도착·차량을 추천과 지도에 연결
- KAIST→대전역 직행·환승 관계와 실제 추천 검증
- 운행 노선과 연결 경로가 없을 때 500m→800m→1.2km 정류장 확장 탐색
- KAIST 본원 중심→대전 갤러리아 경로 실패 재현 후 실제 추천 3건으로 수정
- TAGO 정류장 직선 연결을 Kakao 다중 경유지 도로 geometry로 교체
- 지도 버스 마커를 첫 승차·환승·최종 하차만 표시하도록 정리
- 선택 경로와 무관해 보이던 노선 전체 차량 표시를 제거
- 각 버스 구간의 탑승 정류장에 가장 가까이 접근 중인 차량만 최대 1대 표시
- 차량 좌표가 지도 자동 확대 범위를 바꾸지 않도록 분리

### 데이터·운영

- 기존 영속 SQLite DB와 import 대상이 없음을 확인
- SQLite 데이터 복사 없이 PostgreSQL/PostGIS를 새로 구성
- 전국 정류장 CSV와 TAGO로 DB 적재
- API repository와 호출부를 비동기 `pg.Pool`로 전환
- Docker Compose가 API·PostgreSQL 재시작과 health를 관리하도록 통합
- Docker bridge MTU를 1400으로 고정해 NAVER API TLS 연결 안정화
- Prometheus·Alertmanager·외부 알림 릴레이를 Compose에 추가
- 별도 Node 프로세스 관리자는 도입하지 않음
- 일일 DB 백업·월간 restore·일일 TAGO 동기화 systemd timer 설치
- DB custom-format 백업과 별도 restore 시험 완료
- CSV 정류장번호와 TAGO node ID가 같은 1,173쌍을 migration으로 병합
- KAIST 1.2km 3개·대전역 500m 42개 노선 정기 동기화 성공

### 보안·계약

- 환경변수 템플릿을 루트 `.env.example` 하나로 통합
- 브라우저 공개 NAVER Client ID와 서버 Client Secret 분리
- NAVER Client Secret 재발급 후 서버 geocode/reverse와 공개 지도 재검증
- 공개 health와 추천 계약에서 폐기된 실행 형태 필드 제거
- 내장 대체 경로와 외부 실패 시 임의 데이터 전환 제거
- 공개 bundle 서버 비밀값 검사 추가

## 2. 현재 결론

| 항목 | 상태 |
| --- | --- |
| 공개 도메인 | `https://chimap.madcamp-kaist.org` 정상 |
| API | `chimap:actual-data`, 단일 Node.js 프로세스, healthy |
| DB | PostgreSQL 18 + PostGIS 3.6, healthy |
| 모니터링 | Prometheus 3.13.1, 3개 target `up`, 20개 경보 규칙 정상 |
| 장애 알림 | Alertmanager 0.32.1 + relay healthy, 구성 지표 `0`, 외부 webhook 입력 대기 |
| 외부 진입 | Cloudflare Tunnel→`127.0.0.1:3000` |
| 장소·주소 | Kakao 우선, NAVER 주소 보완 |
| 도보 | Kakao Routing |
| 버스 표시선 | Kakao Mobility Directions 도로 geometry |
| 버스 | TAGO + PostgreSQL 정적 교통 데이터 |
| 프로세스 관리 | Docker Compose |
| 자동화 | 일일 백업·월간 restore·일일 TAGO 동기화 timer active |
| GitHub | `feat/tago-transit`, 구현 기준 CI run `30162100952` 두 job 성공 |
| 기본 브랜치 | `main`은 아직 초기 commit, 병합·보호 규칙 사용자 작업 |
| 공개 번들 비밀값 검사 | NAVER 서버 Client Secret 미검출 |

## 3. readiness 스냅샷

최종 공개 검증 결과:

```json
{
  "status": "ready",
  "database": {
    "connected": true,
    "postgis": true,
    "migrationsCurrent": true
  },
  "providers": {
    "kakao": true,
    "naver": true,
    "tago": true
  },
  "transit": {
    "stops": 227187,
    "linkedStops": 2741,
    "routes": 134,
    "routeStops": 5535
  }
}
```

`timestamp`는 호출마다 바뀌므로 스냅샷에서 생략했습니다. 네 교통 통계가
모두 0보다 크고 DB·PostGIS·migration·공급자 키가 준비된 경우에만
readiness가 HTTP 200을 반환합니다. 추천 요청과 정기 동기화가 새 실제
노선을 저장하므로 이 수치는 백업 시점보다 증가할 수 있습니다.

## 4. 완료된 구현

### 검색과 위치

- `suggest`: Kakao keyword→Kakao address→NAVER geocode
- `resolve`: Kakao keyword/address 병렬 호출→병합→NAVER geocode
- 동일 주소이면서 좌표 20m 이내인 결과 중복 제거
- 정확한 장소명·주소 일치 우선, 중심 좌표 거리 정렬
- 성공 10분, 0건 60초, 역지오코딩 24시간 메모리 캐시
- 동일 요청 single-flight
- 300ms 자동완성, Enter, 검색 버튼, 이전 요청 취소
- 검색 결과의 사용자 선택 필수
- GPS 역지오코딩과 좌표 전용 복구

### 추천과 지도

- 출발·도착 500m에서 시작해 실제 연결 경로가 없으면 800m, 최대
  1.2km까지 정류장 탐색
- 노선 0건 정류장은 승하차 후보에서 제외
- 직행 또는 최대 1회 환승 버스 후보 생성
- TAGO 도착정보 우선, 없으면 실제 노선의 배차·정류장 정보로 추정
- Kakao 도보 경로를 버스 전후와 운동 구간에 사용
- TAGO 정류장 순서를 최대 30개 경유지 단위로 Kakao 도로에 매칭
- 빠른·균형·목표 달성 최대 3개 추천
- NAVER 지도에 도로 매칭 경로와 첫 승차·환승·최종 하차만 표시
- 선택한 각 버스 구간에서 탑승 정류장에 가장 가까이 접근 중인 차량 최대 1대
- 차량은 노선번호 중심의 작은 마커로 표시하고 지도 bounds 계산에서는 제외
- NAVER SDK 장애 시 동일 추천 좌표 SVG 표시
- 첫 방문 3초 인트로와 `prefers-reduced-motion` 처리
- 추천 카드의 이동수단별 시간 비중 막대와 간략 이동수단 순서
- 기본 상태에서는 전체 이동 단계를 숨기고 `자세히`에서 추천 이유·요금·
  승하차 정류장·전체 텍스트 단계 표시
- 카드 선택과 상세 열기를 독립 버튼으로 제공하고
  `aria-pressed/expanded/controls` 적용
- 추천 전체 제한은 20초이며 8초가 넘으면 실제 버스 응답을 더 확인 중임을
  진행 화면에서 설명

### PostgreSQL/PostGIS

- `schema_migrations`, `bus_stops`, `bus_routes`, `bus_route_stops`
- migration advisory lock과 SHA-256 checksum 검증
- CSV 임시 테이블/COPY/upsert
- `geography(Point,4326)` + GiST 반경 검색
- 정류장번호 정확 일치 우선, 이후 30m·이름 유사도 기반 CSV↔TAGO 연결
- migration 2에서 기존 정확 일치 중복 1,173쌍과 관계를 원자적으로 병합
- 노선 정류장 전체 교체 transaction과 deadlock 제한 재시도
- graceful shutdown 시 HTTP 종료 후 `pool.end()`

### 운영

- PostgreSQL host port 미노출
- API만 `127.0.0.1:3000`에 bind
- Prometheus UI만 `127.0.0.1:9090`에 bind하고 API metrics 9091은 host 미노출
- API, PostgreSQL, Prometheus, Alertmanager와 alert-relay healthcheck
- 15초 간격 수집, 15일·2GiB 보존
- HTTP 상태·p95, 검색 0건·NAVER 보완, 추천, DB pool, TAGO timeout,
  공급자 설정, 교통 통계, 백업·동기화·알림 전달 상태 지표
- availability·품질·백업·동기화·알림 전달에 대한 20개 경보 규칙
- Alertmanager가 critical/warning을 묶어 relay로 전달하고 복구 알림도 전송
- 일일 백업, 월간 restore 검증과 일일 01:30 KST TAGO 동기화 timer
- 이전 실행 컨테이너와 이전 CHIMap 태그 정리
- 공개 도메인에서 실제 검색·추천·NAVER 지도 E2E 통과

## 5. 검증 기록

| 검증 | 결과 |
| --- | --- |
| TypeScript typecheck | 통과 |
| production build | 통과 |
| 계약·API·웹·알림 릴레이 테스트 | 71개 통과 |
| PostgreSQL/PostGIS 통합 테스트 | 5개 통과 |
| 공개 strict 지도 E2E | 2개 통과 |
| GitHub Actions | 구현 기준 run `30162100952`, 품질·PostGIS 두 job 성공 |
| 결과 점진 공개 E2E | 기본 닫힘→자세히→경로 변경 닫힘→접기 통과 |
| KAIST→대전역 실제 추천 | 최대 3개 카드 반환 확인 |
| KAIST 본원 중심→대전 갤러리아 | HTTP 200, 실제 추천 3건·Kakao 승차 도보 확인 |
| 버스 geometry | 도로 vertex가 정류장 수보다 많고 정류장 외 좌표 포함 확인 |
| 지도 교통 마커 | 탑승 1·환승 1·하차 1·중간 정류장 0 육안/E2E 확인 |
| NAVER 서버 API | Geocoding 200 1건, Reverse Geocoding 200 4건 |
| 차량 마커 E2E | 마커 수≤선택 버스 구간 수, 탑승 접근 차량 title 확인 |
| Prometheus | API/relay/Alertmanager target `up`, 20개 rule healthy |
| 교통 정기 동기화 | 45개 성공·0개 실패, 성공 시각과 실패 수 지표 확인 |
| 정류장 병합 migration | 1,173쌍→0쌍, 관계 유지, migration 2 적용 |
| 알림 릴레이 형식 | 격리 HTTP 수신처에 Slack 형식 긴급 메시지·상태 버튼 전달 |
| 외부 운영 채널 | webhook 미입력, 구성 지표 `0`과 설정 필요 경보 발생 확인 |
| 공개 번들 서버 비밀값 검사 | 미검출 |
| 폐기 대상 용어·설정 내용 검색 | 0건 |
| `git diff --check` | 통과 |

## 6. 백업·복구 기록

2026-07-25 자동화 스크립트로 실제 운영 DB의 custom-format 백업을 생성하고
checksum을 확인했습니다.

```text
파일: /var/backups/chimap/chimap-daily-20260725T141917Z.dump
크기: 17,337,137 bytes
SHA-256: e064e44f483960240596a0e4461829baba7e6c9d920ed3130ea322259a8c6b81
```

별도 PostgreSQL/PostGIS 18 컨테이너의 `template0` 기반 빈 DB로 restore한
뒤 `PostGIS=1`, `migration=2`, `227184/2659/131/5411` 통계를 다시
확인했습니다. 이는 14:19 UTC 백업 시점의 고정 통계이며, 23:59 KST 현재
readiness의 `227187/2741/134/5535`와 구분합니다. 성공 상태는
`/var/backups/chimap/latest.json`과 `restore-latest.json`에 기록합니다.

설치된 timer:

```text
chimap-backup.timer         매일 03:15 KST + 최대 15분 분산
chimap-backup-verify.timer  매월 1일 04:30 KST + 최대 30분 분산
chimap-transit-sync.timer   매일 01:30 KST + 최대 30분 분산
```

## 7. NAVER 보안·네트워크 검증

과거 노출 가능성이 있던 서버 Client Secret은 운영자가 재발급했고 새 값으로
API를 다시 배포했습니다. 운영 컨테이너에서 알려진 주소 geocode와 KAIST
좌표 reverse가 각각 HTTP 200을 반환했으며, strict Web Dynamic Map E2E와
공개 번들 서버 비밀값 미검출도 통과했습니다.

초기 검증에서 host는 NAVER TLS에 연결됐지만 Docker bridge에서 handshake가
timeout 됐습니다. MTU 1400의 별도 bridge에서는 즉시 연결됨을 재현한 뒤
Compose 내부 network에 같은 값을 적용했습니다. 적용 후 geocode 1건과
reverse 4건을 정상 수신했습니다.

## 8. Git release 상태

애플리케이션·운영 설정·테스트·문서 변경은
`556b484 Complete live routing operations and alerting`에 반영했습니다.
새 checkout의 계약 build와 Compose 검사 환경을 보완한
`bf05003 Fix CI environment preparation`까지 `feat/tago-transit`에
push했습니다.

GitHub CI run `30162100952`에서 다음 두 job이 모두 성공했습니다.

- `Typecheck, tests, build, config`
- `PostgreSQL and PostGIS integration`

감사 시점의 로컬·원격 기능 브랜치 SHA는 일치했고 작업 트리는
clean이었습니다. 기본 브랜치 `main`은 `321ef96`으로 아직 초기 상태이며
보호 설정도 꺼져 있습니다. 병합, 병합 후 수동 `Public live E2E`, 필수
check 지정은 [사용자 작업](../needs.md)에 기록했습니다.

## 9. 현재 한계와 확장 조건

- 전국 정류장은 적재했지만 노선과 노선-정류장 관계는 사용 지역을 중심으로
  점진적으로 동기화합니다.
- API는 프로세스 로컬 캐시와 rate limit을 사용하므로 단일 인스턴스로
  운영합니다.
- 수평 확장 시 Redis 기반 공유 캐시·single-flight·rate limit과 DB
  connection budget 재설계가 선행되어야 합니다.
- 검색과 추천 성능은 외부 공급자 지연의 영향을 받으므로 p95와 공급자별
  timeout을 함께 관찰해야 합니다.
- 정류장 탐색은 최대 1.2km와 1회 환승까지만 지원하므로 이 범위 밖의
  연결은 구체적인 위치 선택 안내 또는 연결 범위 안내와 함께 404가 됩니다.
- Alertmanager와 relay는 배포됐지만 외부 webhook URL은 아직 비어 있습니다.
  Alertmanager 라우팅 설정과 relay 메시지 형식은 격리 수신처로 검증됐고
  `ChimapAlertDeliveryNotConfigured` 경보가 의도대로 발생 중입니다.
  [사용자 작업](../needs.md)의 1번을 완료해야 실제 운영 채널 전달이
  활성화됩니다.
