# NAVER 지도와 Geocoding

NAVER는 브라우저 지도 렌더링과 Kakao 주소 검색 보완을 담당합니다. Web
Dynamic Map과 서버 REST API는 같은 Application을 사용할 수 있지만
브라우저·서버 자격 증명의 노출 범위를 엄격히 분리합니다.

## 1. 자격 증명

| 변수 | 위치 | 값 |
| --- | --- | --- |
| `VITE_NAVER_MAP_NCP_KEY_ID` | 브라우저 bundle | 공개 Client ID |
| `NAVER_MAP_NCP_KEY_ID` | 서버 runtime | REST 요청 Client ID |
| `NAVER_MAP_NCP_KEY` | 서버 runtime | Client Secret |

같은 Maps Application에서 Dynamic Map, Geocoding, Reverse Geocoding을
선택했다면 두 ID 변수는 같은 Client ID를 사용할 수 있습니다. Application을
나눴다면 각 Application의 Client ID를 사용합니다.

Client Secret은 어떤 경우에도 `VITE_` 변수, Docker build argument, 정적
asset, 문서와 로그에 넣지 않습니다. 서버 설정은 공개 ID와 Client Secret이
같으면 기동을 거절합니다.

## 2. Maps Application 설정

NAVER Cloud Platform에서:

1. Application Services→Maps→Application
2. CHIMap Application 등록 또는 수정
3. Dynamic Map, Geocoding, Reverse Geocoding 선택
4. Web 서비스 URL에 `https://chimap.madcamp-kaist.org` 등록
5. Client ID와 Client Secret 확인
6. 이용 한도와 임계치 알림 설정

Web 서비스 URL에는 port와 path를 넣지 않습니다. localhost를 추가로
사용하려면 콘솔 정책에 맞는 별도 URL을 등록합니다.

API가 선택되지 않으면 429 Quota Exceeded로 보일 수 있으므로 실제 사용량만
확인하지 말고 Application의 API 선택 상태도 확인합니다.

## 3. Web Dynamic Map

SDK 요청:

```text
https://oapi.map.naver.com/openapi/v3/maps.js
  ?ncpKeyId=${VITE_NAVER_MAP_NCP_KEY_ID}
  &callback=__chimapNaverMapsReady
```

현재 로더:

- script element ID를 고정해 중복 load 방지
- load timeout 12초
- namespace 확인 후 500ms 인증 안정화
- `navermap_authFailure` 감지
- 실패 시 script·map·overlay 정리
- 사용자 재시도 시 SDK 재요청

지도에는 추천 경로 polyline, 출발·도착, 운동 구간, 첫 승차·환승·최종
하차와 탑승 정류장에 가장 가까이 접근 중인 차량을 구간별 최대 1대
표시합니다. 버스 중간 정류장은 마커로 표시하지 않습니다. 버스 polyline은
TAGO 정류장 순서를 Kakao Mobility Directions 도로 vertex에 매칭한 좌표를
사용합니다. 노선 전체 차량과 이미 탑승 순서를 지난 차량은 표시하지 않으며
차량 좌표는 지도 bounds 계산에서 제외합니다.

SDK 인증·network·timeout 장애가 발생해도 추천 데이터는 제거하지 않습니다.
동일 추천 응답의 실제 좌표를 SVG로 표시하고 카드와 텍스트 이동 단계를
유지합니다.

## 4. 서버 Geocoding

공통 host:

```text
https://maps.apigw.ntruss.com
```

요청 header:

```http
x-ncp-apigw-api-key-id: ${NAVER_MAP_NCP_KEY_ID}
x-ncp-apigw-api-key: ${NAVER_MAP_NCP_KEY}
Accept: application/json
```

endpoint:

| 목적 | endpoint |
| --- | --- |
| 주소→좌표 | `GET /map-geocode/v2/geocode` |
| 좌표→주소 | `GET /map-reversegeocode/v2/gc` |

이전 `naveropenapi.apigw.ntruss.com` host를 사용하지 않습니다.

