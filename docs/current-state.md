# 구현·운영 현황

이 문서는 2026-07-25 KST에 실제 소스, 실행 컨테이너, 공개 도메인과
PostgreSQL을 대조한 배포 스냅샷입니다. 수시로 바뀌는 운영 수치는 새 배포
검증 때 갱신합니다.

## 1. 진행 이력 요약

### UI·도메인

- 지도 중심 검색·추천 화면과 반응형 구조 구현
- 등고선·경로 선·타이포그래피 기반 랜딩 인트로 적용
- 운영 도메인을 `chimap.madcamp-kaist.org`로 확정
- Cloudflare Tunnel과 공개 HTTPS 연결
- NAVER Web Dynamic Map 실제 인증과 경로 overlay 확인

### 실제 검색·교통

- 검색 버튼과 Enter가 동작하지 않던 입력을 실제 장소 검색 API로 교체
- Kakao keyword/address/reverse와 NAVER geocode/reverse 보완 구현
- GPS 현재 위치와 좌표 전용 복구 구현
- TAGO 정류장·노선·도착·차량을 추천과 지도에 연결
- KAIST→대전역 직행·환승 관계와 실제 추천 검증

### 데이터·운영

- 기존 영속 SQLite DB와 import 대상이 없음을 확인
- SQLite 데이터 복사 없이 PostgreSQL/PostGIS를 새로 구성
- 전국 정류장 CSV와 TAGO로 DB 적재
- API repository와 호출부를 비동기 `pg.Pool`로 전환
- Docker Compose가 API·PostgreSQL 재시작과 health를 관리하도록 통합
- 별도 Node 프로세스 관리자는 도입하지 않음
- DB custom-format 백업과 별도 restore 시험 완료

### 보안·계약

- 환경변수 템플릿을 루트 `.env.example` 하나로 통합
- 브라우저 공개 NAVER Client ID와 서버 Client Secret 분리
- 공개 health와 추천 계약에서 폐기된 실행 형태 필드 제거
- 내장 대체 경로와 외부 실패 시 임의 데이터 전환 제거
- 공개 bundle 서버 비밀값 검사 추가

## 2. 현재 결론

| 항목 | 상태 |
| --- | --- |
| 공개 도메인 | `https://chimap.madcamp-kaist.org` 정상 |
| API | `chimap:actual-data`, 단일 Node.js 프로세스, healthy |
| DB | PostgreSQL 18 + PostGIS 3.6, healthy |
| 외부 진입 | Cloudflare Tunnel→`127.0.0.1:3000` |
| 장소·주소 | Kakao 우선, NAVER 주소 보완 |
| 도보 | Kakao Routing |
| 버스 | TAGO + PostgreSQL 정적 교통 데이터 |
| 프로세스 관리 | Docker Compose |
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
    "stops": 228119,
    "linkedStops": 2188,
    "routes": 127,
    "routeStops": 4469
  }
}
```

`timestamp`는 호출마다 바뀌므로 스냅샷에서 생략했습니다. 네 교통 통계가
모두 0보다 크고 DB·PostGIS·migration·공급자 키가 준비된 경우에만
readiness가 HTTP 200을 반환합니다.

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

- 출발·도착 500m 안의 실제 정류장 탐색
- 직행 또는 최대 1회 환승 버스 후보 생성
- TAGO 도착정보 우선, 없으면 실제 노선의 배차·정류장 정보로 추정
- Kakao 도보 경로를 버스 전후와 운동 구간에 사용
- 빠른·균형·목표 달성 최대 3개 추천
- NAVER 지도에 경로, 정류장, 승하차, 차량 표시
- NAVER SDK 장애 시 동일 추천 좌표 SVG 표시
- 첫 방문 3초 인트로와 `prefers-reduced-motion` 처리

### PostgreSQL/PostGIS

- `schema_migrations`, `bus_stops`, `bus_routes`, `bus_route_stops`
- migration advisory lock과 SHA-256 checksum 검증
- CSV 임시 테이블/COPY/upsert
- `geography(Point,4326)` + GiST 반경 검색
- 30m·이름 유사도 기반 CSV↔TAGO 정류장 연결
- 노선 정류장 전체 교체 transaction과 deadlock 제한 재시도
- graceful shutdown 시 HTTP 종료 후 `pool.end()`

### 운영

- PostgreSQL host port 미노출
- API만 `127.0.0.1:3000`에 bind
- API와 PostgreSQL healthcheck
- 이전 실행 컨테이너와 이전 CHIMap 태그 정리
- 공개 도메인에서 실제 검색·추천·NAVER 지도 E2E 통과

## 5. 검증 기록

| 검증 | 결과 |
| --- | --- |
| TypeScript typecheck | 통과 |
| production build | 통과 |
| 계약·API·웹 테스트 | 33개 통과 |
| PostgreSQL/PostGIS 통합 테스트 | 4개 통과 |
| 공개 strict 지도 E2E | 1개 통과 |
| KAIST→대전역 실제 추천 | 최대 3개 카드 반환 확인 |
| 검색/역지오코딩 공개 smoke | Kakao 200 응답 확인 |
| 공개 번들 서버 비밀값 검사 | 미검출 |
| 폐기 대상 용어·설정 내용 검색 | 0건 |
| `git diff --check` | 통과 |

## 6. 백업·복구 기록

2026-07-25 최초 실제 데이터 동기화 후 custom-format 백업을 생성했습니다.

```text
파일: /var/backups/chimap/chimap-20260725-post-sync.dump
크기: 17,350,574 bytes
SHA-256: 191047856ec0bcce4d144c4a19fbfa88270b5da779aeb6cacd781b0b925bc802
```

별도 PostgreSQL/PostGIS DB로 restore한 뒤 extension과
`228119/2188/127/4469` 통계를 다시 확인했습니다.

## 7. 필수 후속 운영 조치

과거 빌드 과정에서 NAVER 서버 Client Secret이 브라우저 변수 위치에
잘못 입력됐던 이력이 있습니다. 현재 공개 번들에서는 제거됐고, 같은 값이
다시 입력되면 API 설정 검증이 기동을 거절합니다. 그러나 과거 노출 가능성을
무효화하려면 운영자가 NCP 콘솔에서 Client Secret을 재발급해야 합니다.

1. NAVER Cloud Platform→Application Services→Maps→Application
2. 현재 CHIMap Application의 인증 정보에서 Client Secret 재발급
3. 루트 `.env`의 `NAVER_MAP_NCP_KEY`만 교체
4. `VITE_NAVER_MAP_NCP_KEY_ID`에는 공개 Client ID 유지
5. API를 다시 build·배포
6. geocode, reverse, Web Dynamic Map과 공개 번들 검사를 다시 수행

현재 로컬 구현 변경은 이 스냅샷 작성 시점에 아직 Git commit/push되지
않았습니다. 배포 브랜치에 반영하기 전에 `git status`, 전체 검증과 비밀값
검사를 다시 실행해야 합니다.

## 8. 현재 한계와 확장 조건

- 전국 정류장은 적재했지만 노선과 노선-정류장 관계는 사용 지역을 중심으로
  점진적으로 동기화합니다.
- API는 프로세스 로컬 캐시와 rate limit을 사용하므로 단일 인스턴스로
  운영합니다.
- 수평 확장 시 Redis 기반 공유 캐시·single-flight·rate limit과 DB
  connection budget 재설계가 선행되어야 합니다.
- 검색과 추천 성능은 외부 공급자 지연의 영향을 받으므로 p95와 공급자별
  timeout을 함께 관찰해야 합니다.
