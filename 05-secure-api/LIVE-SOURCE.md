# literstella-api — 라이브와 같은 소스 한 벌 (2026-10-17)

이 브랜치(`ops/api-live-source-20261017`)의 `05-secure-api/` 는 **라이브 literstella-api Version `aaa8d594-111a-422f-b2ec-30ffc2640bcc` 와 같다.**
`node ops/verify-live.mjs` 가 22항목 전부 `same` 을 낸다(2026-10-17 23:50 KST 실측).

| 항목 | 라이브 | 이 소스 |
|---|---|---|
| 모듈 9개 이름·바이트 | content/v2 | `node ops/build-live.mjs` → `dist/live/` (SHA256 9/9 같음) |
| 진입 모듈 | `Cf-Entrypoint: class-checkout-email-entry.mjs` · `Cf-Handlers: fetch,scheduled` | `wrangler.jsonc` main |
| plain 변수 15개(이름·값) · secret 이름 10개 · 서비스 2 · KV 1 · ratelimit 1 = 29 | settings | `wrangler.jsonc` · `ops/verify-live.mjs` EXPECTED_SECRETS |
| 크론 `25 18 * * *` · `*/5 * * * *` | schedules | `wrangler.jsonc` triggers |
| compatibility 2026-06-17 · nodejs_compat | settings | 두 설정 파일(빌드가 대조) |

## 왜 이렇게 됐나

10-12·10-13 결제 배포가 **라이브 번들 위에 모듈을 '코드만' 얹는 방식**으로 나갔다(`ops/deploy-member-checkout.mjs`·`deploy-checkout-email.mjs`, 일회용).
그래서 라이브는 `index.js`(src/index.js 를 묶은 한 파일) + 감싸는 결제 모듈 8개, 진입은 `class-checkout-email-entry.mjs` 다:

```
class-checkout-email-entry.mjs → class-member-checkout-entry.mjs → class-payment-probe-entry.mjs → index.js
                                    └ class-member-checkout-route.mjs → class-member-checkout.mjs · class-course-checkout.mjs
class-checkout-email.mjs (메일 outbox · */5 재시도)          class-payment-probe.mjs (100원 시험)
```

소스는 세 곳에 흩어져 있었다 — GitHub `origin/codex/speaking-analysis-release-20261011`(말하기·발음·이하 대부분),
공유 트리 로컬 `backup-clean`(결제·이벤트·어린 왕자 가격 `af4d23ed`), 미추적 파일(`class-payment-probe*.mjs`).
이 브랜치 = speaking 브랜치 + backup-clean 의 결제·이벤트 파일 + 미추적 두 파일 + 라이브 설정.

## 쓰는 법

```
node ops/build-live.mjs      # dist/live/ 만들기(배포 없음). wrangler 4.151.1 고정
node ops/verify-live.mjs     # 라이브와 대조(읽기만). 0=같음 1=다름 2=조회 실패(401 이면 npx wrangler whoami)
npx wrangler deploy --keep-vars   # 🔴 운영 배포 — 운영자 승인 필요. build 명령이 dist/live 를 먼저 다시 만든다
```

배포 순서: ① verify-live 가 ALL SAME(라이브가 이 소스보다 앞서 있지 않다) ② 소스 수정 ③ 시험 ④ 운영자 승인 → deploy ⑤ verify-live 다시 — 배포 직후엔 ALL SAME 이어야 한다(올라간 것 = 이 소스).

## 🔴 규칙

- **진입을 `src/index.js` 로 되돌리지 않는다.** 그러면 `/api/class-checkout/*`·`/api/class-checkout-emails`·결제 메일 재시도가 빠진다(2026-10-17 f696bc38 사고, 약 90분).
- **변수·크론·바인딩은 `wrangler.jsonc` 에 먼저 적는다.** 대시보드에서만 바꾸면 다음 배포가 되돌린다. 포트원 변수·secret 은 10-12 삭제됨 — 되살리지 말 것.
- 결제 모듈 8개는 묶지 않고 그대로 올라간다 → 라이브 바이트가 LF 라 `.gitattributes` 로 LF 고정, 빌드도 LF 로 맞춘다.
- `index.js` 는 wrangler 4.151.1 로 묶은 결과가 라이브와 바이트 같다. 버전을 올리면 `verify-live` 로 차이를 먼저 본다.
- 코드만 올리는 방식(content API PUT)을 다시 쓸 땐 `Cf-Entrypoint` 를 받을 때·올린 뒤 둘 다 확인한다.

## 공유 트리(`LiterStella-DEV` backup-clean 작업본)에 남은 미배포 작업

이 브랜치에 넣지 않았다(라이브에 없다). 그 작업을 이어 갈 세션은 이 브랜치 **위로** 옮겨야 한다 — 공유 트리에서 그대로 배포하면
발음·말하기 라우트·결제 진입·크론·서비스 바인딩이 빠진다.

- `src/index.js` 미커밋(라이브와 869줄 차이 — 포트원 결제·빌링·본인인증 코드 제거 등, 10-12 폐기 인계) · `retired-provider-test.mjs`
- `src/stella-upgrade-email-service.mjs` 미커밋(계좌이체 안내 — `stella-upgrade-bank-guide-test.mjs`)
- `src/content-point-service.mjs` 는 공유 트리 쪽이 라이브보다 **뒤처져** 있다(초대권 `active`·올인원 소울 없음)
- `wrangler.jsonc` 미커밋(크론 0·서비스 바인딩 0 — 그대로 배포하면 운영이 깨진다)

## 시험(이 트리에서 2026-10-17)

PGlite 없이 도는 17종 + PGlite 7종 + 공유 트리에서 가져온 6종 = 30종 통과.
PGlite 시험은 `PGLITE_MODULE`(또는 `PGLITE_ENTRY`)에 `@electric-sql/pglite/dist/index.js` 경로를 준다.
`growth-panel-live-integration-test.mjs`·`growth-panel-public-smoke-test.mjs` 는 라이브 API 를 부르므로 이번엔 돌리지 않았다.
