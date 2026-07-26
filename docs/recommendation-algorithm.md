# 추천 알고리즘

추천은 TAGO 버스 경로와 Kakao 도보 경로를 조합해 사용자의 남은 하루 목표와
기본 경로에서 자동 계산한 시간 범위 안에서 최대 3개의 실제 경로를 선택합니다.

이 문서는 현재 `RecommendationService`, 후보 생성기와 공유 계약을 기준으로
합니다. UI의 guided/compact 전환과 익명 이벤트는 추천 점수·후보 생성·API
응답을 바꾸지 않는 별도 경험 계층입니다.

## 1. 입력 검증

| 입력 | 범위 |
| --- | --- |
| 현재 걸음 | 0~100,000 |
| 하루 목표 | 1~100,000 |
| 개인화 한 걸음 길이 | 0.3~1.2m, `HAN_2026_V1` |

장소는 검색 결과를 사용자가 선택한 경우에만 입력으로 인정합니다. 출발지와
목적지가 50m 미만이면 `LOCATIONS_TOO_CLOSE`로 거절합니다.

기존 클라이언트의 마감시간·최대 추가시간·안전 여유시간 포함 요청도 한 전환
릴리스 동안 허용합니다. 이 요청에만 기존 범위와 마감 검증을 적용하고 응답에
`Deprecation: true`를 표시합니다.

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

## 4. 개인화 한 걸음 길이

브라우저는 최초 이용 시 만 나이·신장·체중·생물학적 성별·하루 목표를
필수로 입력받습니다. 만 나이는 현재 연도 기준 출생연도로 변환합니다. 계정은
만들지 않으며 원본 신체정보는 브라우저 localStorage version 3에만 저장합니다.
직접 한 걸음 길이를 입력하거나 20m 보행 결과를 받는 경로는 없습니다.

```text
stepLengthCm =
  -16.14
  - 0.06 × age
  + 0.31 × heightCm
  - 0.04 × weightKg
  + 0.02 × biologicalSexCode
  + 0.30 × 128.35
```

성별 코드는 남성 0, 여성 1이며 128.35cm/s는 적용 연구의 평균 평소
보행속도입니다. 이 값은 한 걸음 길이 추정치이며 실제 보폭은 보행속도,
지형, 신발과 건강 상태에 따라 달라질 수 있습니다.

계약 범위는 만 18~90세, 신장 120~220cm, 체중 30~200kg입니다. BMI
30 이상이면 UI가 적용 연구의 중심 범위를 벗어날 수 있다는 안내를
표시합니다. 기존 localStorage version 1은 읽기만 가능하고 필수 프로필이
없으므로 온보딩을 다시 거칩니다. version 2는 프로필·목표·마지막 장소를
보존해 version 3으로 이전하고 현재 걸음은 0으로 시작합니다.

API에는 원본 프로필 대신 다음 파생값만 보냅니다.

```ts
walkingMetric: {
  stepLengthMeters: number;
  source: "RESEARCH_ESTIMATE";
  modelVersion: "HAN_2026_V1";
}
```

남은 걸음과 목표 도보거리:

```text
remainingSteps = max(goalSteps - currentSteps, 0)
targetWalkMeters = remainingSteps × stepLengthMeters
```

## 5. 조기 하차 우선 운동 후보

장소 검색으로 정류장명을 다시 해석하지 않고 baseline의
`TransitBusLeg.stops`에 포함된 실제 TAGO 정류장 순서를 사용합니다.

1. 마지막 버스 leg의 원래 하차 정류장보다 앞선 정류장을 전부 열거합니다.
2. 직선거리×1.25로 목표 적합도를 사전 계산하고 상위 4개 조기 하차 후보의
   하차→목적지 Kakao 도보를 조회합니다.
3. 조기 하차만으로 목표 ±5% 후보가 없을 때 첫 버스 leg의 탑승 정류장을
   뒤로 옮긴 상위 2개 후보를 조회합니다.
4. 그래도 목표 범위가 없으면 늦은 탑승과 조기 하차를 결합한 상위 1개
   후보를 조회합니다.
5. 환승 경로에서는 첫 탑승과 마지막 하차만 변경하고 환승 지점은
   유지합니다.
6. 모든 버스 leg에는 최소 한 정거장 이동을 남기며 승하차 순서가
   역전되는 조합은 제외합니다.

변경된 버스 leg는 기존 TAGO 정류장 배열과 도로 geometry를 해당
승하차점까지 잘라 사용합니다. 새 출발·도착 도보거리와 시간은 Kakao
실제 응답으로 다시 계산합니다.

