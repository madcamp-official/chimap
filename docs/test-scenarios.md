# 검증 전략과 시나리오

테스트는 일반 PR에서 결정적으로 실행하는 실제 응답 캡처 테스트와,
배포 gate에서 실제 키·PostgreSQL·외부 공급자를 연결하는 제한된 E2E로
나눕니다.

## 1. 테스트 데이터 정책

공급자 parser·normalizer는 실제 호출을 캡처한 응답만 사용합니다. 캡처에는:

- 공급자
- API endpoint
- UTC 캡처 시각
- 문서 확인 날짜
- 비밀값을 제거한 request 설명
- 응답 SHA-256 checksum

을 기록합니다.

현재 자료:

| 파일 | 내용 |
| --- | --- |
| `kakao-responses-20260725.json` | keyword, address, reverse, walk |
| `kakao-driving-response-20260725.json` | 다중 경유지 도로 vertex |
| `naver-responses-20260725.json` | geocode, reverse |
| `tago-responses-20260725.json` | 108번 경유노선·노선 정류장·도착 |
| `tago-vehicle-positions-20260725.json` | 603번 실제 차량 위치 11건 |
| `bus-stops-public-sample-20251031.csv` | 전국 공개 정류장 원본 표본 |
| `bus-stops-public-sample-20251031.metadata.json` | 원본 행·날짜·checksum |

timeout, HTTP 상태와 오류 매핑은 임의 경로가 아니라 오류 객체·status 처리
자체를 단위 테스트합니다. 실제 외부 키가 필요한 테스트를 일반 PR에
무제한으로 넣지 않습니다.

## 2. 기본 검증 명령

```bash
pnpm boundaries:check
pnpm typecheck
pnpm test
pnpm build:all
pnpm format:check
git diff --check
```

현재 일반 test 구성:

- contracts: 12개
- app-core: 3개
- alert-relay: 3개
- API: 104개
- web: 56개
- mobile: 14개
- 합계: 192개

PostgreSQL 전용 8개는 `DATABASE_TEST_URL`이 없으면 일반 실행에서
건너뜁니다. 격리 PostGIS까지 포함한 전체는 200개입니다.

## 3. 공급자 테스트

### Kakao

- 실제 keyword/address/reverse/walk schema parsing
- 실제 다중 경유지 Directions checksum과 도로 vertex parsing
- Place ID 접두사와 WGS84 좌표
- keyword/address 중복 20m 병합
- 정확 일치와 거리 정렬
- 401/403 fail-fast
- 복구 가능한 5xx에서 NAVER 보완
- timeout·AbortSignal mapping

### Kakao Login

- OAuth `state` 서명·불일치·만료와 카카오 호출 전 거절
- 인가 코드 교환 시 Client Secret 전달
- JavaScript 안전 정수를 넘는 카카오 회원번호 문자열 보존
- 카카오 token 대신 hash된 CHIMap session만 저장
- 익명 session, login redirect, callback cookie, logout HTTP 흐름
- 웹의 비회원 이용, 로그인 사용자 표시, 취소·로그아웃 UX

### NAVER

- 실제 geocode 주소·건물명 정규화
- 실제 reverse의 roadaddr/addr/행정구역 조합
- 서버 endpoint host 검증
- 401/403 설정 오류
- 429와 5xx 제한 재시도

### TAGO

- object/array item 정규화
- 실제 정류장 경유 노선 parsing
- 실제 108번 route-stop 순서
- 실제 도착 초→분 계산
- `nodeid` parameter
- result code `99` 제한 재시도
- 키 누락·timeout·공급자 오류 mapping
- 지하철 역 검색 단일/배열 item, pagination과 키 마스킹
- 대전역 실제 fixture의 SHA-256 checksum
- 평일·토요일·일요일과 U/D 시간표 정규화
- 정확한 역명·노선 단일 후보만 매핑, 복수 후보는 `UNRESOLVED`

## 4. PostgreSQL/PostGIS 통합

운영 DB를 사용하지 않고 별도 PostGIS DB를 지정합니다.

```bash
DATABASE_TEST_URL=postgresql://user:password@127.0.0.1:5432/chimap_test \
  pnpm --filter @chimap/api exec vitest run \
  src/transit/transit-repository.integration.test.ts \
  src/auth/mobile-auth-repository.integration.test.ts
```

