# CHIMap 사용자 작업

현재 공개 앱, PostgreSQL/PostGIS, TAGO 정기 동기화, Prometheus,
Alertmanager와 알림 릴레이는 배포되어 있습니다. 2026-07-26 01:26 KST
기준 relay의 구성 지표는 `0`이고 `ChimapAlertDeliveryNotConfigured`만
발생 중입니다. 아래 1번을 완료하면 외부 장애 알림까지 활성화됩니다.

## 1. 외부 장애 알림 webhook 연결 — 필수

권장 대상은 Slack Incoming Webhook입니다. Slack 워크스페이스에서 CHIMap
운영 알림을 받을 채널용 Incoming Webhook URL을 만든 뒤, 저장소 루트의
`.env`에 다음 두 줄을 추가해 주세요.

```dotenv
ALERT_NOTIFICATION_PROVIDER=slack
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/발급받은/값
```

- Discord라면 provider를 `discord`로 바꾸고 Discord webhook URL을 넣습니다.
- 자체 HTTP 수신기라면 provider를 `generic`으로 사용합니다.
- URL은 `.env.example`, 문서, 이슈, 채팅이나 Git에 복사하지 않습니다.
- `.env` 이외의 환경변수 파일은 만들지 않습니다.

입력 후 다음 명령을 실행하거나 Codex에게 실행을 요청해 주세요.

```bash
cd /root/chimap
docker compose up -d --no-build --force-recreate alert-relay
./ops/check-alert-delivery.sh
```

확인 스크립트는 Slack 등에 “CHIMap 운영자 장애 알림 전달 확인”을 한 번
보낸 뒤 자동으로 복구 상태로 전환합니다. 복구 알림은 Alertmanager 묶음
주기 때문에 조금 늦게 도착할 수 있습니다.

## 2. 기본 브랜치 병합과 공개 E2E — 릴리스 시 필요

개인화 한 걸음 길이, 조기 하차 우선과 지도 도보 표현까지 포함한
`b294a4d`가 `feat/tago-transit`에 push됐고 CI run `30165571376`의 두
job이 모두 통과했습니다. GitHub 기본 브랜치 `main`에 반영하려면 다음을
수행해 주세요.

1. `feat/tago-transit`에서 `main`으로 Pull Request를 만들고 검토 후
   병합합니다.
2. 병합 뒤 Actions의 `Public live E2E`를 수동 실행합니다.
3. 실제 지도·공급자 호출을 사용하는 이 workflow의 성공을 확인합니다.

`workflow_dispatch` workflow는 파일이 기본 브랜치에 들어간 뒤 Actions에서
수동 실행할 수 있습니다. 같은 시나리오는 현재 서버에서 직접 실행해 2개
모두 통과한 상태입니다.

## 3. GitHub 보호 규칙 — 권장

GitHub 저장소의 기본 브랜치 보호 설정에서 다음 두 check를 필수로 지정해
주세요.

- `Typecheck, tests, build, config`
- `PostgreSQL and PostGIS integration`

`Public live E2E`는 실제 Kakao/NAVER/TAGO 호출량을 사용하므로 필수
push check가 아니라 수동 실행으로 유지합니다.

## 현재 사용자 작업이 필요 없는 항목

- `chimap.madcamp-kaist.org` 공개 도메인과 NAVER 지도 연결
- PostgreSQL 18/PostGIS migration과 정류장 중복 병합
- KAIST·대전역 TAGO 노선 일일 동기화 timer
- PostgreSQL 일일 백업과 월간 restore 검증 timer
- Prometheus 20개 경보 규칙과 Alertmanager 내부 연결
