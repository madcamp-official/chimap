# 구현·운영 현황

이 문서는 구현, 현재 공개 배포와 마지막 전체 운영 점검 시점을 구분합니다.

- **현재 구현**: Web/API/Mobile 공통 계약과 Expo 앱, migration 13, 요청 범위
  버스·지하철 멀티모달 그래프, 실제 지하철 선로, 버스 도로 형상 영속 캐시,
  검토된 공원 경로 snapshot, 선택 결과 geometry와 Valhalla 상세 도보 공급자를
  포함합니다. 2026-07-30 merged tree에서 결정적 테스트 450개와 격리 PostGIS
  통합 테스트 12개, 총 462개가 통과했습니다. workspace typecheck·format
  check·Web/API/Mobile build·native config와 staging public E2E도 통과했고,
  최종 SHA의 CI와 production 배포 결과는 아직 release record로 확정하지 않았습니다.
- **현재 공개 배포**: 2026-07-30 감사 기준 production API는 code
  `d268e067`, image `sha256:200346ac…`, migration 13입니다.
  `TRANSIT_ROUTER_MODE=multimodal`, transit geometry·phased timeout·selected
  geometry·bus pair v3 flag가 활성화되어 있습니다. 상세 도보는 아직 Kakao이고
  공원 import endpoint는 활성 상태지만 dataset 0건·GOAL integration 비활성입니다.
- **2026-07-30 운영 점검**: production과 staging의 local·public
  health/readiness/mobile-config가 모두 HTTP 200이고, production monitoring의
  target 3개가 `up`, 25개 rule이 healthy, firing alert가 0건임을 확인했습니다.
  수정된 rate-limit rule 식은 최종 승격 때 Prometheus reload 후 다시 확인합니다.
- **현재 staging**: `compose.staging.yml`의 별도 project와
  `chimap-staging-postgres` volume에서 code `21251280`, image
  `sha256:1b8e8cae…`, migration 13을 실행합니다. `WALKING_ROUTER=VALHALLA`,
  공원 integration 활성, import 비활성 상태이며 active dataset 152건과
  `VALHALLA_WALK` 상세 도보를 확인했습니다.
- **최종 `main` release 상태**: 최종 SHA 확정·전체 release 검증·production
  승격 전입니다. 최종 SHA, image ID, PostGIS/build/CI와 배포 시각은 실제 gate
  통과 뒤 이 문서에 append하며 pre-release 후보를 배포 완료로 표현하지 않습니다.

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
- 회원가입 없이 필수 만 나이·신장·체중·생물학적 성별을 받고 연령별 논문 근거
  첫 목표(18~59세 8,000, 60~90세 7,000)를 자동 적용하는 개인화 온보딩과
  브라우저 전용 저장·수정·삭제 구현. 저장된 사용자 목표는 수정 화면에서 보존
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
- Web·iOS·Android 헤더는 주황·흰색·초록 중심의 같은 브랜드 PNG를 각 플랫폼의
  `images` 폴더에서 사용하고, favicon은 Web 이미지 폴더의 `app-icon.png`, 모바일
  지도 bitmap은 지도 모듈의 `images`에 둠
- 모바일 도착시각은 실행 OS나 CI 시간대와 무관하게 `Asia/Seoul`로 표시

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
- 지도 여정 마커를 출발·환승·도착만 표시하도록 정리하고 개별 승하차 반복 제거
- 선택 경로와 무관해 보이던 노선 전체 차량 표시를 제거
- 도착 10분 이하일 때 탑승 정류장에 가장 가까운 접근 차량과 승차~하차
  정류장 순서 안에서 운행 중인 차량을 중복 없이 표시