현재 7개 통합 시나리오:

1. migration 반복 적용, CSV COPY/upsert idempotency, 500m 거리 정렬
2. 공개 정류장과 실제 TAGO 정류장의 30m 연결
3. 정류장번호가 같은 기존 TAGO row·노선 관계를 CSV row로 병합
4. 변경된 migration checksum 거절
5. 실제 108번 노선 정류장 교체 실패 시 transaction rollback
6. refresh token 동시 rotation 중 한 요청만 새 generation을 만들고 다른 요청은
   grace 안에서 직전 token pair를 그대로 재생
7. grace 만료 token 재사용 시 mobile family 전체 폐기, Web session 보존과
   Apple 계정 삭제 시 암호화 credential·모든 session cascade

추가 확인:

- PostGIS extension
- GiST index 사용 가능한 query
- 네 readiness 통계
- pool 종료

## 5. 검색 UI

- 입력 후 300ms에 `suggest`
- Enter와 검색 버튼에서 `resolve`
- 새 입력 시 이전 fetch AbortSignal 취소
- 자동완성 0건과 최종 0건 문구 구분
- 첫 결과 자동 선택 금지
- 결과 선택 전 추천 차단
- keyboard 위/아래/Enter/Escape
- NAVER 주소 라벨
- 캠퍼스 중심·도로명 주소·출입구 라벨
- 공급자 오류와 정상 0건 구분

## 6. GPS·지도

- 위치 권한 허용→reverse→주소 Place
- 정상 주소 0건→현재 좌표 Place
- reverse 일시 장애→현재 좌표 Place
- 위치 권한 거절 안내
- NAVER SDK load와 인증 안정화
- auth failure·timeout→SVG
- 실제 지도와 SVG 모두 운동 시작 마커 없음
- 일반 접근·환승·목표 도보를 모두 주황색 실선으로 표시
- 비선택 추천 경로는 선택 경로보다 낮은 불투명도로 표시
- 도로 굴곡을 따르는 버스 geometry
- 전체 여정의 출발 1개·실제 이동수단 환승 지점·도착 1개 overlay
- 중간 버스 정류장 마커 0개
- 선택 구간과 같은 city/route 중 ETA 600초 이하인 승차 전 최근접 차량 1대와
  승차 정류장을 방금 지난 최근접 차량 1대만 허용(노선별 최대 2대)
- 접근·구간 운행 조건이 겹친 차량의 차량번호 또는 순서+좌표 중복 제거
- 차량 좌표를 map bounds에서 제외
- 지도 cleanup과 SDK 재시도
- 코드 기반 버스 본체·노선번호와 진행 방향 회전, 접근성 label
- ETA 599·600·601초 경계, 방금 지난 차량 1대 선택과 노선별 상한 검증
- 차량 배열만 바뀔 때 `fitBounds`·중심·줌 호출 수가 증가하지 않음
- 선택 경로 변경 때만 `fitBounds`가 정확히 한 번 증가
- SVG/native fallback도 같은 노선번호와 진행 방향 계산 사용
- 추천 결과에서 출발·도착 주변 지하철역 각각 조회
- TAGO 매핑 역의 U/D 다음 출발과 시간표 기반·지연 미반영 문구 표시
- 미매핑 역과 한쪽 역 조회 실패가 버스·도보 추천을 차단하지 않음
- 직통 지하철, 지하철 노선 환승, 버스→지하철·지하철→버스 후보 생성
- 정류장 사이 Kakao 도로 경로가 직선 대비 과도하게 우회하면 해당 구간만
  정류장 순서 선으로 대체

## 7. 추천 엔진

