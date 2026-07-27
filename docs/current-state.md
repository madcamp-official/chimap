# 구현·운영 현황

이 문서는 구현, 현재 공개 배포와 마지막 전체 운영 점검 시점을 구분합니다.

- **현재 구현**: `feat/mobile/cross-platform-foundation`의 Web/API/Mobile 공통
  계약과 Expo 앱에 더해 migration 9, 요청 범위 버스·지하철 멀티모달 그래프,
  최대 2회 환승, TAGO 시간표 timing과 사전 계산 버스↔지하철 보행 연결을
  포함합니다. 이번 변경은 API 119개 테스트(운영 DB가 없는 실행에서는 DB
  통합 8개 제외), 전체 build와 공개 strict Playwright 3개를 통과했습니다.
- **현재 공개 배포**: 2026-07-27 19:25 KST에 기능 commit `43b71a1`의 이미지
  `sha256:ce1caaca…`로 API/웹을 교체했습니다. `TRANSIT_ROUTER_MODE=multimodal`이며
  공개 KAIST→대전역 요청에서 지하철 단독과 지하철→버스 환승 경로가
  `multimodal-*` ID로 반환됩니다. 검증 보정은 commit `1d0804c`에 기록했습니다.
- **마지막 전체 운영 점검**: 2026-07-27 19:29 KST에 컨테이너, PostgreSQL,
  migration 9, 멀티모달 seed, 공개 HTTPS 추천, NAVER 필수 E2E, 모니터링,
  공개 bundle 비밀값과 배포 후 백업을 대조했습니다.
- **현재 staging**: `compose.staging.yml`의 별도 project와
  `chimap-staging-postgres` volume으로 API/DB를 기동했고 Cloudflare TLS와 local·
  external health HTTP 200을 확인했습니다. guest/Kakao는 활성, Apple은 비활성입니다.
  commit `55fec7c`의 timeout 격리 이미지를 배포하고 버스·지하철 seed를 완료해
  readiness HTTP 200과 KAIST 본원→대전역 추천 3건을 확인했습니다.

따라서 아래의 “구현 완료”는 코드 상태이고, 공개 동작을 뜻하는 항목은
명시적으로 공개 검증 시각을 적습니다. 수시로 바뀌는 운영 수치는 새 배포
검증 때 갱신합니다.

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
- 회원가입 없이 필수 만 나이·신장·체중·생물학적 성별·하루 목표를 받는 개인화
  온보딩과 브라우저 전용 저장·수정·삭제 구현
- 헤더 중앙에 현재 걸음 수정·목표 걸음·개인화 한 걸음 요약을 배치하고,
  767px 이하에서는 두 번째 행 3열로 전환
- 지도 위 검색 패널을 제거하고 출발지·도착지·위치 교환·현재 위치·한 번의
  `건강 경로 찾기` CTA를 왼쪽 탐색 영역에 통합
- 마감시간·추가 허용시간·안전 여유시간과 경로별 걸음 목표 입력을 제거하고
  장소·현재 걸음·목표·프로필 변경 시 이전 추천을 즉시 무효화
- 지도 위 공급자 칩을 제거하고 왼쪽 패널 최하단에 비고정 데이터 제공 안내 배치
- Route Pulse 색상·상태 문법과 실제 요청 기반 경로 추적 진행 표시 적용
- 추천 성공 3회부터 보조 설명만 줄이는 guided/compact 숙련도 적용
- 자동/자세히/간결하게, 시스템 모션/동작 줄이기, 학습 초기화 설정 추가
- 명시적 동의 뒤 strict enum만 204로 집계하는 익명 UI 이벤트 추가
- 헤더의 선택형 카카오 로그인, 로그인 사용자 표시, 로그아웃과 실패·취소
  안내를 추가하고 비회원 핵심 흐름은 그대로 유지

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
- 도착 10분 이하일 때 탑승 정류장에 가장 가까운 접근 차량과 승차~하차
  정류장 순서 안에서 운행 중인 차량을 중복 없이 표시