목표 허용 범위:

```text
toleranceSteps = round(remainingSteps × 0.05)
abs(routeSteps - remainingSteps) <= toleranceSteps
```

조기 하차를 최우선으로 하되 범위 안의 후보가 없으면 자동 시간 예산 안에서
절대 걸음 오차가 가장 작은 경로를 반환하고 부족·초과량을 표시합니다.

## 6. 외부 호출 예산

한 추천 요청의 예산:

| 호출 | 최대 |
| --- | --- |
| baseline 대중교통 | 1회 |
| 조정 도보 | 8회 |
| 합계 | 9회 |
| 동시성 | 3 |
| 추천 전체 timeout | 20초 |

## 7. 자동 시간 예산

후보 도착:

```text
arrivalAt = departureAt + route.durationSeconds
```

자동 요청의 부족 도보거리와 허용 추가시간:

```text
missingWalkMeters = max(targetWalkMeters - baselineWalkMeters, 0)
missingWalkMinutes = missingWalkMeters / 1.2835m/s / 60
autoExtraMinutes = clamp(ceil(missingWalkMinutes × 1.25 + 5), 15, 90)
```

자동 요청은 절대 마감시간을 적용하지 않고
`routeDuration <= baselineDuration + autoExtraMinutes`인 후보만 사용합니다.
기존 요청만 `deadline - safetyBufferMinutes`와 `maxExtraMinutes`를 종전대로
적용하며 조건을 만족하는 후보가 없으면 `NO_ROUTE_WITHIN_DEADLINE`입니다.

## 8. 걸음과 점수

```text
estimatedSteps = round(walkDistanceMeters / stepLengthMeters)
expectedTotalSteps = currentSteps + estimatedSteps
```

균형 점수는 낮을수록 좋습니다.

```text
0.60 × stepError
+ 0.30 × timePenalty
+ 0.10 × transferPenalty
```

- `stepError`: 목표에 필요한 걸음과 후보 걸음의 오차
- `timePenalty`: 허용 추가시간 대비 실제 추가시간
- `transferPenalty`: 환승 횟수/3, 최대 1
## 9. 중복 제거와 최종 선택

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
남은 걸음이 있으면 `primaryRecommendationId`는 GOAL, GOAL이 없으면
BALANCED를 가리키며 UI가 이 경로를 처음부터 선택합니다. 목표를 이미
달성한 경우 FAST가 기본입니다.

브라우저의 추천 성공 횟수는 성공 응답을 받은 뒤 안내 밀도를 조절하는 데만
사용합니다. 이 값은 추천 요청에 포함하지 않고 서버나 PostgreSQL에 저장하지
않으므로 같은 입력의 경로 계산 결과에 영향을 주지 않습니다.

## 10. 부분 장애와 warning

실제 후보 일부만 실패하면 성공 후보로 계속 계산하고
`PARTIAL_CANDIDATE_FAILURE`를 반환할 수 있습니다.

TAGO 실시간 도착이 없으면 `REALTIME_UNAVAILABLE`, 주변 정류장 갱신이
부분 실패하면 `PARTIAL_TRANSIT_DATA`, 충분히 다른 결과가 3개 미만이면
`LIMITED_ROUTE_VARIETY`를 반환합니다.

자동 시간 예산 안에서 목표 ±5% 후보가 없으면
`GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET`, 기존 시간 제약 요청에서는
`GOAL_UNREACHABLE_WITHIN_CONSTRAINTS`를 반환합니다.

공급자 경로가 없는 직선 거리 결과를 생성하지 않습니다. 지도 SDK가
실패하는 경우에만 이미 성공한 추천 응답 좌표를 SVG로 다시 그립니다.

## 11. 보폭 연구 근거와 한계

- Han et al., *Development of a Multivariable Equation for Predicting
  Healthy Step Length*, 2026,
  <https://doi.org/10.1080/1091367X.2026.2634091>
- Senden et al., *Importance of correcting for individual differences in
  the clinical diagnosis of gait disorders*, 2012,
  <https://doi.org/10.1016/j.physio.2011.06.002>

`HAN_2026_V1` 연구는 건강한 성인 252명, 만 18~90세와 BMI 30 미만을
중심으로 내부 교차검증됐습니다. CHIMap의 값은 의료 진단이나 실측값이
아니며 연구 범위 밖 사용자는 오차가 더 클 수 있습니다.
