# 추천 알고리즘

추천은 버스·지하철·Kakao 도보를 요청 범위 멀티모달 그래프로 조합해 사용자의
남은 하루 목표와 기본 경로에서 자동 계산한 시간 범위 안에서 최대 3개의 실제
경로를 선택합니다.

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

## 2. 멀티모달 baseline 생성

운영값 `TRANSIT_ROUTER_MODE=multimodal`은 다음 순서로 요청마다 작은 그래프를
만듭니다.

1. 출발·도착 주변의 실제 운행 버스 정류장과 노선을 500m→800m→최대 1.2km로
   점진 조회합니다.
2. 활성 `is_route_ready=true` 지하철 방향성 구간과 시간대별 headway를 읽습니다.
3. 사전 검증된 500m 이하 버스↔지하철 Kakao 보행 연결을 합칩니다.
4. 출발·목적지와 후보 정류장·역의 실제 Kakao 도보 edge를 추가합니다.
5. 상태를 현재 node, 탑승 중 service, 마지막 탑승 service, 환승 횟수로 구분해
   최소 소요시간 queue를 탐색합니다. 같은 상태에서는 시간·도보거리 모두 열등한
   label을 제거합니다.
6. 새 service에 탑승할 때만 대기시간과 환승 1회를 추가하며 최대 환승은
   `TRANSIT_MAX_TRANSFER_COUNT`의 운영값 2회입니다.
7. transit signature가 다른 빠른 후보를 materialize하고 가장 짧은 후보를
   baseline으로 사용합니다.

`shadow`는 기존 결과를 반환하면서 멀티모달 탐색만 비교 실행하고, `legacy`는
아래의 버스 직행·1회 환승 탐색기로 되돌리는 운영 rollback 값입니다.

