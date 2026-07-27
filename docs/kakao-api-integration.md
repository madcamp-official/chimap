# Kakao Local·도보·도로 경로 API

Kakao는 CHIMap의 장소·주소·역지오코딩·도보와 버스 표시용 도로 geometry
공급자입니다. 브라우저가 Kakao를 직접 호출하지 않고 Node API가 서버 전용
REST API 키로 호출합니다.

이 문서는 현재 구현과 2026-07-27에 확인한 Kakao 공식 문서를 기준으로
합니다. 쿼터·과금·콘솔 메뉴는 운영 정책에 따라 바뀔 수 있으므로 배포 때
공식 문서와 앱 콘솔의 현재 표시를 다시 확인합니다.

## 1. 런타임 사용 API

| 목적 | endpoint | timeout | 비고 |
| --- | --- | --- | --- |
| 키워드 검색 | `GET /v2/local/search/keyword.json` | 3초 | 장소명·상호명 |
| 주소 검색 | `GET /v2/local/search/address.json` | 3초 | 도로명·지번 |
| 좌표→주소 | `GET /v2/local/geo/coord2address.json` | 3초 | GPS 역검색 |
| 도보 경로 | `GET /v2/routing/walk` | 5초 | 버스 전후·운동 구간 |
| 도로 geometry | `POST /v1/waypoints/directions` | 5초 | TAGO 정류장 순서 도로 매칭 |

host:

```text
Local·도보: https://dapi.kakao.com
도로 geometry: https://apis-navi.kakaomobility.com
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

도로 geometry는 한 요청에 출발·도착과 최대 30개 경유 정류장을 전달합니다.
더 긴 버스 구간은 최대 32개 점 단위로 나누되 마지막 점을 다음 요청의
시작점으로 겹쳐 연결합니다. 반환 `sections[].roads[].vertexes`를 WGS84
좌표로 정규화하고 연속 중복점을 제거합니다. 성공 geometry는 승하차
정류장 쌍 기준 24시간 캐시합니다.

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
| 버스 도로 geometry | 24시간 |

검색 key는 정규화한 query, scope, limit, 소수점 다섯 자리 중심 좌표를
포함합니다. 같은 key의 진행 중 요청은 하나만 공급자에 전달합니다.

## 5. Kakao Developers 설정

Kakao Developers는 한 서비스 앱 안에서 REST API·JavaScript·Native App key를
유형별로 여러 개 등록하고 key별 Redirect URI, Client Secret, 허용 IP와 native
platform 정보를 설정할 수 있습니다. CHIMap은 서비스 앱 하나를 유지하고 다음
용도 key를 나눕니다.

```text
CHIMap Kakao 앱 / 하나의 App ID
  ├─ production-server REST key
  ├─ staging-server REST key
  ├─ production-mobile Native key
  └─ staging-mobile Native key