- `bus_icon.webp` 중앙에 흰 전광판과 검은 노선번호를 겹쳐 NAVER·SVG 지도에서 통일
- 차량 10초 갱신을 경로 overlay와 분리해 사용자 중심·줌과 bounds를 보존
- 전국 지하철역 CSV 1,099행을 자연키 기준 1,097개로 원자적 import
- CSV 지하철역 706개를 TAGO 역 ID에 정확 매핑하고 391개는 임의 fuzzy
  matching 없이 `UNRESOLVED`로 보존
- 지하철 검색·근처 역·TAGO 시간표 기반 다음 출발 API 제공
- 추천 결과에서 출발·도착 2km 내 매핑 역과 상·하행 다음 출발을 조회해
  `TAGO 시간표 기반 예상`으로 표시하며 실제 지연 미반영과 추천시간 미합산을 명시
- 전체 route-ready 지하철 그래프와 요청 출발·도착 주변 버스 노선만 조합해
  버스 단독·지하철 단독·버스→지하철·지하철→버스·버스→지하철→버스를 탐색
- 버스↔지하철 500m 이내 실제 Kakao 보행 경로 182개를 사전 계산하고,
  서비스 승차 전환 기준 최대 2회 환승과 중복 경로 제거 적용
- 버스는 TAGO 도착정보, 지하철은 TAGO 시간표, 없으면 검증된 배차간격을
  사용하며 실제 실시간 여부와 timing source를 구간별 공개

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
- migration 3으로 `app_users`, `oauth_accounts`, `auth_sessions`를 추가
- KAIST 1.2km 3개·대전역 500m 42개 노선 정기 동기화 성공

### 보안·계약

- 환경변수 템플릿을 루트 `.env.example` 하나로 통합
- 브라우저 공개 NAVER Client ID와 서버 Client Secret 분리
- NAVER Client Secret 재발급 후 서버 geocode/reverse와 공개 지도 재검증
- 공개 health와 추천 계약에서 폐기된 실행 형태 필드 제거
- 내장 대체 경로와 외부 실패 시 임의 데이터 전환 제거
- 공개 bundle 서버 비밀값 검사 추가
- OAuth state HMAC, HttpOnly·Secure·SameSite=Lax cookie, hash session 저장
- 카카오 access/refresh token 비저장 경계 적용

## 2. 현재 결론

| 항목 | 상태 |
| --- | --- |
| 공개 도메인 | `https://chimap.madcamp-kaist.org` 정상 |
| API | `chimap:actual-data` (`sha256:ce1caaca…`, 기능 commit `43b71a1`), 단일 Node.js 프로세스, healthy |
| DB | PostgreSQL 18 + PostGIS 3.6, migration 9, healthy |
| 모니터링 | Prometheus 3.13.1, 3개 target `up`, 20개 경보 규칙 정상 |
| 장애 알림 | Alertmanager 0.32.1 + relay healthy, 구성 지표 `0`, 외부 webhook 입력 대기 |
| 외부 진입 | Cloudflare Tunnel→`127.0.0.1:3000` |
| 장소·주소 | Kakao 우선, NAVER 주소 보완 |
| 도보 | Kakao Routing |
| 버스 표시선 | Kakao Mobility Directions 도로 geometry |
| 버스 | TAGO + PostgreSQL 정적 교통 데이터 |
| 프로세스 관리 | Docker Compose |
| 자동화 | 일일 백업·월간 restore·일일 TAGO 동기화 timer active |
| 구현 브랜치 | `feat/mobile/cross-platform-foundation` (`feat/tago-transit` 기반) |
| 마지막 공개 기준선 CI | `965aa88`, push run `30194446016` 당시 Web/API 두 job 성공 |
| foundation CI | push run `30230011225`, Web/API·Mobile JS·iOS·Android·PostGIS 다섯 job 성공 |
| 공개 웹 asset | `index-DVyoPrrl.js`·`index-CQVn3DWd.css`·`bus_icon-DB1cEqjH.webp`(9,464 bytes) |
| 카카오 로그인 | 선택형, `/auth/session` available, authorize 302·보안 state cookie 확인 |
| 모바일 인증 | production 14:29 snapshot은 guest만 enabled, staging 16:48 snapshot은 guest/Kakao enabled·Apple disabled |
| 기본 브랜치 | `main`은 아직 초기 commit, draft PR #1 열림, 병합·보호 규칙 설정 대기 |
| 공개 번들 비밀값 검사 | NAVER·Kakao·TAGO·DB·CHIMap session 서버 비밀값 미검출 |

