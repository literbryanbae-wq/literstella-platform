# packages/core — LiterStella 공유 정본 (single source of truth)

> 🟢 상태: **준비 단계(2026-06-21 생성). 아직 어느 앱에도 연결 안 됨 = 라이브 무영향.**
> 본 배선은 **7/1 정식오픈 이후**에 진행한다(출시 전엔 점검·준비만, 강화는 출시 직후 — 보안 세션 교훈과 동일).

## 왜 있나 (한 줄)
진단앱·챌린지앱·코칭이 **같은 데이터·용어·디자인 토큰·연결 코드를 각자 복붙**해서 한쪽만 고치면 어긋난다(drift).
→ 여기 **딱 한 번** 정의하고, **빌드 직전 각 앱 `src/core`로 복사**해서 양쪽이 같은 걸 쓰게 한다. 한 곳만 고치면 양쪽 반영.

## 근본 진단 (멀티에이전트 감사 결론, 2026-06-21)
- drift의 원인은 "바닐라 vs React"가 **아니다** — **공유 단일소스 부재**다.
- 검증된 사실: 진단앱도 이미 React19 설치(=바닐라는 그냥 UI 프레임워크 안 쓸 뿐, 번들 구조 동일) · 책 100선 ID는 두 앱이 **바이트 단위로 동일** · 토큰 정본 `shared-assets/brand/tokens.css`는 **아무도 import 안 하는 고아** · 코칭의 토큰 상대경로 import는 **이미 조용히 깨져 있음**.
- 진짜 drift 씨앗 = **데이터 파일에 앱별 로직(검색/find 헬퍼)이 섞여 들어간 것.** → core는 **데이터와 로직을 분리**한다(헬퍼는 각 앱에 남김).

## 🔴 절대 규칙
1. **상대경로/npm `file:` 의존으로 참조 금지.** 3개 앱은 각각 **별도 git 레포**에서 배포돼(각 레포만 클론됨) 루트의 이 폴더가 빌드 때 안 보인다 — 코칭 깨진 import가 그 증거. **유일한 안전책 = 빌드 직전 각 레포 `src/core`로 복사(sync).**
2. **monorepo / npm workspace / 심볼릭링크 도입 금지(현 단계).** 비기술 운영자 + 병렬 세션 + Drive 동기화 환경에선 새 footgun.
3. **복사본(`<app>/src/core`)은 손으로 고치지 말 것.** 자동생성 "DO NOT EDIT" 헤더가 붙는다. **항상 여기 `packages/core`만 수정.**
4. **이 폴더는 git으로만 관리하고 Drive 동기화에서 제외**한다(루트 temp-upload 충돌 방지).
5. **데이터·CSS만** 다룬다. **워커 파일·배포 배선은 안 건드린다**(진단 wrangler가 워커+프론트를 묶어 배포하므로).

## 단계 (확정)
- **지금(7/1 전, 무위험):** 이 폴더 + `scripts/sync-core.mjs`를 **만들기만**. 라이브 앱 배선 X. (현재 여기까지.)
- **오픈 직후(7월):** 순수 데이터부터 정규화(용어→세그먼트→소스→레벨→책, 데이터/헬퍼 분리). sync를 챌린지 prebuild에 배선(복사 실패=빌드 실패=옛 버전 유지=fail-safe).
- **가을(규모 성장):** 글루(supabase 팩토리·ssoStorage·onboard 코덱·테이블/RPC 계약)·마스코트 데이터 분리. 챌린지 React를 '통합 셸'로 키우기 시작.
- **통합 앱(literstella.co.kr):** 챌린지 React가 루트 셸, 진단을 라우트로 흡수. 남은 건 바닐라 화면 React 포팅 + Worker API→Pages Functions.

## 구조
```
packages/core/
  data/
    terms.mjs         ← ✅ 정본(브랜드명·성공/완독·금지어). 순수 상수, 로직 0.
    sources.mjs       ← ✅ 정본(원서 권위 출처 5종 — BBC/TIME/NYT/서울대/Harvard).
    badge-economy.mjs ← ✅ 정본(배지·포인트 순수 숫자: streak·honor_win·join 임계·후기보상).
    (segments.mjs)    ← 다음(오픈 후)
    (books.mjs)       ← 다음(데이터/헬퍼 분리 필요해 더 신중히)
  tokens/
    (tokens.css)    ← shared-assets/brand/tokens.css 승격 예정(오픈 후)
  glue/
    (supabase, ssoStorage, onboard, supabase-contract) ← 가을
  scripts/
    sync-core.mjs   ← 초안. 아직 어느 빌드에도 연결 안 됨.
```

## 쓰는 법 (배선 후, 참고)
각 앱은 `import { BANNED_WORDS } from './core/data/terms.mjs'` 처럼 **자기 레포 안의 복사본**을 import한다(루트 직접참조 X). 복사는 sync-core가 빌드 전에 수행.
