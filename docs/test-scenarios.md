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
| `naver-responses-20260725.json` | geocode, reverse |
| `tago-responses-20260725.json` | 108번 경유노선·노선 정류장·도착 |
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

- contracts: 5개
- API: 20개
- web: 8개
- 합계: 33개

PostgreSQL 전용 4개는 `DATABASE_TEST_URL`이 없으면 일반 실행에서
건너뜁니다.

## 3. 공급자 테스트

### Kakao

- 실제 keyword/address/reverse/walk schema parsing
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

현재 4개 통합 시나리오:

1. migration 반복 적용, CSV COPY/upsert idempotency, 500m 거리 정렬
2. 공개 정류장과 실제 TAGO 정류장의 30m 연결
3. 변경된 migration checksum 거절
4. 실제 108번 노선 정류장 교체 실패 시 transaction rollback

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
- 공급자 오류와 정상 0건 구분

## 6. GPS·지도

- 위치 권한 허용→reverse→주소 Place
- 정상 주소 0건→현재 좌표 Place
- reverse 일시 장애→현재 좌표 Place
- 위치 권한 거절 안내
- NAVER SDK load와 인증 안정화
- auth failure·timeout→SVG
- 경로·정류장·승하차·차량 overlay
- 지도 cleanup과 SDK 재시도

## 7. 추천 엔진

- 출발·도착 50m 검증
- 마감 최대 6시간과 안전 여유시간
- 실제 TAGO 직행/1회 환승
- Kakao 도보 전후 구간
- 실시간 도착과 배차간격 추정
- 최대 9회 외부 경로 호출
- 15초 전체 timeout
- 마감·추가시간 필터
- route 중복 제거
- FAST/BALANCED/GOAL ID·타입 중복 금지
- 부분 후보 실패 warning

## 8. 공개 E2E

```bash
E2E_BASE_URL=https://chimap.madcamp-kaist.org \
E2E_REQUIRE_NAVER_MAP=1 \
pnpm test:e2e
```

현재 Playwright 시나리오:

1. 첫 방문 인트로와 건너뛰기
2. `대전 유성구 대학로 291` 검색
3. 한국과학기술원 직접 선택
4. 대전역 검색·직접 선택
5. 걸음·목표·마감·추가시간 입력
6. 추천 요청
7. 빠른·균형·목표 달성 카드 확인
8. NAVER 지도 인증과 공급자 표시 확인
9. 균형 경로 선택과 텍스트 단계
10. localStorage 저장
11. 새로고침 후 입력 복구
12. 1440/768/390/320px 가로 overflow 없음

배포 gate에서만 실행하고 외부 API 부하 테스트로 사용하지 않습니다.

## 9. 배포 보안 검사

- `.env` Git ignore
- 추적 파일 비밀값 검색
- 공개 JavaScript asset에 NAVER Client Secret 미포함
- 브라우저 변수와 서버 Client Secret 동일 값 거절
- API 로그에 query string·좌표·키·원문 없음
- Docker image에 root `.env` 없음

## 10. 폐기 대상 잔존 검사

lockfile과 외부 package를 제외한 1차 코드·설정·문서에서 폐기한 데이터
경로와 실행 변수가 다시 들어오지 않았는지 검사합니다. 검사 대상은
`apps`, `packages`, `scripts`, `docs`, 루트 문서, Dockerfile,
`.env.example`, `package.json`입니다.

삭제된 파일 경로는 Git status에 삭제 항목으로 보일 수 있지만 작업 파일
내용과 build asset에는 남지 않아야 합니다.

## 11. 현재 검증 기록

2026-07-25 KST:

- typecheck 통과
- 결정적 테스트 33개 통과
- PostGIS 통합 테스트 4개 통과
- production build 통과
- 공개 strict 지도 E2E 1개 통과
- 검색·역지오코딩 공개 smoke 통과
- readiness `228119/2188/127/4469`
- 공개 bundle 서버 비밀값 미검출
- 백업 restore 통과

새 배포 후 이 절을 갱신하거나 별도 release 기록으로 이동합니다.