- 별도 버스 bitmap 대신 Web CSS와 native view로 차량을 그리고 공용 방위 계산으로
  진행 방향을 회전하며 GPS 미세 흔들림에는 직전 방향을 유지
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
| API | `chimap:actual-data` (`sha256:200346ac…`, code `d268e067`), 단일 Node.js 프로세스, healthy |
| DB | PostgreSQL 18 + PostGIS 3.6, migration 13, healthy |
| 모니터링 | Prometheus 3.13.1, 3개 target `up`, 25개 경보 규칙 healthy, firing 0 |
| 장애 알림 | Alertmanager 0.32.1 + relay healthy, `EXTERNAL_ALERTS_ENABLED=0`으로 외부 전달 명시적 비활성화 |
| 외부 진입 | Cloudflare Tunnel→`127.0.0.1:3000` |
| 장소·주소 | Kakao 우선, NAVER 주소 보완 |
| 도보 | production Kakao, staging Valhalla. 상세 공급자 실패 시 흐린 점선 근사 경로 |
| 검토 공원 경로 | production import 활성·0건·integration 비활성, staging import 비활성·active 152건·integration 활성 |
| 버스 표시선 | 인접 정류장별 검증·캐시한 Kakao 도로 geometry, 실패 구간 점선 fallback |
| 지하철 표시선 | migration 10 선로 LineString, `track-v1`·`transit-v2`에서 실제 선형 |
| 버스 | TAGO + PostgreSQL 정적 교통 데이터 |
| 서울 지하철 실시간 | 공식 HTTP endpoint 활성화, 도착·위치 API 정상, 추천은 실시간→TAGO 시간표→headway 순서 |
| 프로세스 관리 | Docker Compose |
| 자동화 | 일일 백업·월간 restore·일일 TAGO 동기화 timer active |
| 최종 통합 후보 | pre-release. 최종 `main` SHA·CI·image·배포 기록은 gate 통과 뒤 확정 |
| 마지막 공개 기준선 CI | PR #5 run `30417960322`, Web/API·Mobile JS·iOS·Android·PostGIS 다섯 job 성공 |
| favicon cache 보완 CI | PR #6 run `30419501614`, Web/API·Mobile JS·PostGIS 성공 후 병합 |
| 공개 웹 asset | 현재 production asset 제공 중. 최종 release bundle·logo hash는 승격 뒤 기록 |
| 카카오 로그인 | 선택형, `/auth/session` available, authorize 302·보안 state cookie 확인 |
| 모바일 인증 | staging server는 guest/Kakao enabled·Apple disabled, 현재 iOS 앱 화면은 Kakao session 필수 |
| 기본 브랜치 | `main`에 Web/API foundation과 iOS staging 구현 통합 |
| 공개 번들 비밀값 검사 | NAVER·Kakao·TAGO·DB·CHIMap session 서버 비밀값 미검출 |

## 3. readiness 스냅샷

