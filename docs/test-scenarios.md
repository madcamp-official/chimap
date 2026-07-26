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
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
git diff --check
```

현재 일반 test 구성:

- contracts: 8개
- alert-relay: 3개
- API: 47개
- web: 39개
- 합계: 97개

PostgreSQL 전용 5개는 `DATABASE_TEST_URL`이 없으면 일반 실행에서
건너뜁니다.

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

## 4. PostgreSQL/PostGIS 통합

운영 DB를 사용하지 않고 별도 PostGIS DB를 지정합니다.

```bash
DATABASE_TEST_URL=postgresql://user:password@127.0.0.1:5432/chimap_test \
  pnpm --filter @chimap/api exec vitest run \
  src/transit/transit-repository.integration.test.ts
```

현재 5개 통합 시나리오:

1. migration 반복 적용, CSV COPY/upsert idempotency, 500m 거리 정렬
2. 공개 정류장과 실제 TAGO 정류장의 30m 연결
3. 정류장번호가 같은 기존 TAGO row·노선 관계를 CSV row로 병합
4. 변경된 migration checksum 거절
5. 실제 108번 노선 정류장 교체 실패 시 transaction rollback

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
- 첫 승차 1개·버스 수−1개 환승·최종 하차 1개 overlay
- 중간 버스 정류장 마커 0개
- 선택 구간과 같은 city/route, 탑승 순서 이전 차량만 허용
- 탑승 정류장에 가장 가까운 차량 1대 선택과 차량번호 중복 제거
- 차량 좌표를 map bounds에서 제외
- 지도 cleanup과 SDK 재시도

## 7. 추천 엔진

- 출발·도착 50m 검증
- 간소화 요청 허용, 알 수 없는 필드와 새·기존 형식 혼합 거절
- 기존 마감 요청의 최대 6시간·안전 여유시간 검증과 `Deprecation: true` header
- 자동 추가시간의 15분 하한·일반 계산·90분 상한
- 목표 달성 시 운동 우회 없이 빠른 경로만 제공
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
- FAST/BALANCED/GOAL ID·타입 중복 금지
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
2. 최초 방문이면 만 나이·신장·체중·생물학적 성별·하루 목표 걸음 필수 입력
3. 입력 중 개인화 한 걸음 길이와 브라우저 전용 저장 안내 확인
4. 헤더에서 현재 걸음을 입력하고 Enter로 반영
5. 왼쪽 폼에서 `대전 유성구 대학로 291` 검색 후 한국과학기술원 직접 선택
6. 대전역 검색·직접 선택
7. 시간 조건을 추가로 묻지 않는 `건강 경로 찾기` 한 번으로 추천 요청
8. 요청 본문에 `deadline`, `maxExtraMinutes`, `safetyBufferMinutes`가 없음을 확인
9. 목표 추천 기본 선택, 빠른·균형·목표 달성 간략 카드와 기본 상세 닫힘 확인
10. 빠른 경로 `자세히`와 `aria-expanded/controls`, 텍스트 단계 확인
11. NAVER 지도 인증, 지도 공급자 칩 부재와 왼쪽 최하단 데이터 제공 안내 확인
12. 탑승 1·환승 버스 수−1·하차 1·중간 정류장 0 확인
13. 차량 API 완료 후 마커 수≤선택 버스 구간 수
14. 차량 마커 title의 탑승 접근 정류장 수 확인
15. 균형 경로 선택 시 기존 상세 닫힘 확인
16. 균형 경로 `자세히`를 열어 텍스트 단계를 확인한 뒤 상세의 `간략히`
17. localStorage v3에 필수 프로필·목표·현재 걸음의 한국 날짜·장소 저장
18. 당일 새로고침 후 프로필·장소·현재 걸음 복구
19. 1440/768/390/320px 가로 overflow 없음

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

## 11. 배포 보안 검사

- `.env` Git ignore
- 추적 파일 비밀값 검색
- 공개 JavaScript asset에 NAVER Client Secret 미포함
- 브라우저 변수와 서버 Client Secret 동일 값 거절
- API 로그에 query string·좌표·키·원문 없음
- Docker image에 root `.env` 없음

## 12. 운영 자동화와 모니터링

- 백업 파일 비어 있지 않음, `pg_restore --list`, SHA-256 일치
- 최신 백업을 `template0` 기반 별도 PostGIS 18 DB에 전부 복원
- restore 후 PostGIS, migration과 `227184/2659/131/5411` 확인
- backup·restore·교통 동기화 systemd unit 문법과 timer active 확인
- Prometheus 설정과 20개 rule을 `promtool`로 검증
- API metrics 9091 host 미노출, Prometheus 9090 loopback 전용
- API·relay·Alertmanager target `up`, DB/provider/backup/sync 지표 확인
- Alertmanager 설정을 `amtool`로 검증
- relay가 긴급·주의·복구 메시지를 Slack/Discord/일반 형식으로 변환
- 격리 HTTP 수신처로 실제 긴급 메시지와 상태 확인 버튼 전달
- 외부 URL 미설정 시 relay 구성 지표 `0`과 설정 필요 경보 확인
- 지표와 로그에 검색어·좌표·키·원문 없음

## 13. 폐기 대상 잔존 검사

lockfile과 외부 package를 제외한 1차 코드·설정·문서에서 폐기한 데이터
경로와 실행 변수가 다시 들어오지 않았는지 검사합니다. 검사 대상은
`apps`, `packages`, `scripts`, `docs`, 루트 문서, Dockerfile,
`.env.example`, `package.json`입니다.

삭제된 파일 경로는 Git status에 삭제 항목으로 보일 수 있지만 작업 파일
내용과 build asset에는 남지 않아야 합니다.

## 14. 현재 검증 기록

2026-07-26 15:03 KST 현재 작업 트리 검증:

- typecheck 통과
- 결정적 테스트 97개 통과: contracts 8, alert-relay 3, API 47, web 39
- production build 통과(Vite 단일 JS chunk 약 620KB 경고만 존재)
- format check와 `git diff --check` 통과
- 로컬 production build를 Chromium에서 1440·768·390·320px로 열어 헤더
  충돌·검색 폼 표시·가로 overflow 없음 확인
- `DATABASE_TEST_URL` 미지정으로 이 일반 실행에서는 PostGIS 5개 skip
- 공개 asset `index-z-oJH86J.js` 배포와 1440·768·390·320px Chromium smoke 통과

2026-07-26 01:26 KST 전체 공개·운영 스냅샷:

- PostgreSQL/PostGIS 통합 테스트 5개 통과
- 공개 strict 지도 E2E 2개 통과
- KAIST→대전역 8,000보 요청에서 조기 하차 7,995보, 목표 오차 -5보 확인
- KAIST 본원 중심→대전 갤러리아 HTTP 200, 추천 3건
- NAVER geocode/reverse HTTP 200
- readiness `227223/2797/134/5638`
- 백업 restore 스냅샷 `227184/2659/131/5411`
- 공개 bundle 서버 비밀값 미검출
- 백업 restore 통과
- Prometheus 3개 target `up`, 20개 rule healthy
- 교통 동기화 45개 성공·0개 실패와 상태 지표 확인
- Alertmanager 0.32.1 ready, 격리 수신처 relay HTTP 전달 확인
- 외부 운영 채널은 webhook 입력 전이며 구성 필요 경보 확인
- 구현 commit `b294a4d`의 GitHub CI run `30165571376` 품질·PostGIS 두 job 성공

2026-07-26 15:12 KST에 공개 health `ok`, readiness `ready`와 새 웹 asset을
확인했고 15:21 KST에 새 UI 전체 공개 E2E 2개가 통과했습니다. 자동 건강 경로
UX commit은 push 뒤 생성되는 CI 기록을 별도로 확인해야 합니다.

새 배포 후 이 절을 갱신하거나 별도 release 기록으로 이동합니다.