- 출발·도착 50m 검증
- 간소화 요청 허용, 알 수 없는 필드와 새·기존 형식 혼합 거절
- 기존 마감 요청의 최대 6시간·안전 여유시간 검증과 `Deprecation: true` header
- 자동 추가시간의 15분 하한·일반 계산·90분 상한
- 목표 달성 시 운동 우회는 만들지 않되 기본 후보가 충분하면 고유한 3개 제공
- 실제 TAGO 직행/1회 환승
- TAGO 정류장 순서를 Kakao 도로 geometry로 변환
- 운행 노선 0건 정류장 제외
- 실제 연결이 없을 때 500m→800m→1.2km 단계 확장
- 연결 정류장 수와 비율이 충분할 때 주변 공급자 재호출 생략
- 운행 정류장 부재와 직행/1회 환승 연결 부재 오류 문구 구분
- Kakao 도보 전후 구간
- 실시간 도착과 배차간격 추정
- 최대 9회 외부 경로 호출
- 20초 전체 timeout과 8초 이후 지연 안내
- 자동 추천 범위 밖 후보 필터와 자동 범위 전용 목표 미달 warning
- 기존 요청의 마감·추가시간 필터
- route 중복 제거
- FAST/2배 걸음/목표 근접 경로의 선정 기준과 ID·타입 중복 금지
- 부분 후보 실패 warning

## 8. 공개 E2E

```bash
E2E_BASE_URL=https://chimap.madcamp-kaist.org \
E2E_REQUIRE_NAVER_MAP=1 \
pnpm test:e2e
```

현재 Playwright 시나리오는 UI 전체 흐름, 네 화면 폭의 로컬 레이아웃 smoke,
확장 정류장 API 회귀 3개입니다.
운영 호스트의 Docker bridge에서 NAVER SDK 주소 연결이 제한될 수 있으므로
배포 서버에서 strict 지도 E2E를 실행할 때는 `--network host`를 사용합니다.

UI 전체 흐름:

1. 첫 방문 인트로와 건너뛰기
2. 최초 방문이면 만 나이·신장·체중·생물학적 성별을 필수 입력하고 18~59세는
   8,000걸음, 60~90세는 7,000걸음이 첫 목표로 자동 적용되는지 확인
3. 입력 중 개인화 한 걸음 길이와 브라우저 전용 저장 안내 확인
4. 헤더에서 현재 걸음을 입력하고 Enter로 반영
5. 왼쪽 폼에서 `대전 유성구 대학로 291` 검색 후 한국과학기술원 직접 선택
6. 대전역 검색·직접 선택
7. 시간 조건을 추가로 묻지 않는 `건강 경로 찾기` 한 번으로 추천 요청
8. 요청 본문에 `deadline`, `maxExtraMinutes`, `safetyBufferMinutes`가 없음을 확인
9. 목표 추천 기본 선택, 빠른·2배 걸음·목표 근접 간략 카드와 기본 상세 닫힘 확인
10. 빠른 경로 `자세히`와 `aria-expanded/controls`, 텍스트 단계 확인
11. NAVER 지도 인증, 지도 공급자 칩 부재와 왼쪽 최하단 데이터 제공 안내 확인
12. 탑승 1·환승 버스 수−1·하차 1·중간 정류장 0 확인
13. 차량 API 완료 후 ETA 10분 이하 접근 차량과 구간 운행 차량만 표시
14. WebP marker의 흰 전광판·검은 노선번호와 도착 분/구간 운행 접근성 title 확인
15. 21초 이상 차량 갱신 뒤에도 사용자가 바꾼 중심·줌 유지
16. 주변 월평·대전역과 U/D 시간표 기반 다음 출발·지연 미반영 문구 확인
17. 2배 걸음 경로 선택 시 기존 상세 닫힘 확인
18. 2배 걸음 경로 `자세히`를 열어 텍스트 단계를 확인한 뒤 상세의 `간략히`
19. localStorage v3에 필수 프로필·목표·현재 걸음의 한국 날짜·장소 저장
20. 당일 새로고침 후 프로필·장소·현재 걸음 복구
21. 1440/768/390/320px 가로 overflow 없음

개인화·후보 생성 회귀:

1. 생물학적 성별을 선택하기 전에는 프로필 저장 버튼 비활성
2. 만 나이 18~90세, 신장 120~220cm, 체중 30~200kg, 목표 1~100,000 범위 검증
3. 20m 보행 측정 입력·저장 필드가 존재하지 않음
4. 동일 입력에서 모든 거리↔걸음 계산이 `stepLengthMeters`를 사용
5. 목표·프로필 수정 시 기존 추천 무효화
6. 한국 날짜가 바뀌거나 앱이 다음 날 재활성화되면 현재 걸음 0과 추천 무효화
7. 마지막 버스에 조기 하차 가능 정류장이 있으면 해당 후보를 먼저 조회
8. 조기 하차 후보가 목표 ±5%이면 늦은 탑승 API 호출 생략
9. 부족한 경우에만 늦은 탑승과 양쪽 조합을 순서대로 보완
10. 환승 지점 유지, 버스 leg 최소 한 정거장, 승하차 순서 보장

