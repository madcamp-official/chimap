# 추천 알고리즘

추천은 TAGO 버스 경로와 Kakao 도보 경로를 조합해 마감시간 안에서 더 걸을
수 있는 최대 3개의 서로 다른 실제 경로를 선택합니다.

## 1. 입력 검증

| 입력 | 범위 |
| --- | --- |
| 현재 걸음 | 0~100,000 |
| 하루 목표 | 1~100,000 |
| 최대 추가시간 | 0~120분 |
| 보폭 | 0.3~1.2m |
| 안전 여유시간 | 0~15분 |
| 마감시간 | 현재보다 미래, 최대 6시간 이내 |

장소는 검색 결과를 사용자가 선택한 경우에만 입력으로 인정합니다. 출발지와
목적지가 50m 미만이면 `LOCATIONS_TOO_CLOSE`로 거절합니다.

유효 마감시간:

```text
effectiveDeadline = deadline - safetyBufferMinutes
```

## 2. 버스 baseline 생성

1. 출발·도착 각각 500m 안의 정류장을 PostGIS에서 조회합니다.
2. TAGO ID가 연결된 정류장별 노선을 확인하고 노선 0건 정류장은
   승하차 후보에서 제외합니다.
3. 양쪽에 운행 정류장이 있어도 연결 경로가 없으면 800m, 최대 1.2km까지
   단계적으로 범위를 넓힙니다.
4. 각 단계는 가까운 미확인 정류장을 8개씩 조회하고 한 단계에서 최대
   24개까지만 검사합니다.
5. 정류장별 노선과 노선 정류장 순서를 DB 우선으로 조회합니다.
6. 양쪽에 공통인 노선에서 승차 순서<하차 순서인 직행 후보를 찾습니다.
7. 직행 실제 후보를 최대 3개 구성합니다.
8. 직행 결과가 2개 미만이고 설정이 허용하면 최대 1회 환승을 탐색합니다.
9. 가장 짧은 총 소요시간 후보를 baseline으로 사용합니다.

환승은 같은 도시의 서로 다른 두 노선에서 동일 정류장 ID 또는 100m 이내
정류장 연결만 허용합니다. 노선별 진행 방향과 승하차 순서를 검증합니다.

## 3. 도보·대기·승차시간

출발→승차, 환승, 하차→목적지 구간은 Kakao 도보 경로를 사용합니다. 두
좌표가 3m 이하인 구간은 생략합니다.

따라서 확장 탐색으로 500m 밖의 정류장을 선택해도 출발지에서 정류장까지의
거리는 직선 거리로 대체하지 않고 Kakao의 실제 도보 거리·시간·좌표를
그대로 포함합니다.

대기시간:

```text
TAGO 실시간 도착 초
  또는 배차간격 × 30초
  또는 배차정보가 없으면 600초
```

배차간격 기반 대기는 평균 대기시간으로 간격의 절반을 사용하며 최소
30초입니다. 실시간 도착 호출은 각 leg에서 2.5초로 제한하고 실패하면
배차간격 추정으로 계속합니다.

승차시간:

```text
노선 정류장 좌표 간 거리 / 평균 버스 속도
+ 중간 정류장 수 × 정차시간
```

기본값은 평균 버스 속도 20km/h, 정차시간 25초입니다.

버스 표시선은 TAGO 승차→중간 정류장→하차 순서를 Kakao Mobility
Directions의 다중 경유지에 전달해 받은 도로 vertex입니다. 한 요청은
출발·도착과 최대 30개 경유지를 포함하고, 더 긴 구간은 마지막 지점을 다음
요청의 시작점으로 겹쳐 나눈 뒤 geometry를 이어 붙입니다. 이는 도로를
따르는 표시용 매칭 경로이며 버스 운영사의 정밀 GPS 운행 궤적은 아닙니다.
도로 매칭이 일시 실패한 후보만 정류장 좌표 순서로 복구하고
`estimationNotes`에 명시합니다.

버스 거리·승차시간 추정은 기존처럼 TAGO 노선 정류장 좌표 간 거리, 평균
속도와 정차시간을 사용합니다.

## 4. 운동 후보 생성

남은 걸음과 목표 도보거리:

```text
remainingSteps = max(goalSteps - currentSteps, 0)
targetWalkMeters = remainingSteps × strideLengthMeters
additionalNeeded = max(targetWalkMeters - baselineWalkMeters, 0)
desiredDirectDistance = max(300m, additionalNeeded × 0.75)
```

baseline의 마지막 대중교통 leg에서 목적지 전 최대 6개 정류장을 후보로
추출합니다. 장소 검색으로 정류장명을 해석하고 다음 confidence를
계산합니다.

```text
0.55 × 이름 유사도
+ 0.20 × 교통 카테고리 점수
+ 0.25 × baseline 선과의 거리 점수
```

confidence 0.58 미만 또는 baseline 선에서 1.5km를 넘는 후보는 제외합니다.
선택 후보에서 목적지까지 Kakao 도보를 붙이고:

- 대중교통 끝↔도보 시작 gap 120m 이하
- 도보 끝↔목적지 gap 250m 이하

를 확인합니다.

운동 후보가 부족하면 목적지 주변의 공원·광장·역·공공시설을 실제 Kakao
장소 검색으로 찾아 최대 2개를 추가 시도합니다. 쇼핑·병원·학교·아파트
카테고리는 이 보완 후보에서 제외합니다.

## 5. 외부 호출 예산

한 추천 요청의 예산:

| 호출 | 최대 |
| --- | --- |
| 대중교통 후보 | 5회 |
| 도보 | 4회 |
| 합계 | 9회 |
| 동시성 | 3 |
| 추천 전체 timeout | 20초 |

장소 해석 검색은 같은 동시성 제한을 공유하고 정류장명 해석 결과는 6시간
캐시합니다.

## 6. 마감·추가시간 필터

후보 도착:

```text
arrivalAt = departureAt + route.durationSeconds
```

유효 후보:

```text
arrivalAt <= effectiveDeadline
routeDuration <= baselineDuration + maxExtraMinutes
```

조건을 만족하는 후보가 없으면 `NO_ROUTE_WITHIN_DEADLINE`입니다.

## 7. 걸음과 점수

```text
estimatedSteps = round(walkDistanceMeters / strideLengthMeters)
expectedTotalSteps = currentSteps + estimatedSteps
```

균형 점수는 낮을수록 좋습니다.

```text
0.55 × stepError
+ 0.30 × timePenalty
+ 0.10 × transferPenalty
+ 0.05 × connectionPenalty
```

- `stepError`: 목표에 필요한 걸음과 후보 걸음의 오차
- `timePenalty`: 허용 추가시간 대비 실제 추가시간
- `transferPenalty`: 환승 횟수/3, 최대 1
- `connectionPenalty`: 조합 구간 연결 gap과 장소 confidence

## 8. 중복 제거와 최종 선택

다음 조건을 모두 만족하면 같은 경로로 봅니다.

- 버스/지하철 노선 signature 동일
- 환승 횟수 동일
- 도보거리 차이 250m 미만
- 소요시간 차이 180초 미만
- 경로 shape 유사

선택 순서:

1. `FAST`: 유효 후보 중 총 소요시간 최소
2. `GOAL`: 남은 걸음과 예상 걸음 차이 최소
3. `BALANCED`: 균형 점수 최소
4. 응답 정렬은 FAST→BALANCED→GOAL

같은 route ID를 두 타입에 중복 배정하지 않습니다. 이미 목표 걸음을 채운
사용자에게는 baseline 후보만 사용하므로 경로 수가 1개일 수 있습니다.

## 9. 부분 장애와 warning

실제 후보 일부만 실패하면 성공 후보로 계속 계산하고
`PARTIAL_CANDIDATE_FAILURE`를 반환할 수 있습니다.

TAGO 실시간 도착이 없으면 `REALTIME_UNAVAILABLE`, 주변 정류장 갱신이
부분 실패하면 `PARTIAL_TRANSIT_DATA`, 충분히 다른 결과가 3개 미만이면
`LIMITED_ROUTE_VARIETY`를 반환합니다.

공급자 경로가 없는 직선 거리 결과를 생성하지 않습니다. 지도 SDK가
실패하는 경우에만 이미 성공한 추천 응답 좌표를 SVG로 다시 그립니다.