```

같은 앱 안의 key는 App ID, 사용자 service identity, 동의 설정과 앱 단위 quota를
공유합니다. key 분리는 허용 IP·callback·Bundle ID·rotation의 장애 범위를 줄이는
목적입니다. staging/production token의 `app_id`까지 다르게 해야 한다면 별도 test
app과 Kakao 서비스 정책을 먼저 확인합니다.

1. Kakao Developers에서 대상 앱을 선택합니다.
2. `[카카오맵] → [사용 설정] → [상태]`를 `ON`으로 설정합니다.
3. `[앱] → [플랫폼 키] → [REST API 키]`를 확인합니다.
4. REST API 키에 필요한 설정을 등록합니다.
5. 호출 허용 IP를 사용하면 운영 서버의 실제 outbound IP를 등록합니다.
6. `KAKAO_REST_API_KEY`를 서버 runtime에만 주입합니다.
7. keyword/address/coord2address/walk/waypoints directions를 각각 실제
   호출합니다.
8. 앱 정보의 `카카오맵 무료 쿼터` 배지와 쿼터 사용량을 확인합니다.

### 선택형 웹 로그인 추가 설정

같은 Kakao 앱의 환경별 REST API 키를 OAuth client ID로 사용하되 Client Secret과
Redirect URI도 해당 key에 환경별로 설정합니다.

1. 카카오 로그인을 활성화합니다.
2. nickname/profile image 동의 항목만 검토하고 email·전화번호 등은 로그인
   목적으로 요청하지 않습니다.
3. staging REST key에는 staging callback, production REST key에는 production
   callback을 한 글자도 다르지 않게 등록합니다.
4. Client Secret을 활성화하고 서버 token 교환 요청에만 사용합니다.
5. 서버에는 `KAKAO_OAUTH_CLIENT_SECRET`, `KAKAO_OAUTH_REDIRECT_URI`,
   `AUTH_SESSION_SECRET`, `AUTH_SESSION_TTL_DAYS`를 설정합니다.
6. 로그인 시작→동의→callback→CHIMap session→logout을 실제 계정으로
   검증합니다.

웹은 로그인 없이도 계속 이용할 수 있어야 합니다. 카카오 access/refresh
token은 사용자 정보 확인 중에만 메모리에서 사용하고 저장하지 않으며,
서비스 cookie에는 카카오 token이 아닌 별도 256-bit CHIMap session을
사용합니다. 상세 HTTP 계약은 [API 레퍼런스](./api-reference.md)를 따릅니다.
[Kakao Login REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api)

### iOS·Android 선택 로그인

React Native 앱은 환경별 `KAKAO_NATIVE_APP_KEY`를 native SDK에 주입합니다.
staging Native key에는 `org.madcamp.chimap.staging`, production Native key에는
`org.madcamp.chimap` iOS Bundle ID와 Android package를 등록하고
`kakao{NativeAppKey}` URL scheme를 생성합니다. Expo Go가 아니라 Development
Build에서 카카오톡 설치·미설치 흐름과 앱 복귀를 각각 검증합니다. 생성된
plist/manifest에 반대 OS 설정이 섞이지 않는지는 native config verifier가
확인합니다.

native SDK가 받은 Kakao access token은 CHIMap session으로 직접 사용하거나 기기에
장기 보관하지 않습니다. 앱은 `/api/v1/auth/kakao/mobile`에 전달하고 backend는
`access_token_info`의 `app_id`·만료를 확인한 뒤 `/v2/user/me` identity를 대조해
15분 access/30일 refresh CHIMap token pair를 발급합니다. provider token은 검증 뒤
폐기하며 CHIMap refresh token만 SecureStore에 저장합니다. Kakao 인증 장애·취소와
무관하게 guest 검색·추천·지도는 계속 동작해야 합니다.

2026-07-27 11:01 KST 운영 검증에서 익명 web session은
`kakaoLoginAvailable=true`, 로그인 시작은 HTTP 302, state cookie는
HttpOnly·Secure·SameSite=Lax였고 Kakao authorize endpoint도 302를
반환했습니다. mobile config는 운영 native credential 입력 전이라 guest만
활성화되고 Kakao provider는 disabled입니다. 실제 계정 동의→callback→logout과
native KakaoTalk 복귀는 사용자가 브라우저·기기에서 완료해야 하는 최종 확인
항목입니다.

2026-07-27 16:48 KST staging은 `staging-server` runtime key와 mobile auth를
구성해 `guestEnabled=true`, `kakaoEnabled=true`, `appleEnabled=false`를
반환합니다. 이는 server config 준비 상태이며 실제 iPhone의 KakaoTalk 성공·취소·
browser fallback과 refresh/logout/account deletion E2E를 대신하지 않습니다.

무료 쿼터 적용 범위, 초과 과금과 비즈월렛 필요 여부는 앱·계정 상태에 따라
달라질 수 있습니다. 저장소 문서의 고정 날짜나 추정 정책으로 판단하지 말고
배포 직전에 Kakao Developers 앱 화면의 `카카오맵 무료 쿼터` 배지, 사용량과
공식 과금 안내를 확인합니다. 비용 설정은 애플리케이션이 자동 변경하지
않습니다.

호출 허용 IP는 REST API 키별로 관리합니다. 서버 교체, NAT 변경 또는
Cloud provider 변경 시 outbound IP를 다시 확인합니다.

## 6. 오류와 재시도

| HTTP/상태 | 처리 | 운영 조치 |
| --- | --- | --- |
| 400 | 즉시 설정 오류 | parameter와 API 활성화 확인 |
| 401 | 즉시 설정 오류 | REST 키 종류·오탈자·재발급 확인 |
| 403 | 즉시 설정 오류 | Map ON·REST 설정·허용 IP 확인 |
| 429 | 한 번 제한 재시도 후 rate limit | 일·월 쿼터와 유료 설정 확인 |
| 500/502/503/504 | 한 번 제한 재시도 | 주소는 NAVER 보완, 도로 geometry는 정류장선 복구 |
| timeout/network | 한 번 제한 재시도 | 주소는 NAVER 보완, 도로 geometry는 정류장선 복구 |
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
- [Kakao 앱 key 환경별 추가 변경](https://developers.kakao.com/docs/en/getting-started/app-key-migration)
- [Kakao access token 정보](https://developers.kakao.com/docs/en/kakaologin/rest-api#retrieve-token-info)
- [Kakao Mobility 다중 경유지 길찾기](https://developers.kakaomobility.com/guide/navi-api/waypoints.html)

설정이 정확한데도 403이 계속되면 앱 OWNER 계정으로 DevTalk 지도/로컬 API
게시판에 앱 ID, request ID, HTTP 상태만 제공하고 키 원문은 전달하지
않습니다.