확장 정류장 회귀:

1. 실제 검색 API에서 `KAIST 본원`의 장소 중심 좌표 선택
2. 실제 검색 API에서 `고이비토 대전갤러리아점` 선택
3. 추천 API가 HTTP 200과 1개 이상의 추천 반환
4. 빠른 경로에 TAGO 버스 구간 존재
5. 버스 geometry 좌표 수>정류장 수, 정류장 외 도로 vertex 포함 확인
6. 도로 매칭 `estimationNotes` 확인
7. 첫 승차 전 Kakao 실제 도보가 500m를 넘는지 확인

배포 gate에서만 실행하고 외부 API 부하 테스트로 사용하지 않습니다.

## 9. Route Pulse UI 상태·접근성

현재 결정적 테스트가 직접 보장하는 범위는 UI 경험 상태의 저장·손상 복구,
추천 성공 3회 threshold, 학습 초기화 시 동의 보존, 설정에서 compact·동작
줄이기 선택, 8초 지연 문구, 동의 전 요청 차단과 허용 뒤 이벤트 전송입니다.

다음은 배포 전 수동·브라우저 E2E까지 포함해 확인할 전체 release gate입니다.

- `idle/editing-place/ready/calculating/results/route-selected/error` 상태
  조합의 `data-ui-state`와 레이아웃 안정성
- 추천 성공 0~2회 guided, 3회 compact 전환과 되돌리기·재접속 복구
- 자동/자세히/간결하게 설정에서도 주요 컨트롤 위치 불변
- OS와 로컬 `동작 줄이기` 각각에서 드로잉·슬라이드·펄스 제거
- 계산 화면이 가상 단계나 퍼센트를 만들지 않고 8초 지연만 안내
- 결과 카드 80ms 간격, 선택/hover/focus 지도 경로
  NAVER 0.95/0.55/0.18과 SVG 1.0/0.55/0.18
- 키보드만으로 검색·경로 선택·상세·설정 변경
- 텍스트 WCAG AA와 의미 있는 선·포커스·선택 3:1 이상
- 모바일·데스크톱 상태 전환에서 레이아웃 이동과 가로 overflow 없음

## 10. 익명 이벤트 동의 경계

계약·API·웹 단위 테스트는 동의 전/거부 차단, 허용 뒤 제한 payload,
추가 개인정보 필드 거절, 204 응답과 Prometheus enum label을 자동 검증합니다.
철회 뒤 네트워크 요청 0건과 공개 배포 bundle 동작은 release smoke에서 다시
확인합니다.

- 동의 전·거부·철회 상태에서 `/api/v1/ui-events` 요청 0건
- 허용 후에만 `planner_viewed` 등 allowlist 이벤트 전송
- duration은 네 bucket만 허용하고 정확한 시간값 거절
- 검색어·좌표·장소/노선 ID·신체정보·세션/사용자 ID 추가 시 HTTP 400
- 응답 `204 No Content`, 분석 로그에는 body와 IP 없음
- Prometheus label에는 허용된 enum만 존재

## 11. Mobile lifecycle·native·auth