## 3. readiness 스냅샷

2026-07-27 19:29 KST 공개 재확인 결과:

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
    "stops": 227225,
    "linkedStops": 2844,
    "routes": 140,
    "routeStops": 5794,
    "subwayStations": 1097,
    "activeSubwayStations": 1097,
    "mappedSubwayStations": 706,
    "subwayServiceLines": 46,
    "routeReadySubwayLines": 30,
    "providerMappedStations": 697,
    "busSubwayTransferEdges": 182
  }
}
```

readiness timestamp는 `2026-07-27T10:25:01.783Z`였습니다. 위 JSON에서는
가독성을 위해 timestamp를 생략했습니다. 필수 교통 통계가 준비되고
DB·PostGIS·migration·공급자 키가 준비된 경우에만
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
- 요청 주변 버스 노선과 전체 route-ready 지하철 그래프에서 최대 2회 환승 후보 생성
- 사전 계산한 버스↔지하철 보행 엣지로 버스·지하철 혼합 경로를 한 번에 탐색
- TAGO 도착정보 우선, 없으면 실제 노선의 배차·정류장 정보로 추정
- Kakao 도보 경로를 버스 전후와 운동 구간에 사용
- 만 나이·신장·체중·필수 생물학적 성별로 개인화 한 걸음 길이 추정
- 직접 한 걸음 길이 입력과 20m 보행 측정 없이 localStorage v3 프로필·목표·
  한국 날짜별 현재 걸음 사용
- 기본 경로 도보거리와 남은 목표 거리로 15~90분 자동 추가시간을 계산하고
  자동 범위 밖 후보를 제외
- 목표를 이미 달성한 경우 운동 우회 후보는 만들지 않되, 기본 후보가
  충분하면 빠른·2배 걸음·목표 근접 경로 3개를 제공
- 같은 추천 endpoint에서 간소화 요청과 기존 시간 제약 요청을 strict union으로
  구분하고 기존 요청에는 `Deprecation: true` 응답 header 제공
- 마지막 버스의 조기 하차 후보를 우선하고 부족하면 늦은 탑승·양쪽 조합
- TAGO 정류장 순서를 최대 30개 경유지 단위로 Kakao 도로에 매칭
- 빠른·빠른 경로 대비 약 2배 걸음·목표 근접 최대 3개 추천
- 남은 목표가 있으면 목표에 가장 가까운 추천을 기본 선택
- NAVER 지도에 도로 매칭 경로와 첫 승차·환승·최종 하차만 표시
- 운동 시작 마커를 제거하고 모든 도보 구간을 주황색 실선으로 통일
- 지도는 비선택 0.18, 카드 hover/focus 0.55, 선택 0.95
  불투명도를 사용하고 SVG 복구 지도의 선택 경로는 1.0으로 표시
- 도착 600초 이하 승차 전 최근접 차량 1대와 승차~하차 구간 운행 차량 전체를
  중복 제거해 표시하고, 순서 없음·ETA 초과·하차 통과 차량 제외
- 차량은 `bus_icon.webp` 중앙 흰 전광판 위 검은 노선번호와 상태 title로 표시하고
  지도 bounds 계산에서는 제외
- 차량·도착 10초 갱신은 차량 overlay만 바꾸며 경로와 사용자 중심·줌 보존
- NAVER SDK 장애 시 동일 추천 좌표 SVG 표시
- 첫 방문 3초 인트로와 `prefers-reduced-motion` 처리
- 추천 카드의 이동수단별 시간 비중 막대와 간략 이동수단 순서
- 기본 상태에서는 전체 이동 단계를 숨기고 `자세히`에서 추천 이유·요금·
  승하차 정류장·전체 텍스트 단계 표시
- 카드 선택과 상세 열기를 독립 버튼으로 제공하고
  `aria-pressed/expanded/controls` 적용
- 추천 전체 제한은 20초이며 UI는 가상 단계·퍼센트 없이 실제 요청의 단일
  경로 추적 표시만 사용하고 8초가 넘으면 공급자 지연과 장소 수정 가능성을
  설명
- Route Pulse는 7개 `PlannerUiState`, guided/compact 안내 밀도,
  OS·서비스 모션 축소, 설정 대화상자와 동의 배너를 포함
- 사용자가 허용한 경우에만 strict UI enum을 `/api/v1/ui-events`로 보내고
  PostgreSQL 대신 `chimap_ui_events_total`에 집계

### PostgreSQL/PostGIS

- `schema_migrations`, `bus_stops`, `bus_routes`, `bus_route_stops`
- `subway_station_lines`, 노선·역순서·구간·환승·배차간격과 위치 GiST
- provider 역·방향 매핑, dataset version, transfer build run,
  PostGIS LineString 기반 `bus_subway_transfer_edges`
- migration advisory lock과 SHA-256 checksum 검증
- CSV 임시 테이블/COPY/upsert
- `geography(Point,4326)` + GiST 반경 검색
- 정류장번호 정확 일치 우선, 이후 30m·이름 유사도 기반 CSV↔TAGO 연결
- migration 2에서 기존 정확 일치 중복 1,173쌍과 관계를 원자적으로 병합
- 노선 정류장 전체 교체 transaction과 deadlock 제한 재시도
- graceful shutdown 시 HTTP 종료 후 `pool.end()`

### 선택형 카카오 로그인

- 익명 사용자는 로그인 장애와 무관하게 검색·추천·지도를 계속 이용
- 서버 인가 코드 교환과 `/v2/user/me` 사용자 확인
- 10분 만료 고유 state와 HMAC 서명, constant-time 비교
- 256-bit CHIMap session 원문은 HttpOnly cookie, DB에는 SHA-256 hash만 저장
- 운영 cookie `Secure`, `SameSite=Lax`; 인증 응답 `Cache-Control: no-store`
- 카카오 token·email·전화번호·검색·위치·건강정보 비저장
- 현재 운영 DB의 계정·OAuth·session row는 실제 계정 E2E 전이라 각각 0건

### Cross-platform mobile foundation

- `apps/mobile` 하나에서 iOS·Android 공용 화면·state·API 호출을 관리하고 OS SDK는
  `src/platform`의 adapter로 격리
- environment·OS·사용자 ID hash를 포함한 AsyncStorage/SecureStore namespace로
  Web, iOS, Android와 서로 다른 계정의 자료 충돌 방지
- Zustand RouteStore에 마지막 추천 요청, 선택 route ID/type과 상세 sheet 열림 상태 저장
- 성공한 추천 TanStack Query만 최대 24시간 보존하고 eviction 뒤 즉시 복원
- foreground 복귀 시 온라인·활성·같은 한국 날짜·5분 초과 query만 background refetch
- NAVER iOS/Android Client ID, bundle/package, Kakao scheme와 native 권한 독립 검증
- Health Connect가 설치·허용됐지만 기록이 없으면 Android adapter에서 정상 `0` 반환
- CHIMap access/refresh token family, 120초 rotation grace와 동일 pair 재생,
  grace 만료 재사용 시 해당 mobile family revoke
- Apple authorization code server 교환, 암호화 refresh grant 보관과 앱 내 계정 삭제
- Android SDK 36/minSdk 26/Kotlin 2.1.20 arm64 debug APK compile·v2 서명 검증

생성되는 `apps/mobile/ios`, `android`, `.expo`, `dist`는 CNG/build 산출물이므로 Git에
포함하지 않습니다. 최종 store 완료 조건은 실제 기기 NAVER/Kakao/Apple/health,
process eviction과 TestFlight/Play release E2E입니다.

### Staging Web/API와 iOS 연결

- hostname: `staging.chimap.madcamp-kaist.org`
- Cloudflare origin: `http://127.0.0.1:3001`
- Compose project: `chimap-staging`
- PostgreSQL volume: `chimap-staging-postgres`
- production의 `chimap` project·network·DB volume과 분리
- API image source: `55fec7c`, image `sha256:02971772…`
- database connected, PostGIS·migration current
- Kakao/NAVER/TAGO provider configured
- mobile config: guest/Kakao true, Apple false
- 정류장 227,207개·TAGO 연결 2,144개, 노선 50개·관계 4,178개
- 지하철역 1,097개·TAGO 매핑 706개, readiness 200
- 외부 KAIST 본원→대전역 추천 `FAST/BALANCED/GOAL` 3건 HTTP 200