2026-07-30 production 공개 재확인 결과:

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
    "stops": 227310,
    "linkedStops": 3369,
    "routes": 156,
    "routeStops": 7254,
    "subwayStations": 1097,
    "activeSubwayStations": 1097,
    "mappedSubwayStations": 706,
    "subwayServiceLines": 46,
    "routeReadySubwayLines": 30,
    "providerMappedStations": 697,
    "busSubwayTransferEdges": 182,
    "routeReadySubwaySegments": 2314,
    "subwayTrackGeometrySegments": 2314
  }
}
```

위 JSON에서는 수시로 바뀌는 timestamp를 생략했습니다. 필수 교통 통계가 준비되고
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
- NAVER 지도에 도로 매칭 경로와 전체 여정의 출발·환승·도착만 표시
- 운동 시작 마커를 제거하고 모든 도보 구간을 주황색 실선으로 통일
- 지도는 비선택 0.18, 카드 hover/focus 0.55, 선택 0.95
  불투명도를 사용하고 SVG 복구 지도의 선택 경로는 1.0으로 표시
- 도착 600초 이하 승차 전 최근접 차량 1대와 승차~하차 구간 운행 차량 전체를
  중복 제거해 표시하고, 순서 없음·ETA 초과·하차 통과 차량 제외
- 차량은 코드 기반 버스 본체·노선번호와 상태 title로 표시하고 진행 방향으로
  회전시키며 지도 bounds 계산에서는 제외
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
- iOS staging은 Kakao 로그인을 필수 gate로 사용하고 사용자별 최초 1회 개인화
  입력을 저장하며 이후 `내 정보`에서 수정
- iPhone 12 Pro 기준 3단계 planner sheet, 수단별 실제 거리 비율 카드,
  route 선택/상세 분리, NAVER leg별 polyline·marker·전체 route camera fit 구현
- SafeAreaProvider, width/fontScale 반응형 1/2열, 숫자 키보드 닫기,
  장소 검색 300ms debounce·이전 요청 취소·stale result 차단 구현

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
- mobile config: guest/Kakao true, Apple false. 현재 iOS UI는 guest flag와 별개로
  Kakao session을 필수로 요구
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
portrait입니다. 이전 staging credential의 Development Build에서는 KakaoTalk 왕복,
CHIMap session 저장과 NAVER 지도 진입을 확인했습니다. 현재 Native App Key는 CNG
설정과 signed device build까지 일치하지만 Kakao SDK native 실패가 보고되어,
Kakao Developers의 동일 key에 `org.madcamp.chimap.staging` 등록 후 새 바이너리
실기기 E2E가 남았습니다. 첫 내부 TestFlight는 Kakao 필수 로그인·HealthKit과
refresh/logout/account deletion을 검증하고 Apple 코드는 server flag로 숨깁니다.
Light 고정과 built-in deployment target 17.0은 완료됐고, Google Play용
`play-staging` AAB/internal draft profile도 추가했습니다. Expo project/token,
Play service account와 App Store Connect ID 연결은 후속 작업입니다.

### 운영

- PostgreSQL host port 미노출
- API만 `127.0.0.1:3000`에 bind
- Prometheus UI만 `127.0.0.1:9090`에 bind하고 API metrics 9091은 host 미노출
- API, PostgreSQL, Prometheus, Alertmanager와 alert-relay healthcheck
- 15초 간격 수집, 15일·2GiB 보존
- HTTP 상태·p95, 검색 0건·NAVER 보완, 추천, DB pool, TAGO timeout,
  공급자 설정, 교통 통계, 백업·동기화·알림 전달 상태 지표
- availability·품질·경로 형상·백업·동기화·알림 전달에 대한 25개 경보 규칙
- Alertmanager가 critical/warning을 묶어 relay로 전달하고 복구 알림도 전송
- 일일 백업, 월간 restore 검증과 일일 01:30 KST TAGO 동기화 timer
- 이전 실행 컨테이너와 이전 CHIMap 태그 정리
- 공개 도메인에서 실제 검색·추천·NAVER 지도 E2E 통과

## 5. 검증 기록

아래 날짜가 붙은 항목은 당시 release의 역사적 기록입니다. 2026-07-30에는
현재 production·staging runtime과 운영 자동화를 별도로 감사했고, 최종 통합
후보의 로컬 전체 검증과 staging E2E까지 완료했습니다. 최종 SHA의 CI와
production E2E는 승격 후 확정합니다.

| 검증 | 결과 |
| --- | --- |
| 운영 Web/API 기준선 TypeScript typecheck | 통과 |
| 운영 Web/API 기준선 production build | 통과, Vite JS 약 379KB |
| 운영 Web/API 기준선 계약·API·웹·알림 릴레이·PostGIS 테스트 | 118개 통과(9+63+43+3) |
| 운영 Web/API 기준선 format check | 통과 |
| 운영 Web/API 기준선 로컬 Chromium smoke | 1440/768/390/320px 헤더 충돌·검색 폼·가로 overflow 없음 |
| 2026-07-28 코드 검사 | 전체 결정적 테스트 266개, TypeScript/API/Web/Mobile production build와 migration 11 PostGIS 검증 통과 |
| 2026-07-30 runtime 감사 | production/staging local·public 3개 상태 endpoint 200, migration 13 current, container healthy |
| 최종 통합 후보 | 결정적 450개 + 격리 PostGIS 12개 = 462개 통과. typecheck·format·Web/API/Mobile build·native config·staging public E2E 통과, 최종 SHA CI·production E2E는 확정 전 |
| cross-platform build | Web/API production 및 iOS·Android Hermes bundle export 통과 |
| native 생성 설정 | iOS/Android identity·key·entitlement·permission·Privacy Manifest 검증 통과 |
| native compile/실기기 | Android arm64 debug APK compile·v2 서명, GitHub macOS iOS simulator와 Android 전체 ABI compile, iOS signed device build 통과. 이전 iPhone 설치·NAVER smoke는 확인했으나 현재 Kakao key E2E와 Android Development Build는 대기 |
| PostgreSQL/PostGIS 통합 테스트 | 격리 PostGIS 18에서 교통·migration 10개와 mobile auth 2개 통과 |
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
| Prometheus 최신 runtime | API/relay/Alertmanager target 3개 `up`, 25개 rule healthy, firing 0. 변경 rule reload는 최종 승격 gate |
| 교통 정기 동기화 | 45개 성공·0개 실패, 성공 시각과 실패 수 지표 확인 |
| 정류장 병합 migration | 1,173쌍→0쌍, 관계 유지, migration 2 적용 |
| 알림 릴레이 형식 | 격리 HTTP 수신처에 Slack 형식 긴급 메시지·상태 버튼 전달 |
| 서울 실시간 추천 | 서울역→강남역 3개 후보의 첫 4호선 leg가 `SEOUL_REALTIME_ARRIVAL`, 이후 leg는 TAGO 시간표 fallback |
| 외부 운영 채널 | 명시적 비활성화, relay `202 disabled`, 설정 필요 경보 0개 |
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

2026-07-30 16:50 KST에는 18,240,361-byte production custom-format backup을
생성했고 별도 PostGIS 18 restore에서 migration 13과
`227310/3369/156/7254` 통계를 확인했습니다. 이 기록은 final `main` 배포 전
rollback 기준선이며 최종 승격 직전 backup·restore를 다시 실행합니다.

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

2026-07-27 최종 저장소 통합은 다음 순서로 수행했습니다.

1. 원격 최신 `feat/mobile/cross-platform-foundation@1df41a5`를 fetch해
   migration 9, request-scoped multimodal routing, 서울 지하철 실시간과 최신
   운영 문서를 확인했습니다.
2. iOS staging UI·Kakao/HealthKit/session·responsive/safe-area·native verifier
   변경을 `feat/ios/native-spike`에 커밋했습니다.
3. 원격 foundation을 iOS branch에 병합하고 공유 계약을 다시 build했습니다.
4. 원격 commit에 누락돼 clean checkout API test를 깨뜨리던
   `subway_provider_station_map_template.csv` 의존성을 작은 추적 fixture로
   교체했습니다.
5. Web/API/Mobile/native/PostGIS 검증 뒤 통합 branch를 `main`에 병합하고
   `origin/main`을 갱신합니다.

기존 draft PR #1의 Web/API 이력도 동일 commit graph에 포함됩니다. 이후 작업은
초기 commit만 있던 옛 `main`이나 장기 iOS branch가 아니라 갱신된 `main`에서
책임별 `feat/mobile/*`, `feat/ios/*`, `feat/api/*`, `feat/contracts/*`로 분기합니다.

2026-07-30 최종 통합 작업은 아직 pre-release입니다. merged-tree test·build·
native config·격리 PostGIS·staging public E2E까지 통과했으며, 최종 `main` push,
immutable image 식별, staging 재승격, production backup·candidate smoke·승격과
공개 E2E가 모두 끝난 뒤에만 새 release SHA와 image를 기록합니다.

## 9. 현재 한계와 확장 조건

- staging은 HTTPS/API/auth, 버스·지하철 seed, readiness 200과 외부 실제 추천까지
  준비됐습니다. TAGO timeout으로 보류된 지하철역 3개는 다음 mapping 실행에서
  재시도하며 iPhone 실기기 E2E는 별도 release gate입니다.
- staging의 Valhalla와 active 공원 경로 152건은 검증됐지만 production은 아직
  Kakao 도보이고 공원 dataset이 없습니다. private/overlay 또는 명시적으로 승인된
  엄격한 allowlist를 확인한 뒤 canonical 단계에 따라 별도로 승격합니다.
- iPhone 12 Pro Development Build 설치와 NAVER 지도 진입은 이전 credential에서
  확인했습니다. 현재 Native App Key의 KakaoTalk→session E2E, HealthKit matrix,
  staging App Store Connect app, EAS store/preview profile과 TestFlight 제출이
  남았습니다. [iOS 개발 운영서](./ios-development.md)를 release gate로 사용합니다.
- 버스 도로 형상은 실제 운행 중심선이 아니라 Kakao 자동차 도로 형상입니다.
  endpoint·연속성·우회거리 검증에 실패한 구간은 정상 도로처럼 표시하지 않고
  흐린 점선 근사 경로로 유지합니다.
- Google Play 제출용 `play-staging` AAB/internal draft profile은 준비됐지만 Expo
  project/token, Play Console 앱과 service account 연결 전이라 실제 스토어 제출은
  아직 수행하지 않았습니다.
- 전국 정류장은 적재했지만 노선과 노선-정류장 관계는 사용 지역을 중심으로
  점진적으로 동기화합니다.
- API는 프로세스 로컬 캐시와 rate limit을 사용하므로 단일 인스턴스로
  운영합니다.
- 수평 확장 시 Redis 기반 공유 캐시·single-flight·rate limit과 DB
  connection budget 재설계가 선행되어야 합니다.
- 검색과 추천 성능은 외부 공급자 지연의 영향을 받으므로 p95와 공급자별
  timeout을 함께 관찰해야 합니다.
- 정류장 탐색은 최대 1.2km와 2회 환승까지만 지원하므로 이 범위 밖의
  연결은 구체적인 위치 선택 안내 또는 연결 범위 안내와 함께 404가 됩니다.
- Alertmanager와 relay는 배포됐지만 외부 알림은 현재 사용하지 않습니다.
  `EXTERNAL_ALERTS_ENABLED=0`에서 webhook 호출과 설정 누락 경보를 모두 막습니다.
  나중에 사용할 때만 [배포 운영서](./deployment.md)의 절차에 따라 flag와 URL을
  함께 설정하고 실제 점검·복구 알림을 확인합니다.
- 서울시 실시간 지하철 API는 공식 host가 HTTP만 제공하므로 key가 네트워크
  구간에서 평문 전송되는 잔여 위험이 있습니다. exact-host opt-in, redirect
  차단, 일일 900회 guard와 서버 전용 호출을 유지하고 공식 TLS 제공 여부를
  정기적으로 재확인해야 합니다.
- 기존 시간 제약 추천 요청은 전환 릴리스 동안만 유지합니다. 사용 현황과
  downstream 전환을 확인한 뒤 `deadline`, `maxExtraMinutes`,
  `safetyBufferMinutes` 계약과 기존 warning을 제거해야 합니다.
