# NAVER 지도 연동

CHIMap은 NAVER Web Dynamic Map을 화면 renderer로만 사용한다. 장소 검색,
도보 경로는 Kakao REST, 버스 정류장·노선·도착·차량은 TAGO에서 받고, API
서버가 WGS84 공개 계약으로 정규화한 뒤 NAVER `Polyline`과 `Marker`로
그린다.

이 문서는 2026-07-24 기준 공식
[Application 등록 가이드](https://guide.ncloud-docs.com/docs/maps-app),
[JavaScript API v3 시작하기](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html),
[Map 기본 동작](https://navermaps.github.io/maps.js.ncp/docs/tutorial-Map.html),
[Marker 명세](https://navermaps.github.io/maps.js.ncp/docs/naver.maps.Marker.html)를
기준으로 한다. 정책과 요금은 운영 직전에 다시 확인한다.

## 역할 분리

| 기능 | 담당 | 자격증명 위치 |
|---|---|---|
| 지도 타일, 이동/줌, 축척, 저작권 UI | NAVER Web Dynamic Map | 웹 공개 Client ID |
| 장소 검색 | Kakao REST | API 서버 REST 비밀키 |
| 도보 경로 | Kakao REST | API 서버 REST 비밀키 |
| 버스 정류장·노선·도착·차량 | TAGO OpenAPI | API 서버 공공데이터 인증키 |
| 후보 생성과 추천 | CHIMap API | 없음 |
| 경로선/마커 | NAVER SDK + 정규화된 Kakao/TAGO 좌표 | 웹 메모리 |

웹은 Kakao Map JavaScript SDK를 로드하지 않으며 API는 NAVER Directions,
Geocoding 또는 Search API를 호출하지 않는다.

## NAVER Cloud 설정

1. NAVER Cloud Platform 콘솔에서 Maps Application을 등록한다.
2. Maps 서비스 중 `Web Dynamic Map`을 선택한다.
3. Web 서비스 URL에 다음을 등록한다.

   ```text
   http://localhost
   http://madcamp-kaist.org
   ```

   공식 가이드는 Web 서비스 URL을 `http://`로 입력하고, http/https를
   구분하지 않으며, 포트·경로 없이 서브도메인의 대표 도메인을 등록하라고
   안내한다. 실제 운영 페이지는 `https://chimap.madcamp-kaist.org`다.
4. 발급된 Client ID를 웹 빌드 변수에 넣는다.
5. Client Secret은 복사하거나 웹에 주입하지 않는다.

```dotenv
# .env
VITE_NAVER_MAP_NCP_KEY_ID=replace-with-client-id
VITE_APP_MODE=live
VITE_API_BASE_URL=
```

루트 `.env` 하나를 API와 Vite가 함께 읽는다. 비어 있는
`VITE_API_BASE_URL`은 개발에서 `http://localhost:8080`, production에서
same-origin `/api`를 사용한다. Vite의 `VITE_*` 값은 공개 번들에 들어가므로
Client ID를 비밀로 취급할 수는 없고, 콘솔의 Web 서비스 URL 제한이 필수
방어선이다.

## SDK 로드 계약

`MapView`는 공식 통합 endpoint와 현재 인증 query 이름을 사용한다.

```text
https://oapi.map.naver.com/openapi/v3/maps.js
  ?ncpKeyId={VITE_NAVER_MAP_NCP_KEY_ID}
  &callback=__chimapNaverMapsReady
```

- script는 비동기로 한 번만 로드한다.
- 이미 `window.naver.maps`가 있으면 재사용한다.
- SDK가 namespace를 만들기 전에 callback을 먼저 호출하는 경우도 별도
  namespace 대기로 처리한다.
- namespace가 보인 뒤 500ms 인증 안정화 구간을 두고 그 사이
  `navermap_authFailure`가 오면 map/overlay를 만들지 않는다.
- 12초 안에 callback이 오지 않으면 timeout으로 처리한다.
- script 오류, timeout, 전역 `navermap_authFailure`에서는 실패한 promise와
  script를 정리해 사용자가
  `다시 불러오기`로 재시도할 수 있게 한다.
- callback 후 `Map`, `LatLng`, `LatLngBounds`, `Polyline`, `Marker`와 지도
  상수가 모두 준비됐는지 확인한다. namespace만 부분적으로 생긴 상태는
  인증/SDK 오류로 분류한다.
- 지도 또는 overlay 생성 중 SDK가 예외를 내면 React 트리를 중단하지 않고
  생성된 overlay를 정리한 뒤 fallback 상태로 전환한다.
- 인증 실패 과정에서 SDK가 내부 namespace를 제거해도 overlay 해제와
  `Map.destroy()` 예외가 앱까지 전파되지 않도록 cleanup을 방어한다.

## 경로 렌더링 계약

```text
Kakao 도보 [x,y] + TAGO 정류장/차량 WGS84
→ API normalizer {lng, lat}
→ Recommendation.legs[].coordinates
→ new naver.maps.LatLng(lat, lng)
→ naver.maps.Polyline
```

선택 경로는 opacity `0.95`, z-index `20`으로 표시하고 비교 경로는 opacity
`0.2`, z-index `10`으로 둔다. 스타일은 다음과 같다.

| 구간 | 색 | 선 |
|---|---|---|
| 버스 | 파랑 | 6px 실선 |
| 지하철 | 보라 | 6px 실선 |
| 일반 도보 | 회색 | 5px 짧은 점선 |
| 추가 운동 | 오렌지 | 8px 실선 |

출발, 운동 시작, 도착은 `HtmlIcon`을 쓰는 NAVER `Marker`다. 모든 유효 경로
좌표와 양 끝점을 `LatLngBounds`에 포함하고 `fitBounds`를 적용한다. 모바일
지도 DOM 자체를 55vh 바텀시트 위의 가시 영역으로 제한해 NAVER 저작권
컨트롤이 시트 뒤에 숨지 않게 하며, 상단 검색 패널 여백과 최대 zoom 16을
적용한다. zoom 컨트롤은 검색 패널과 겹치지 않도록 오른쪽 중앙에 둔다.

경로 선택이 바뀌면 이전 overlay에 `setMap(null)`을 호출한다. 컴포넌트가
사라질 때 overlay를 정리한 뒤 NAVER `Map.destroy()`를 호출한다.

## 사용자 상태

| 상태 | 화면 |
|---|---|
| Client ID 없음 | SVG 경로 미리보기 + 키 없음 안내 |
| SDK 로딩 | SVG 미리보기 + NAVER 로딩 안내 |
| SDK 준비 | NAVER 지도 + TAGO/Kakao 정규화 경로 overlay |
| SDK 오류/timeout/auth 실패 | SVG 미리보기 + 재시도 |

모든 상태에서 추천 카드와 텍스트 이동 단계가 정보의 접근 가능한 원본이다.
지도에는 live에서 `NAVER 지도 + TAGO 경로`, mock에서
`NAVER 지도 + DEMO 경로` 칩을 표시하며 NAVER 로고와 지도 데이터 저작권
컨트롤을 끄거나 가리지 않는다.

## CSP와 운영 확인

CSP를 적용할 때는 정확한 운영 응답을 브라우저에서 관찰해 최소 origin만
허용한다. 최소한 SDK script endpoint, NAVER 지도 tile/asset endpoint,
same-origin API 연결이 필요하다. 임의의 광범위 wildcard는 사용하지 않는다.

live smoke:

1. `https://chimap.madcamp-kaist.org`에서 브라우저 개발자 도구를 연다.
2. NAVER SDK 요청이 200이고 인증 오류가 없는지 확인한다.
3. 초기 대전 지도가 보이고 NAVER 저작권 UI가 가려지지 않는지 확인한다.
4. Kakao/TAGO live 추천 1회를 실행한다.
5. 카드 선택 시 선 강조, 출발/운동 시작/도착 마커와 bounds를 확인한다.
6. DOM, source map, network response에 Kakao REST key나 NAVER Client
   Secret이 없는지 확인한다.
7. 잘못된 Client ID로 한 번 확인해 SVG 폴백과 재시도가 유지되는지 확인한다.

## 2026-07-24 공개 환경 확인 결과

- 공개 번들의 Client ID가 저장소 루트 `.env` 값과 일치함을 확인했다.
- `maps.js?ncpKeyId=...` script는 HTTP 200이다.
- 이어지는 NAVER `/v3/auth` 요청은 HTTP 401이다.
- `ncpKeyId`와 legacy `ncpClientId`, http/https 및 대표/서브도메인 등록
  후보를 브라우저 문맥에서 대조했지만 같은 401이었다.
- 인증 실패 시 앱 본문, 추천 UI, SVG fallback, 재시도 버튼이 유지되고
  page error가 없음을 확인했다.

따라서 현재 상태는 “Client ID가 번들에 포함됨”이지 “실제 NAVER 타일 연결
완료”가 아니다. Application의 Web Dynamic Map 선택, Client ID 종류와 Web
서비스 URL을 NAVER 콘솔에서 다시 확인한 뒤 `/v3/auth` 성공과 실제 타일을
release gate로 확인해야 한다. SDK script 200만으로 성공 판정하지 않는다.

현재 단위 테스트는 callback/namespace 순서, 인증 실패, 재시도, overlay
정리와 map destroy 회귀를 모사한다. Playwright는 지도 키가 없는 mock
환경에서 SVG fallback을 검증한다.

## 정책 확인 게이트

공식 Kakao 문서는 REST API가 장소와 도보 데이터를 조회하고, TAGO는 버스
정류장·노선·도착·위치 데이터를 제공하며,
NAVER 문서는 Web Dynamic Map이 웹 지도 기능을 제공한다고 설명한다. 다만
기술적으로 결합 가능하다는 사실만으로 교차 표시의 계약상 허용 범위가
확정되지는 않는다.

공개 live 전환 전 서비스 소유자는 다음을 확인한다.

- Kakao 장소·도보와 TAGO 버스 데이터의 외부 basemap 표시 허용 범위
- NAVER 지도 위 제3자 경로 데이터 overlay 허용 범위
- 양사 로고, 출처, 상표 표시 의무
- 캐시와 경로 데이터 보존 제한
- 최신 무료량, 과금 계정과 지출 상한

확인이 끝나기 전에는 mock 데모와 기술 smoke를 운영 승인으로 간주하지 않는다.