- iOS/Android/Web 및 dev/staging/prod가 서로 다른 storage namespace 사용
- iOS staging은 저장된 CHIMap session이 없으면 Kakao 로그인을 필수로 요구
- 사용자별 개인화 입력은 최초 1회만 표시되고 `내 정보`에서 다시 수정 가능
- Zustand RouteStore가 선택 route ID/type과 열린 상세 sheet를 eviction 뒤 복원
- 성공한 추천 query만 최대 24시간 AsyncStorage에 보존
- foreground 복귀 시 온라인·활성·같은 한국 날짜·5분 초과 추천만 조용히 refetch
- fetch 중, 5분 정확한 경계, 전날 요청, offline query는 중복 refetch하지 않음
- Health Connect가 설치되고 권한이 있지만 `records=[]`이면 Android adapter가 `0` 반환
- iOS HealthKit은 step read만 요청하고 write/background delivery를 요청하지 않음
- iOS/Android NAVER Client ID, bundle/package, Kakao scheme가 서로 섞이지 않음
- Android Kotlin 2.1.20, minSdk 26, NAVER/Kakao Maven group 격리와 공식 URL 확인
- refresh grace 120초 안에는 암호화 보관한 동일 pair 재생, 만료 뒤 family revoke
- `scripts/verify-mobile-native-config.mjs all|ios|android`를 CNG 직후 실행
- 추천 카드는 leg 조각을 반복 표시하지 않고 도보/버스/지하철 거리 합계와
  합계 100%인 연속 비율 막대를 표시

내부 iOS 실기기 gate는 카카오톡 설치/미설치 복귀, NAVER 지도 렌더링,
HealthKit 실제·빈 자료, 권한 거부, process eviction을 포함합니다. Apple 로그인은
외부 TestFlight 전 별도 gate이고 Android Health Connect는 Android release gate에서
검증합니다.

### 환경·플랫폼 격리 smoke

- production과 staging의 Compose project, network, PostgreSQL volume 이름이 다름
- staging API가 `127.0.0.1:3001`, production API가 `127.0.0.1:3000`에만 bind
- 각 API의 `DATABASE_URL` host는 자기 Compose의 `postgres`이며 host DB port 미노출
- staging 계정·session 생성이 production DB row 수를 바꾸지 않음
- 같은 staging API를 쓰는 Web·iOS·Android는 server 계정·교통 seed를 공유함
- mobile AsyncStorage/SecureStore key가 environment·OS·user hash별로 분리됨
- iOS staging build에 production API host나 Android NAVER Client ID가 포함되지 않음
- `.env`, `.env.staging`, `apps/mobile/.env`가 Git 추적·Docker image·공개 asset에 없음

2026-07-30 staging은 버스·지하철 seed, local/public health·readiness 200,
Valhalla 상세 도보와 active 공원 경로 152건까지 확인했습니다. 이 결과는
staging runtime 증거이며 final `main`의 전체 release gate를 대체하지 않습니다.
timeout 난 정류장·역만 격리하고 나머지 seed를 계속하는 회귀는 API 단위 테스트와
운영 실행 결과를 함께 확인합니다.

## 12. 배포 보안 검사

- `.env` Git ignore
- 추적 파일 비밀값 검색
- 공개 JavaScript asset에 NAVER Client Secret 미포함
- 브라우저 변수와 서버 Client Secret 동일 값 거절
- API 로그에 query string·좌표·키·원문 없음
- Docker image에 root `.env` 없음

## 13. 운영 자동화와 모니터링

- 백업 파일 비어 있지 않음, `pg_restore --list`, SHA-256 일치
- 최신 백업을 `template0` 기반 별도 PostGIS 18 DB에 전부 복원
- restore 후 PostGIS, 현재 migration과 readiness 교통 통계 일치 확인
- backup·restore·교통 동기화 systemd unit 문법과 timer active 확인
- Prometheus 설정과 25개 rule을 `promtool`로 검증
- API metrics 9091 host 미노출, Prometheus 9090 loopback 전용
- API·relay·Alertmanager target `up`, DB/provider/backup/sync 지표 확인
- Alertmanager 설정을 `amtool`로 검증
- relay가 긴급·주의·복구 메시지를 Slack/Discord/일반 형식으로 변환
- 격리 HTTP 수신처로 실제 긴급 메시지와 상태 확인 버튼 전달
- `EXTERNAL_ALERTS_ENABLED=0`일 때 relay health `disabled`, POST 202,
  `chimap_alert_relay_enabled=0`과 설정 필요 경보 0개 확인
- 지표와 로그에 검색어·좌표·키·원문 없음

## 14. 폐기 대상 잔존 검사

lockfile과 외부 package를 제외한 1차 코드·설정·문서에서 폐기한 데이터
경로와 실행 변수가 다시 들어오지 않았는지 검사합니다. 검사 대상은
`apps`, `packages`, `scripts`, `docs`, 루트 문서, Dockerfile,
`.env.example`, `package.json`입니다.

