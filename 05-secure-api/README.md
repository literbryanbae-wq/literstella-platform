# literstella-api (보안 백엔드 — 초안/미배포)

> 🚫 **아직 배포하지 마세요.** 포트원 가맹 승인 후 `DESIGN.md` 8절 순서대로 배포.
> 지금은 스캐폴딩만 — 어디서도 호출 안 되고, 모든 기능은 플래그(`ADMIN_API_ENABLED`/`PAYMENT_ENABLED`, 기본 false) 뒤에 있어 **라이브 영향 0**.

담는 것: 관리자 service_role 쓰기(#8b) + 포트원 V2 결제(구독·웹훅·환불).
설계 전문: [`DESIGN.md`](./DESIGN.md) · 결정/순서: `memory/payment_portone_sequencing.md`

## 켤 때 (승인 후)
1. `npm i` (wrangler) → `npx wrangler deploy` (플래그 OFF 상태)
2. 시크릿 주입: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` 등 (wrangler.jsonc 주석 목록)
3. `ADMIN_API_ENABLED=true` → AdminPanel을 이 API로 교체·검증
4. RLS 조이기(anon 쓰기 제거) — 검증 후에만
5. DB 마이그레이션 + `PAYMENT_ENABLED=true` + 포트원 웹훅 등록 + WAF

## ★ 채울 자리 (포트원 V2 문서 대조 — 추정 금지)
`src/index.js`의 `★` 주석: 빌링키 발급/결제 엔드포인트·바디, 웹훅 서명 헤더/검증식, 페이로드 paymentId 경로.