같은 staging API를 Web, iOS, Android가 사용하므로 server account와 기준 데이터를
공유하되, UI persistence와 token은 environment·OS·user namespace를 유지합니다.
교통 seed와 외부 추천 smoke를 완료했으며 이후 새 지원 지역은 같은 절차로
노선을 점진 동기화합니다.
[staging 환경 운영서](./staging-environment.md)에 기동·적재·중지 절차를
기록합니다.

iOS 로컬 기준은 iOS 17+ iPhone 12 Pro, 390×844pt reference, iPhone-only,
portrait입니다. 첫 내부 TestFlight는 staging bundle에서 guest·HealthKit·Kakao와
refresh/logout/account deletion까지 검증하고 Apple 코드는 유지한 채 server flag로
숨깁니다. 현재 `app.config.ts`의 Light 고정과 built-in deployment target 17.0,
EAS store/preview와 App Store Connect ID는 아직 후속 작업입니다.

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

마지막 전체 로컬·공개 검증은 2026-07-27 code commit `96e2549`와 14:28 KST
Web/API 이미지를 대상으로 합니다. 이후 `7a99e03` 이미지는 production/staging
health까지 확인했으며 전체 회귀·백업 검증은 아직 앞선 snapshot을 기준으로 합니다.

| 검증 | 결과 |
| --- | --- |
| 운영 Web/API 기준선 TypeScript typecheck | 통과 |
| 운영 Web/API 기준선 production build | 통과, Vite JS 약 379KB |
| 운영 Web/API 기준선 계약·API·웹·알림 릴레이·PostGIS 테스트 | 118개 통과(9+63+43+3) |
| 운영 Web/API 기준선 format check | 통과 |
| 운영 Web/API 기준선 로컬 Chromium smoke | 1440/768/390/320px 헤더 충돌·검색 폼·가로 overflow 없음 |
| 최신 현재 코드 검사 | API 104개, builder TypeScript/Web·API build 통과. CI `30250725725`의 Web/API·PostGIS·Mobile JS·iOS simulator·Android 전체 ABI compile 모두 통과 |
| cross-platform build | Web/API production 및 iOS·Android Hermes bundle export 통과 |
| native 생성 설정 | iOS/Android identity·key·entitlement·permission·Privacy Manifest 검증 통과 |
| native compile/실기기 | Android arm64 debug APK compile·v2 서명, GitHub macOS iOS simulator와 Android 전체 ABI compile 통과. iPhone/Android Development Build 검증 대기 |
| PostgreSQL/PostGIS 통합 테스트 | 격리 DB에서 교통·migration 6개와 mobile auth 2개 통과 |
| 공개 strict 지도 E2E | 기본 추천·NAVER 지도·레이아웃 통과. 확장 정류장 1회 upstream 504 후 단독 재실행 통과 |
| 2026-07-27 14:27 KST 공개 strict E2E | 기본 추천·주변 역·NAVER 지도·버스 갱신·카메라 보존과 4개 viewport 통과. 확장 검색은 upstream 일시 실패 후 단독 재실행 통과 |
| TAGO 지하철 공개 API | 대전역 검색·근처 역·U/D 다음 출발, `scheduleBased=true`·`realtimeAvailable=false` 확인 |
| 공개 반응형 Chromium smoke | 로그인 포함 1440/768/390/320px 통과; 768px 겹침 수정 후 재검증 |
| 공개 공급자 회귀 | 전체 실행 중 20초 timeout 후 같은 시나리오 단독 재실행 5.5초 통과 |
| 공개 카카오 인증 smoke | session available, start 302, state cookie 보안 속성, Kakao authorize 302 통과 |
| GitHub Actions | commit `f624e9b`, push run `30230011225`, 다섯 독립 job 성공 |
| 결과 점진 공개 E2E | 기본 닫힘→자세히→경로 변경 닫힘→접기 통과 |
| KAIST→대전역 실제 추천 | 최대 3개 카드 반환 확인 |
| 개인화 8,000보 실제 추천 | 7,995보·목표 오차 -5보·조기 하차 경로를 기본 선택 |
| KAIST 본원 중심→대전 갤러리아 | HTTP 200, 실제 추천 3건·Kakao 승차 도보 확인 |
| 버스 geometry | 도로 vertex가 정류장 수보다 많고 정류장 외 좌표 포함 확인 |
| 지도 교통 마커 | 탑승 1·환승 1·하차 1·중간 정류장 0 육안/E2E 확인 |
| 지도 도보 표현 | 모든 도보 주황색 실선·운동 시작 마커 0·0.18/0.55/0.95 opacity 구현 |
| NAVER 서버 API | Geocoding 200 1건, Reverse Geocoding 200 4건 |
| 차량 마커 E2E | ETA 접근·구간 운행 선별, WebP·흰 전광판·검은 번호·상태 title, 10초 갱신 중 카메라 보존 확인 |
| Prometheus | API/relay/Alertmanager target `up`, 20개 rule healthy |
| 교통 정기 동기화 | 45개 성공·0개 실패, 성공 시각과 실패 수 지표 확인 |
| 정류장 병합 migration | 1,173쌍→0쌍, 관계 유지, migration 2 적용 |
| 알림 릴레이 형식 | 격리 HTTP 수신처에 Slack 형식 긴급 메시지·상태 버튼 전달 |
| 외부 운영 채널 | webhook 미입력, 구성 지표 `0`과 설정 필요 경보 발생 확인 |
| 공개 번들 서버 비밀값 검사 | NAVER·Kakao OAuth·session 비밀값 미검출 |
| 폐기 대상 용어·설정 내용 검색 | 0건 |
| `git diff --check` | code commit과 최신 문서 점검 통과. 원본 CRLF 지하철 CSV는 importer 검증·checksum으로 별도 확인 |