### Legacy 버스 탐색

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
버스: TAGO 실시간 도착 → 배차간격 절반 → 기본 600초
서울 지하철: 서울 실시간 도착 → TAGO 시간표 → 시간대별 headway
그 밖의 지하철: TAGO 시간표 → 시간대별 headway
```

배차간격 기반 대기는 평균 대기시간으로 간격의 절반을 사용하며 최소
30초입니다. 버스 실시간 도착 호출은 각 leg에서 2.5초로 제한합니다. 서울
실시간 지하철은 예정 승차가 현재부터 10분 이내인 서울 주소 역에서만 사용하고,
실패하거나 일일 guard에 도달하면 TAGO 시간표와 headway로 계속합니다. 각
BUS/SUBWAY leg는 `timingSource`, `isRealtime`, `plannedBoardingAt`, `updatedAt`,
`stale`을 반환합니다.

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

브라우저와 앱은 최초 이용 시 만 나이·신장·체중·생물학적 성별을 필수로
입력받고, 논문 근거 기반 첫 하루 목표를 자동 제안합니다. 만 나이는 현재 연도
기준 출생연도로 변환합니다. 사용자는 추천값을 직접 수정할 수 있고 기존에 저장한
목표는 프로필 수정 때 자동으로 덮어쓰지 않습니다. 계정은
만들지 않으며 원본 신체정보는 브라우저 localStorage version 3에만 저장합니다.
직접 한 걸음 길이를 입력하거나 20m 보행 결과를 받는 경로는 없습니다.

```text
18 <= age < 60: firstGoal = 8,000, evidenceRange = 8,000~10,000
60 <= age <= 90: firstGoal = 7,000, evidenceRange = 6,000~8,000
estimatedGoalDistance = firstGoal × estimatedStepLengthMeters
```

걸음 수는 연령별 전향 코호트 메타분석 범위로만 결정합니다. 신장·체중·생물학적
성별은 아래 보폭식과 목표 거리 환산에 사용하지만 걸음 수에 임의 가감하지
않습니다. 현재 근거에는 성별이나 BMI별로 서로 다른 하루 걸음 목표를 정당화하는
검증된 다변량식이 없기 때문입니다. 모델 버전은 `DING_PALUCH_2025_V1`입니다.

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

## 8. 걸음 계산

```text
estimatedSteps = round(walkDistanceMeters / stepLengthMeters)
expectedTotalSteps = currentSteps + estimatedSteps
```

## 9. 중복 제거와 최종 선택

다음 조건을 모두 만족하면 같은 경로로 봅니다.

- 버스/지하철 노선 signature 동일
- 환승 횟수 동일
- 도보거리 차이 250m 미만
- 소요시간 차이 180초 미만
- 경로 shape 유사

선택 순서:

1. `FAST`: 유효 후보 중 총 소요시간 최소
2. `BALANCED`: FAST 예상 걸음의 2배와 예상 걸음 차이 최소
3. `GOAL`: 미사용 운동 조정 후보가 있으면 그 후보군에서, 없으면 전체 미사용
   후보에서 남은 걸음과 예상 걸음 차이 최소
4. 응답 정렬은 FAST→BALANCED→GOAL

`BALANCED`는 기존 API 호환을 위해 유지하는 타입 이름이며 화면에는
`2배 걸음 경로`로 표시합니다. 같은 route ID를 두 타입에 중복 배정하지
않으며 유효한 고유 후보가 3개 이상이면 세 타입을 모두 반환합니다. 실제
후보가 부족하면 경로를 복제하지 않고 1~2개만 반환합니다. 남은 걸음이 있으면
`primaryRecommendationId`는 GOAL, GOAL이 없으면 BALANCED를 가리키며 UI가
이 경로를 처음부터 선택합니다. 목표를 이미 달성한 경우 FAST가 기본입니다.

최종 GOAL은 운동 WALK의 명시적 역할, exercise 표식, 최소 길이, 상세 geometry,
후보 종류와 역할 topology, 추가시간·마감 정책을 검증합니다. FAST와 GOAL은
서로 다른 대중교통 여정일 수 있으므로 두 경로의 총 도보 차이를 운동 WALK의
기여량으로 간주하지 않습니다. 추천 걸음 수에는 일반 ACCESS와 운동 WALK가
모두 실제 이동 거리로 포함됩니다.

대신 조정·공원 후보를 생성하는 시점에는 같은 부모 경로와 비교해 늘어난 WALK
거리가 새로 삽입한 운동 WALK 거리와 정확히 같은지 검증합니다. 일반 WALK의
변경을 운동 구간에 잘못 귀속한 후보는 선택 전에 폐기합니다.

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

하루 목표 근거:

- Ding et al., *Daily steps and health outcomes in adults: a systematic
  review and dose-response meta-analysis*, 2025,
  <https://www.sciencedirect.com/science/article/pii/S2468266725001641>
- Paluch et al., *Daily steps and all-cause mortality: a meta-analysis of 15
  international cohorts*, 2022,
  <https://pubmed.ncbi.nlm.nih.gov/35247352/>
- Paluch et al., *Prospective Association of Daily Steps With Cardiovascular
  Disease: A Harmonized Meta-Analysis*, 2023,
  <https://pmc.ncbi.nlm.nih.gov/articles/PMC9839547/>
- Saint-Maurice et al., *Association of Daily Step Count and Step Intensity
  With Mortality Among US Adults*, 2020,
  <https://jamanetwork.com/journals/jama/fullarticle/2763292>

2025년 최신 종합분석은 7,000걸음을 현실적이고 유의미한 일반 성인 목표로
제시하지만 연령별 분석이 부족하다고 명시합니다. CHIMap은 이를 2022년 연령별
메타분석의 60세 미만 8,000~10,000, 60세 이상 6,000~8,000 정체 범위와 함께
사용해 각각 보수적인 첫 목표 8,000과 7,000을 선택합니다. 이는 의료 처방이나
개인의 현재 활동량을 반영한 적응형 목표가 아닙니다. 통증·임신·질환·낙상 위험이
있으면 의료진과 목표를 조정해야 합니다.

보폭 근거:

- Han et al., *Development of a Multivariable Equation for Predicting
  Healthy Step Length*, 2026,
  <https://doi.org/10.1080/1091367X.2026.2634091>
- Senden et al., *Importance of correcting for individual differences in
  the clinical diagnosis of gait disorders*, 2012,
  <https://doi.org/10.1016/j.physio.2011.06.002>

`HAN_2026_V1` 연구는 건강한 성인 252명, 만 18~90세와 BMI 30 미만을
중심으로 내부 교차검증됐습니다. CHIMap의 값은 의료 진단이나 실측값이
아니며 연구 범위 밖 사용자는 오차가 더 클 수 있습니다.
# Park-assisted GOAL candidates

When `PARK_ROUTE_INTEGRATION_ENABLED=1`, the API searches only the active
reviewed dataset near eligible access walks: origin/access, final
alighting/destination, or an all-walking trip. Transfer walks are excluded.
PostGIS and stored distance shortlist candidates before external calls.

A candidate replaces one eligible walk with Kakao access walking, the stored
park geometry, and Kakao egress walking. `FORWARD_ONLY` is never reversed;
`BOTH` can create an in-memory reversed view (entry/exit, coordinates, and
path waypoint IDs) without changing the row. The park leg is a detailed,
exercise `PARK_DETOUR` leg. It is selected only when its absolute difference
from remaining target steps improves and the existing automatic/legacy time
policy still passes.

FAST and BALANCED selection is unchanged. Park lookup, database, geometry, or
connector failures are fail-open and retain the existing recommendations.
The existing total route-provider call ceiling is preserved; park connectors
run only when two calls remain.
