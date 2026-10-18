# literstella-api

운영 중인 Cloudflare Worker다. 관리자·회원 인증·메일·학습·Toss 결제 등 공용 기능을 제공한다.
빌드·배포·라이브 대조는 [`LIVE-SOURCE.md`](./LIVE-SOURCE.md) 를 따른다(`node ops/build-live.mjs` · `node ops/verify-live.mjs`).

## 2026-10-12 연동 폐기

사용자 요청으로 포트원/KG SDK·구 결제/구독/인증 경로 및 설정을 로컬 소스에서 제거했다. 운영의 해당 시크릿 2개·공개 설정 2개도 삭제했다. 수정 소스는 2026-10-18 `main` 위 브랜치 `ops/api-unreleased-20261018` 로 옮겼다 — 운영 배포는 아직 하지 않았다(운영자 승인 필요).

- 기존 Toss 결제와 Resend 웹훅 서명 헬퍼는 유지한다.
- `DESIGN.md`와 `PORTONE-V2-SPEC.md`는 폐기된 과거 설계다. 그곳의 키 입력·웹훅·빌링 설정을 복구하지 않는다.
- 결제/구독 SQL은 과거 데이터 구조 기록이다. 이번 작업으로 운영 테이블이나 거래 기록을 지우지 않는다.
- 정확한 변경 범위와 운영 상태: 루트 `.ai-coordination/inbox-claude/portone-kg-retirement-20261012.md`.

## 로컬 회귀 검사

```sh
node --check src/index.js
node retired-provider-test.mjs
node class-pass-payment-test.mjs
node class-payment-probe-test.mjs
```

배포 전 해당 변경만 분리하고 현재 운영 버전·바인딩을 대조한다. 키 값은 소스·문서·채팅에 기록하지 않는다.