## 6. 백업·복구 기록

2026-07-27 14:28 KST migration 7과 지하철 import·매핑 후 실제 운영 DB의
custom-format 백업을
생성하고 checksum과 전체 복원을 확인했습니다.

```text
파일: /var/backups/chimap/chimap-daily-20260727T052848Z.dump
크기: 17,448,666 bytes
SHA-256: 40fdf6b44cef23f56954f9213e6ac045c3f1dcc19a3404330b0ed063a7acea8c
```

별도 PostgreSQL/PostGIS 18 컨테이너의 `template0` 기반 빈 DB로 restore한
뒤 `PostGIS=1`, `migration=7`, `227225/2844/134/5731` 통계를 다시
확인했습니다. archive 목록에는 `subway_station_lines` table data·sequence·
constraint·index가 모두 포함됩니다. web 계정, mobile token family와 Apple
credential schema까지 복원됩니다. 성공 상태는
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

초기 API 검증에서 host는 NAVER TLS에 연결됐지만 Compose bridge에서
handshake가 timeout 됐습니다. MTU 1400의 별도 bridge에서는 즉시 연결됨을
재현한 뒤 Compose 내부 network에 같은 값을 적용했습니다. 적용 후 geocode
1건과 reverse 4건을 정상 수신했습니다.