Geocoding은 최대 10개 결과 중 요청 limit만 사용하고 건물명→도로명→지번
순서로 Place 이름을 구성합니다. Reverse Geocoding은
`roadaddr,addr,admcode,legalcode` 순서로 요청해 상세 주소가 없는 지역도
행정·법정동을 확인할 수 있게 합니다.

## 5. 보완 조건

NAVER 서버 API는 다음 경우에만 호출합니다.

- Kakao 주소 결과 0건
- Kakao timeout
- Kakao network 오류
- Kakao 429
- Kakao 5xx

Kakao 400·401·403은 설정 오류를 숨기지 않고 즉시 실패합니다.
NAVER Geocoding은 주소와 건물 주소만 제공하며 일반 상호명 POI 검색을
대체하지 않습니다.

NAVER까지 정상 0건이면 검색은 빈 목록, 역지오코딩은 `place: null`을
반환합니다. NAVER 자체가 실패하면 정상 0건으로 숨기지 않습니다.

## 6. 오류 처리

| HTTP/상태 | 처리 | 운영 확인 |
| --- | --- | --- |
| 200 + 정상 결과 | 정규화 | 결과 수 |
| 200 + 정상 0건 | `NONE` 또는 `place:null` | query/좌표 |
| 400 | 공급자 오류 | parameter |
| 401/403 | 즉시 설정 오류 | ID·Secret·Application |
| 429 | 한 번 제한 재시도 | API 선택·quota·throttle |
| 500/502/503/504 | 한 번 제한 재시도 | 서비스 상태 |
| timeout/network | 한 번 제한 재시도 | outbound/network |

NAVER REST timeout은 3초이고 최대 두 번 시도합니다.

host에서는 연결되지만 Docker 컨테이너에서 TLS handshake만 timeout 되면
인증보다 먼저 bridge path MTU를 확인합니다. CHIMap Compose network는
다음 값을 고정합니다.

```yaml
driver_opts:
  com.docker.network.driver.mtu: "1400"
```

변경 후 network를 실제로 재생성하고 운영 컨테이너 안에서 geocode와 reverse
HTTP 200을 다시 확인합니다. host 호출 성공만으로 서버 보완 경로가
정상이라고 판정하지 않습니다.

## 7. 배포 전·후 검증

배포 전:

1. 알려진 주소→좌표 HTTP 200
2. KAIST 인근 좌표→주소 HTTP 200
3. 공개 Client ID와 서버 Client Secret이 다른지 확인
4. 운영 URL에 port/path가 없는지 확인

배포 후:

1. `/v3/auth` 및 SDK load 성공
2. map instance 생성
3. 추천 polyline과 marker 표시
4. `E2E_REQUIRE_NAVER_MAP=1` Playwright 통과
5. 공개 JavaScript asset에서 서버 Client Secret 미검출

## 8. Client Secret 재발급

과거 bundle 노출 가능성이 있는 Client Secret은 재사용하지 않습니다.

1. Maps Application→인증 정보
2. Client Secret `[재발급]`
3. `.env`의 `NAVER_MAP_NCP_KEY`만 교체
4. API 재build·재배포
5. geocode/reverse와 strict 지도 E2E 재검증
6. 공개 asset 비밀값 검사

Client ID는 Web Dynamic Map 인증에 쓰이는 공개 식별자이지만 Client Secret은
서버 밖으로 노출하지 않습니다.

## 9. 공식 참고자료

- [NAVER Maps Application](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)
- [NAVER Maps API 공통 설정](https://api.ncloud-docs.com/docs/application-maps-overview)
- [NAVER Geocoding](https://api.ncloud-docs.com/docs/ko/application-maps-geocoding)
- [NAVER Reverse Geocoding](https://api.ncloud-docs.com/docs/application-maps-reversegeocoding)
- [NAVER 지도 JavaScript Client ID](https://navermaps.github.io/maps.js.ncp/docs/tutorial-1-Getting-Client-ID.html)
- [NAVER Maps 문제 해결](https://guide.ncloud-docs.com/docs/application-maps-troubleshoot)