삭제된 파일 경로는 Git status에 삭제 항목으로 보일 수 있지만 작업 파일
내용과 build asset에는 남지 않아야 합니다.

## 15. 현재 검증 기록

2026-07-26 17:15 KST 운영 Web/API 기준선 검증:

- typecheck 통과
- 결정적 테스트 118개 통과: contracts 9, alert-relay 3, API 63, web 43
- production build 통과(Vite JS 약 379KB)
- format check와 `git diff --check` 통과
- 로컬 production build를 Chromium에서 1440·768·390·320px로 열어 헤더
  충돌·검색 폼 표시·가로 overflow 없음 확인
- 격리 PostGIS에서 migration 3 적용·재적용을 포함한 5개 통과
- 공개 asset `index-8c6yxSUg.js`, `index-BsaRoatc.css` 배포 확인
- 선택형 로그인 포함 1440·768·390·320px Chromium smoke 통과
- 공개 인증 session/start/state cookie/Kakao authorize smoke 통과
- 공개 실제 추천·NAVER 지도 main E2E 통과
- 공급자 회귀는 전체 실행 중 20초 timeout 뒤 단독 재실행 5.5초 통과

2026-07-27 cross-platform foundation 로컬 검증:

- workspace 경계 검사, format check, 전체 typecheck 통과
- 결정적 테스트 151개 통과: contracts 11, app-core 3, alert-relay 3,
  API 77, web 43, mobile 14
- 격리 PostGIS에서 교통 5개와 mobile auth rotation/account deletion 2개 통과
- Web production build 및 iOS·Android Hermes bundle export 통과
- Expo prebuild 결과의 Bundle ID/package, NAVER Client ID, Apple/HealthKit,
  Health Connect, Kakao scheme, foreground-only 위치, Privacy Manifest 설정 통과
- Expo Doctor 21개 중 프로젝트 검사 20개 통과. React Native Directory metadata
  검사는 외부 directory server 오류로 결과를 받지 못함
- Android SDK 36/minSdk 26/Kotlin 2.1.20 arm64 debug Gradle assemble과 APK v2
  서명 검증 통과. push run `30230011225`에서 macOS iOS simulator와 Android
  전체 ABI compile을 포함한 다섯 CI job 성공. 실제 기기 E2E와 store archive
  전에는 mobile release 완료로 간주하지 않음

2026-07-27 11:01~11:05 KST cross-platform Web/API 공개·운영 스냅샷:

- PostgreSQL/PostGIS 통합 테스트 7개와 migration 1~6 적용 통과
- 공개 실제 추천·NAVER 지도 main E2E와 네 화면 폭 layout smoke 통과
- 확장 정류장 회귀는 전체 실행에서 upstream 504 뒤 단독 재실행 16.9초 통과
- KAIST→대전역 8,000보 요청에서 조기 하차 7,995보, 목표 오차 -5보 확인
- KAIST 본원 중심→대전 갤러리아 HTTP 200, 추천 3건
- NAVER geocode/reverse HTTP 200
- readiness `227225/2844/134/5731`
- 백업 restore 스냅샷 `PostGIS=1/migration=6/227225/2844/134/5731`
- 공개 bundle NAVER·Kakao OAuth·session 비밀값 미검출
- 백업 restore 통과
- Prometheus 3개 target `up`, 20개 rule healthy
- 교통 동기화 45개 성공·0개 실패와 상태 지표 확인
- Alertmanager 0.32.1 ready, 격리 수신처 relay HTTP 전달 확인
- 외부 운영 채널은 webhook 입력 전이며 구성 필요 경보 확인
- 구현·문서 commit `f624e9b`의 push CI run `30230011225` 다섯 job 성공
- API와 alert relay 이미지 `sha256:0a2db829…`, 공개 asset
  `index-GVl8ucg8.js` 승격
- `/api/v1/mobile-config` guest enabled, 운영 mobile Kakao/Apple credential 입력 전
  provider disabled 확인
- 배포 후 백업 `chimap-daily-20260727T020434Z.dump`, 17,350,161 bytes,
  SHA-256 `829a8a6911dc5e9f69091c993405035a4f75afbd12faebd5f2382d69686f4d0f`