Playwright 브라우저 컨테이너의 기본 Docker bridge에서는 별도로 NAVER Web
SDK 주소 연결이 timeout됐지만 운영 키는 bundle과 `.env`가 일치했고 host
직접 요청은 HTTP 200이었습니다. 같은 strict E2E를 `--network host`로
실행해 실제 추천·NAVER 지도 main 흐름이 통과했습니다. 공급자 회귀
시나리오는 전체 실행에서 외부 응답이 20초 timeout된 뒤 단독 재실행에서
5.5초 만에 통과했습니다.

## 8. Git release 상태

애플리케이션·운영 설정·테스트·문서 변경은
`556b484 Complete live routing operations and alerting`에 반영했습니다.
새 checkout의 계약 build와 Compose 검사 환경을 보완한
`bf05003 Fix CI environment preparation`까지 `feat/tago-transit`에
push했습니다.

선택형 카카오 로그인과 태블릿 헤더 보정을 포함한 현재 기능 HEAD는
`965aa88 Add optional Kakao web login`으로 `feat/tago-transit`에
push했습니다. GitHub push CI run `30194446016`과 PR 연동 run
`30194447120`에서 다음 두 job이 모두 성공했습니다.

- `Typecheck, tests, build, config`
- `PostgreSQL and PostGIS integration`

