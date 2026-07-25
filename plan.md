# CHIMap 실제 데이터 운영 구현 계획과 완료 상태

기준일은 2026-07-25 KST입니다. 구현과 최초 운영 전환은 완료됐으며,
운영자만 수행할 수 있는 NAVER Client Secret 재발급과 Git release가 남아
있습니다. 현재 수치는 [구현·운영 현황](./docs/current-state.md)을
참고합니다.

## 1. 확정된 기술 결정

- 장소·주소·역지오코딩·도보는 Kakao 우선, NAVER 주소 보완
- 버스 정류장·노선·도착·차량은 TAGO
- PostgreSQL 18 + PostGIS에 정적 교통 데이터만 영속 저장
- Docker Compose가 단일 Node API와 PostgreSQL을 관리
- Cloudflare Tunnel은 `127.0.0.1:3000`으로 연결
- 별도 프로세스 관리자를 추가하지 않음
- 운영 도메인은 `https://chimap.madcamp-kaist.org`
- 사용자 검색·위치·추천 요청과 실시간 원문은 영구 저장하지 않음

## 2. 구현 단계

| 단계 | 상태 | 결과 |
| --- | --- | --- |
| 공개 계약 단순화 | 완료 | health 최소화, route source `KAKAO\|TAGO`, 검색 meta |
| 장소·주소 검색 | 완료 | suggest/resolve, 중복 제거, NAVER 보완, 캐시 |
| 역지오코딩 | 완료 | Kakao→NAVER, GPS 좌표 전용 복구 |
| 프런트 검색 UX | 완료 | 300ms, Enter/버튼, AbortSignal, 선택 필수 |
| 지도 | 완료 | NAVER SDK, 경로·마커·차량, SVG 복구 |
| PostgreSQL/PostGIS | 완료 | migration, COPY, 공간 검색, transaction |
| TAGO 실제 버스 | 완료 | 정류장·노선·도착·차량, KAIST/대전역 동기화 |
| 추천 | 완료 | 직행/1회 환승, Kakao 도보, 최대 3개 경로 |
| Compose 운영 | 완료 | API/DB healthcheck, 내부 network, named volume |
| 실제 데이터 import | 완료 | 전국 정류장과 대전 초기 노선 |
| 백업·restore | 완료 | custom-format 백업과 별도 DB 복구 검증 |
| 공개 배포·E2E | 완료 | 검색→추천→지도→저장·반응형 검증 |
| NAVER Secret 재발급 | 운영자 조치 필요 | 과거 노출 가능성 무효화 |
| Git release | 대기 | 최종 변경 commit/push 필요 |

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
- NAVER 지도에 경로가 표시됨
- SDK 장애 시 동일 실제 좌표 SVG가 표시됨
- 타입검사, 테스트, build, 공개 strict E2E 통과
- 폐기 대상 용어·변수 내용 검색 0건
- 공개 health 계약과 운영 도메인 정상

## 5. 운영 계획

### 매일

- health/readiness와 컨테이너 health 확인
- `pg_dump -Fc` 백업 생성
- 검색 0건률, NAVER 보완률, 429/5xx, p95, TAGO timeout 확인

### 매주

- 일간 7개·주간 4개 보존 상태 확인
- route sync 실패 코드와 DB 증가량 검토
- 공급자 쿼터·알림 임계치 검토

### 매월

- 별도 임시 DB restore 검증
- migration checksum, PostGIS, 공간 질의, 네 교통 통계 확인
- 외부 공급자 콘솔의 도메인·IP·API 선택 상태 점검

### 확장 시

- Redis 공유 캐시, single-flight, rate limit 도입
- API 인스턴스 수×pool 크기가 PostgreSQL connection budget을 넘지 않게 조정
- API 컨테이너 수평 확장과 무중단 origin 전환