2026-07-27 11:01 KST에 cross-platform Web/API 이미지를 승격했고 공개 health
`ok`, readiness `ready`, session/mobile-config, 새 asset과 비밀값 경계를
확인했습니다. 실제 mobile Kakao/Apple 계정, HealthKit/Health Connect,
SecureStore 재실행은 provider credential과 실제 기기가 필요한 다음 release
gate입니다.

2026-07-27 14:28~14:29 KST 버스·지하철 UI 공개·운영 스냅샷:

- workspace 경계·format·typecheck와 Web/API/iOS/Android `build:all` 통과
- 결정적 테스트 182개 통과: contracts 12, app-core 3, alert-relay 3,
  API 96, web 54, mobile 14
- 격리 PostGIS에서 교통·migration 6개와 mobile auth 2개, 전체 190개 통과
- 공개 기본 추천·주변 역·NAVER 지도·버스 WebP·10초 갱신·카메라 보존 E2E와
  1440/768/390/320px layout 통과
- 확장 정류장 시나리오는 외부 공급자 응답 1회 실패 후 API 진단과 단독
  Playwright 재실행 통과
- 대전역 U방향·다른 매핑 역 D방향 시간표에서
  `scheduleBased=true`, `realtimeAvailable=false` 확인
- readiness `227225/2844/134/5731`, 지하철 `1097/1097/706`
- 공개 asset `index-BjbF61pt.js`, `index-CQVn3DWd.css`,
  `bus_icon-DB1cEqjH.webp`(9,464 bytes) 확인
- Prometheus target 3개 `up`, rule 20개 healthy, Alertmanager ready,
  지하철 미매핑 gauge 391 확인
- 추적 파일·공개 bundle·최근 운영 log에서 실제 서버 비밀값 0건
- 배포 후 백업 `chimap-daily-20260727T052848Z.dump`, 17,448,666 bytes,
  SHA-256 `40fdf6b44cef23f56954f9213e6ac045c3f1dcc19a3404330b0ed063a7acea8c`
- 별도 PostGIS 18 전체 restore에서 `migration=7`, 버스 통계와 지하철 table·
  index 확인

2026-07-28 14:39~14:48 KST 선로·버스·도보 형상 운영 스냅샷:

- 전체 typecheck 통과
- 결정적 테스트 266개 통과: contracts 12, app-core 4, alert-relay 4,
  API 141, web 57, mobile 48
- 별도 PostgreSQL 18/PostGIS 3.6에서 교통 8개와 mobile auth 2개 통합 테스트,
  migration 1~11 반복 적용과 전국 선로 2,314개 import 통과
- API·Web production build와 실제 mobile 환경의 iOS·Android Hermes export 통과
- production migration 11, `TRANSIT_GEOMETRY_V2_ENABLED=1`, local/public
  health·readiness와 Prometheus 22개 rule 검증 통과
- 공개 514번 필수 구간은 `DETAILED`, 25개 좌표. cold HTTP 200(15.1초),
  warm 5건 HTTP 200(0.84~2.13초)
- 배포 전후 production custom-format backup 생성과 SHA-256 검증 통과

2026-07-30 pre-release runtime 감사:

- production code `d268e067`, image `sha256:200346ac…`; staging code
  `21251280`, image `sha256:1b8e8cae…`
- 두 환경의 local/public health·readiness·mobile-config HTTP 200, migration 13
- production Prometheus target 3개 `up`, 25개 rule healthy, firing 0
- staging Valhalla provider configured, WALK geometry success 7건,
  `DETAILED/VALHALLA_WALK`와 active 공원 경로 152건 확인
- production backup과 별도 restore에서 migration 13 및 readiness 교통 통계 확인
- merged tree 결정적 테스트 450개 통과: API 272, mobile 83,
  web 61, contracts 20, app-core 10, alert-relay 4
- 격리 PostGIS 18에서 교통·migration 10개와 mobile auth 2개, 총 12개 통과
- workspace typecheck·format check·Web/API/Mobile build·생성 native config와
  staging public E2E 통과. 최종 SHA CI와 production public E2E는 아직 미확정