cross-platform foundation은 `feat/tago-transit`의 `b9f7063`에서 분기해 다음 세
commit으로 공통 feature, CI와 계획 문서를 분리했습니다.

- `c7d8c9a feat: add cross-platform mobile foundation`
- `252f1a0 ci: verify mobile platforms independently`
- `633b166 docs: finalize cross-platform rollout plan`

`82e7eca fix: harden mobile lifecycle and native builds`는 foreground persistence
정책, Health Connect 빈 records 회귀, Kotlin/Maven/Gradle 안정화와 OS별 verifier를
추가했습니다. `f624e9b docs: update cross-platform operations`까지 push했고,
GitHub Actions run `30230011225`에서 Web/API quality, Mobile JavaScript, iOS
native, Android native, PostGIS의 다섯 독립 job이 모두 성공했습니다. 같은
commit의 이미지 `sha256:0a2db829…`를 2026-07-27 11:01 KST 공개 승격했습니다.

버스 위치 선별·WebP marker·카메라 보존·TAGO 지하철 적재/시간표 API와 주변 역
UI의 운영 소스는 `96e2549 Add live transit tracking and subway schedules`로
같은 foundation 브랜치에 push했습니다. 동일 소스 이미지
`sha256:f497c9a5…`를 2026-07-27 14:28 KST 공개 승격했습니다.

지하철 routing과 보정 경로의 시간표 metadata 보존은 `052dac6`, `7a99e03`으로
같은 foundation branch에 push했습니다. `7a99e03`의 production image
`sha256:6cbd51c8…`와 staging image `sha256:7befecd1…`를 15:51 KST에 build했고,
production은 15:51, staging은 16:37 KST에 각각 기동했습니다. 16:48 KST 두
공개 hostname의 health HTTP 200을 확인했습니다. staging readiness는 교통 seed
미완료 때문에 503이며 production 전체 회귀·백업 검증 시각은 앞선 14:29 KST
기록과 구분합니다.

기본 브랜치 `main`은 `321ef96`으로 아직 초기 상태이며 보호 설정도 꺼져
있습니다. `feat/tago-transit`→`main` draft PR #1이 열려 있으며, 검토·병합,
병합 후 수동 `Public live E2E`와 foundation 다섯 CI job의 필수 check 지정이
남았습니다.

## 9. 현재 한계와 확장 조건

- staging은 HTTPS/API/auth, 버스·지하철 seed, readiness 200과 외부 실제 추천까지
  준비됐습니다. TAGO timeout으로 보류된 지하철역 3개는 다음 mapping 실행에서
  재시도하며 iPhone 실기기 E2E는 별도 release gate입니다.
- iOS는 CNG/CI 기반이 구현됐지만 iPhone 12 Pro 실기기, Light 고정,
  deployment target 17.0, staging App Store Connect/EAS store profile 검증이
  남았습니다. [iOS 개발 운영서](./ios-development.md)를 release gate로 사용합니다.
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
  [배포 운영서](./deployment.md)의 장애 알림 절차에 따라 webhook을 입력하고
  실제 점검·복구 알림을 확인해야 운영 채널 전달이 활성화됩니다.
- 기존 시간 제약 추천 요청은 전환 릴리스 동안만 유지합니다. 사용 현황과
  downstream 전환을 확인한 뒤 `deadline`, `maxExtraMinutes`,
  `safetyBufferMinutes` 계약과 기존 warning을 제거해야 합니다.
