# Kakao 장소·도보 REST API 연동

이 문서는 2026-07-24 기준으로 확인한 Kakao 장소·경로 REST API 계약과
CHIMap의 보호장치를 기록한다. 지도 화면은 NAVER Web Dynamic Map이 담당하며
이 문서의 Kakao JavaScript 지도 SDK는 사용하지 않는다. Kakao 정책과 쿼터는
바뀔 수 있으므로 live 전환 직전에
[Kakao Map 이해하기](https://developers.kakao.com/docs/ko/kakaomap/common),
[REST API](https://developers.kakao.com/docs/ko/kakaomap/rest-api),
[쿼터](https://developers.kakao.com/docs/ko/getting-started/quota)를 다시
확인한다.

## 사용하는 기능

| 목적 | 메서드와 URL | 인증 | CHIMap timeout |
| --- | --- | --- | --- |
| 키워드 장소 검색 | `GET https://dapi.kakao.com/v2/local/search/keyword.json` | REST 키 | 3초 |
| 도보 경로 | `GET https://dapi.kakao.com/v2/routing/walk` | REST 키 | 5초 |

REST 요청 헤더는 `Authorization: KakaoAK ${REST_API_KEY}`다. 장소와 경로는
WGS84 좌표를 사용한다. 도보에는 `BROAD_FIRST` 모드와 선택적 경유지 최대
5개를 사용한다. 운영 대중교통 경로는 Kakao가 아니라 TAGO 정류장·노선
데이터로 CHIMap이 계산한다.

## 키 준비

1. Kakao Developers에서 앱을 만든다.
2. 앱 관리의 Kakao Map 사용 설정을 켠다.
3. REST API 키를 저장소 루트의 `.env` 또는 런타임 secret의
   `KAKAO_REST_API_KEY`로 넣는다.
4. API의 `WEB_ORIGIN`은 브라우저가 실제 사용하는 origin과 정확히 맞춘다.

```dotenv
# .env
KAKAO_MODE=live
KAKAO_REST_API_KEY=replace-me
WEB_ORIGIN=http://localhost:5173

VITE_APP_MODE=live
VITE_API_BASE_URL=
VITE_NAVER_MAP_NCP_KEY_ID=replace-with-naver-client-id
```

운영에서는 `WEB_ORIGIN=https://chimap.madcamp-kaist.org`를 사용한다.
비어 있는 `VITE_API_BASE_URL`은 개발에서 `http://localhost:8080`, 운영에서
같은 origin의 `/api/v1/*`를 사용한다.

Kakao REST 키는 `VITE_` 접두사 변수에 넣지 않는다. Vite의 `VITE_*` 값은
공개 브라우저 번들에 포함된다. NAVER 지도 설정은
[`naver-map-integration.md`](./naver-map-integration.md)를 따른다.

## Provider 경계

`KakaoMobilityProvider`는 원시 JSON을 `unknown`으로 받고 별도 normalizer가
Zod로 검증한다. 운영에서는 `TagoTransitMobilityProvider`가 이 provider를
장소 검색과 도보 경로용 base provider로 감싼다.

- place 문서는 내부 `Place`로 변환
- Kakao `WALKING`을 내부 `WALK` leg로 변환
- `[x, y]` path를 `{lng, lat}`로 변환
- fare나 빈 path를 허용하되 잘못된 숫자와 좌표는 거부
- `NO_RESULTS` 등 상태는 `ProviderError`로 변환
- raw Kakao 타입은 API 응답과 웹으로 노출하지 않음

저장소에는 이전 Kakao transit 응답 normalizer의 회귀 fixture가 남아 있지만
현재 production server의 `getTransitRoutes`는 TAGO provider가 구현하므로
Kakao 대중교통 endpoint를 호출하지 않는다. 공식 문서도 세부 타입 명칭이
추가·변경·삭제될 수 있음을 알리므로 fixture 계약 테스트가 live 변경 감지의
첫 방어선이다.

## 재시도, cache, 비용 보호

- 429, 502, 503, 504와 네트워크 오류만 최대 1회 재시도
- 재시도 전 100~199ms jitter
- 일반 4xx는 재시도하지 않음
- 장소 1시간, 도보 30분 cache
- 동일 요청 single-flight
- 추천 전체에서 TAGO transit 후보 최대 5회, Kakao 도보 최대 4회, 후보
  동시성 최대 3
- 전체 추천 15초 timeout
- API 자체 추천 rate limit 10회/분/IP

429는 사용자에게 `RATE_LIMITED`, upstream timeout은 `UPSTREAM_TIMEOUT`,
경로 없음은 `NO_ROUTE_WITHIN_DEADLINE`로 매핑한다. 응답 본문이나 키를
로그에 남기지 않는다.

## 2026-07-24 쿼터와 과금 주의

공식 쿼터 문서 기준, 앱별 무료 쿼터와 유료 전환 조건은 계정 및 활성화 상태에
따라 달라질 수 있다. CHIMap에서 실제 사용하는 장소 키워드 검색과 도보
경로의 현재 무료량·단가는 운영 직전에 Kakao 콘솔과 공식 쿼터 페이지에서
확인한다. 이 문서는 변경 가능한 수치를 release 보증값으로 고정하지 않는다.

2026-07-21부터 Kakao Map 활성화 순서와 무료 쿼터 정책이 변경되었으므로,
앱 정보의 무료 쿼터 배지를 확인한다. 두 번째 활성화 앱부터 또는 무료
쿼터를 넘겨야 할 때는 비즈월렛 연결과 유료 API 설정이 필요할 수 있다.

CHIMap 코드와 배포 절차는 비즈월렛 연결이나 유료 API 활성화를 자동으로
수행하지 않는다. 운영자가 Kakao 콘솔에서 쿼터와 지출 상한을 확인한 후
별도로 승인해야 한다.

## live smoke

실제 키가 있는 통제된 환경에서 다음을 확인한다.

```bash
KAKAO_MODE=live \
KAKAO_REST_API_KEY="$KAKAO_REST_API_KEY" \
WEB_ORIGIN=http://localhost:5173 \
pnpm --filter @chimap/api dev

curl -fsS http://localhost:8080/api/v1/health
curl -fsS --get http://localhost:8080/api/v1/places \
  --data-urlencode 'query=KAIST'
```

추천 smoke 전에는 TAGO 키와 SQLite import가 별도로 준비되어야 한다.
권장 smoke는 Kakao 장소 1회·도보 1회와 TAGO를 결합한 대표 추천 1회뿐이다.
실제 Kakao API로 부하 테스트하지 않는다. 확인 항목은 다음과 같다.

- health의 mode가 `live`
- 장소가 내부 계약으로 정규화됨
- 추천이 1~3개이며 각 leg의 모드·거리·시간이 유효
- Kakao 도보 WGS84 path가 내부 `{lng,lat}` 계약으로 정규화됨
- 버스 leg의 source와 정류장·도착정보가 TAGO에서 생성됨
- 정규화 경로가 NAVER 지도 또는 SVG 폴백에 표시됨
- 서버 로그와 브라우저 소스에 REST 키가 없음
- Kakao 콘솔에서 예상한 호출량만 증가

## TAGO 및 NAVER 지도와 결합하는 경계

Kakao 도보 raw path의 `[x, y]`는 API provider 내부에서 WGS84
`{lng: x, lat: y}`로 정규화한다. TAGO 정류장·차량 좌표도 같은 공개 계약을
사용한다. 브라우저는 어느 공급자의 raw 응답도 받지 않고
`Recommendation.legs[].coordinates`만 NAVER `Polyline`에 전달한다.
NAVER SDK 키가 비어 있거나 script가 실패하면 같은 좌표로 SVG 미리보기를
그리며, 좌표가 부족해도 텍스트 이동 단계와 추천 수치는 계속 제공한다.

이 기술적 분리는 교차 공급자 표시의 약관상 허용을 대신 판단하지 않는다.
공개 live 전환 전에는 양사 최신 이용약관과 출처·브랜드 표시 요건을 운영자가
재검토한다.
