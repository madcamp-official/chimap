# Kakao Local과 경로 API

Kakao는 CHIMap의 장소·주소·역지오코딩·도보 공급자입니다. 브라우저가
Kakao를 직접 호출하지 않고 Node API가 서버 전용 REST API 키로 호출합니다.

## 1. 런타임 사용 API

| 목적 | endpoint | timeout | 비고 |
| --- | --- | --- | --- |
| 키워드 검색 | `GET /v2/local/search/keyword.json` | 3초 | 장소명·상호명 |
| 주소 검색 | `GET /v2/local/search/address.json` | 3초 | 도로명·지번 |
| 좌표→주소 | `GET /v2/local/geo/coord2address.json` | 3초 | GPS 역검색 |
| 도보 경로 | `GET /v2/routing/walk` | 5초 | 버스 전후·운동 구간 |

host:

```text
https://dapi.kakao.com
```

인증:

```http
Authorization: KakaoAK ${KAKAO_REST_API_KEY}
Accept: application/json
```

좌표 입력과 출력은 WGS84를 사용합니다. 키워드 검색 중심 좌표를 제공하면
Kakao `sort=distance`를 사용하지만 검색 반경 자체는 제한하지 않습니다.

Kakao 대중교통 응답 normalizer도 코드에 존재하지만 운영 추천의 버스
정류장·노선·도착·차량은 TAGO 경로로 구성합니다.

## 2. 검색 전략

### `scope=suggest`

1. Kakao keyword
2. 0건 또는 복구 가능한 장애이면 Kakao address
3. 최종 0건 또는 복구 가능한 장애이면 NAVER geocode

### `scope=resolve`

1. Kakao keyword와 address 병렬
2. 장소명·주소·좌표를 정규화
3. 같은 주소이고 20m 이내면 하나로 병합
4. exact 장소명·주소를 우선
5. 결과가 없거나 복구 가능한 장애이면 NAVER geocode

Kakao 결과가 하나라도 있으면 NAVER 결과와 섞지 않습니다. NAVER는 주소
보완이며 일반 POI 검색 대체가 아닙니다.

## 3. 정규화

### keyword

- ID: `kakao:place:{providerPlaceId}`
- 이름: `place_name`
- 지번: `address_name`
- 도로명: `road_address_name`
- 카테고리: group name 우선
- 좌표: `x→lng`, `y→lat`

### address

- ID: 주소·좌표 SHA-256 기반 `kakao:address:`
- 이름: 건물명→도로명→지번 순
- 좌표가 WGS84 범위를 벗어나면 제외

### reverse

- 첫 document의 도로명·지번을 사용
- 주소가 비어 있으면 `place: null`
- 요청 좌표를 Place 좌표로 유지

## 4. 캐시

| 결과 | TTL |
| --- | --- |
| 장소 검색 성공 | 10분 |
| 장소 검색 정상 0건 | 60초 |
| 역지오코딩 | 24시간 |
| 도보 경로 | 30분 |

검색 key는 정규화한 query, scope, limit, 소수점 다섯 자리 중심 좌표를
포함합니다. 같은 key의 진행 중 요청은 하나만 공급자에 전달합니다.

## 5. Kakao Developers 설정

1. Kakao Developers에서 대상 앱을 선택합니다.
2. `[카카오맵] → [사용 설정] → [상태]`를 `ON`으로 설정합니다.
3. `[앱] → [플랫폼 키] → [REST API 키]`를 확인합니다.
4. REST API 키에 필요한 설정을 등록합니다.
5. 호출 허용 IP를 사용하면 운영 서버의 실제 outbound IP를 등록합니다.
6. `KAKAO_REST_API_KEY`를 서버 runtime에만 주입합니다.
7. keyword/address/coord2address/walk를 각각 실제 호출합니다.
8. 앱 정보의 `카카오맵 무료 쿼터` 배지와 쿼터 사용량을 확인합니다.

Kakao 공식 정책상 2026-07-21부터 개발자 계정에서 첫 번째로 Kakao Map을
활성화한 앱에만 무료 쿼터가 제공됩니다. 두 번째 이후 앱이거나 무료 쿼터를
초과하면 비즈월렛 연결과 유료 API 설정이 필요합니다. 비용 설정은
애플리케이션이 자동 변경하지 않습니다.

호출 허용 IP는 REST API 키별로 관리합니다. 서버 교체, NAT 변경 또는
Cloud provider 변경 시 outbound IP를 다시 확인합니다.

## 6. 오류와 재시도

| HTTP/상태 | 처리 | 운영 조치 |
| --- | --- | --- |
| 400 | 즉시 설정 오류 | parameter와 API 활성화 확인 |
| 401 | 즉시 설정 오류 | REST 키 종류·오탈자·재발급 확인 |
| 403 | 즉시 설정 오류 | Map ON·REST 설정·허용 IP 확인 |
| 429 | 한 번 제한 재시도 후 rate limit | 일·월 쿼터와 유료 설정 확인 |
| 500/502/503/504 | 한 번 제한 재시도 | 주소는 NAVER 보완, 도보는 오류 |
| timeout/network | 한 번 제한 재시도 | 주소는 NAVER 보완, 도보는 오류 |
| 사용자 AbortSignal | 즉시 취소 | 오래된 UI 요청은 표시하지 않음 |

400·401·403은 NAVER 보완으로 숨기지 않습니다. 주소 공급자까지 실패하면
정상 0건으로 변환하지 않고 정규화된 API 오류를 반환합니다.

## 7. 관측과 보안

로그에 남길 수 있는 값:

- provider
- strategy
- item count
- duration
- HTTP status를 정규화한 error code

로그에 남기지 않는 값:

- 검색어
- 좌표
- REST API 키
- Authorization header
- 응답 원문

## 8. 공식 참고자료

- [Kakao Map 이해하기와 사용 방법](https://developers.kakao.com/docs/ko/kakaomap/common)
- [Kakao Map REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api)
- [Kakao REST API 호출 허용 IP](https://developers.kakao.com/docs/ko/rest-api/getting-started)
- [Kakao 앱 설정](https://developers.kakao.com/docs/ko/app-setting/app)

설정이 정확한데도 403이 계속되면 앱 OWNER 계정으로 DevTalk 지도/로컬 API
게시판에 앱 ID, request ID, HTTP 상태만 제공하고 키 원문은 전달하지
않습니다.
