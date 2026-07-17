# WAF 레이트리밋 설정 스펙 (P0-1 / 보안 감사 M2·M3)

> 목적: 진단 Worker(`read.literstella.co.kr`)의 OTP·익명 INSERT 엔드포인트에 IP 기반 레이트리밋을 걸어
> 메일폭격(M2)·OTP brute-force(M3)·익명 스팸을 차단. **코드 변경 없음 — Cloudflare zone 설정.**
> 적용 주체 = **운영자**(대시보드 또는 API). 이 문서는 그대로 적용 가능한 스펙.

---

## ⚠️ 먼저 — 이 설정이 막는 것 / 못 막는 것
- ✅ 막음: `read.literstella.co.kr/api/*` 로 오는 폭주(OTP 메일발송·코드 대입·익명 INSERT 스팸).
- ❌ **못 막음: Supabase 직접호출 PII 누출(감사 C1~C4).** `bvhkvucsoetktoxzupwt.supabase.co/rest/v1/...`는 **Cloudflare zone 밖**(다른 도메인, 프록시 안 됨)이라 zone 레이트리밋이 닿지 않음. **그건 Phase 1 RLS로만 해결** — WAF로 대체 불가. (혼동 주의: WAF는 PII 누출을 닫지 않음.)

## 플랜 의존 (중요)
| 항목 | Free | Pro | Business |
|---|---|---|---|
| 레이트리밋 규칙 수 | **1** | 10 | 25 |
| characteristics 수 | 2 | 3 | 5 |
| body(JSON) 기반 제한 | ❌ | ❌ | ❌ (Enterprise Advanced RL 전용) |

→ **email별 제한은 불가(body 검사 Enterprise 전용) → IP 기반으로 설계.** 규칙 개수는 플랜 따라 아래 A/B 선택.

---

## A. 베이스라인 — **모든 플랜(Free 포함, 규칙 1개)**
OTP 두 엔드포인트를 한 규칙으로 묶음. 대시보드: **Security → WAF → Rate limiting rules → Create rule**.

- **이름**: `otp-throttle`
- **If incoming requests match (expression)**:
  ```
  (http.request.uri.path in {"/api/send-code" "/api/verify-code"})
  ```
- **With the same characteristics**: `IP source address` (+ `Data center` 권장)
  - = `["cf.colo.id", "ip.src"]` (Free는 2개까지 OK)
- **When rate exceeds**: `5 requests` / `period 60s`
- **Then**: **Block** (← API라 Managed Challenge 부적합. fetch가 챌린지를 못 받음)
- **For (mitigation timeout)**: `600s` (10분)

> 정상 사용자: 코드 1회 발송 + 입력 1~2회 → 분당 5 미만. 공격: 분당 5 초과 시 10분 차단.

## B. 권장 — **Pro 이상(규칙 분리, 임계 세분화)**
규칙 3개로 분리해 엔드포인트별 최적 임계.

| # | 이름 | expression | characteristics | period | 한도 | action | mitigation |
|---|---|---|---|---|---|---|---|
| 1 | `send-code-rl` | `http.request.uri.path eq "/api/send-code"` | `cf.colo.id, ip.src` | 60s | **3** | Block | 300s |
| 2 | `verify-code-rl` | `http.request.uri.path eq "/api/verify-code"` | `cf.colo.id, ip.src` | 60s | **5** | Block | 600s |
| 3 | `anon-insert-rl` | `http.request.uri.path in {"/api/leads" "/api/save-result"} and http.request.method eq "POST"` | `cf.colo.id, ip.src` | 60s | **10** | Block | 300s |

> verify-code 5/분 × OTP 10분 만료 = 최대 ~50회 시도 → 6자리(100만분의1) 대비 무의미한 확률. brute-force 차단.

---

## 적용 방법

### 방법 1 — 대시보드 (가장 쉬움, 운영자 권장)
1. Cloudflare 대시보드 → 도메인 `literstella.co.kr` 선택.
2. **Security → WAF → Rate limiting rules → Create rule**.
3. 위 표의 expression / characteristics / rate / action / duration 입력.
4. **Deploy**. (먼저 action을 `Log`로 두고 Security Events에서 오탐 확인 후 `Block` 전환 권장.)

### 방법 2 — API (curl)
```bash
# 필요: API 토큰(Zone.WAF Edit 권한), ZONE_ID (대시보드 Overview 우측 API 섹션)
export CF_API_TOKEN="..."; export ZONE_ID="..."

# http_ratelimit 단계 ruleset에 규칙 추가(POST = 신규 ruleset 생성, 이미 있으면 PUT으로 rules 병합)
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" \
  -d '{
    "name": "Rate limits", "kind": "zone", "phase": "http_ratelimit",
    "rules": [
      { "action": "block",
        "expression": "http.request.uri.path eq \"/api/send-code\"",
        "ratelimit": { "characteristics": ["cf.colo.id","ip.src"], "period": 60, "requests_per_period": 3, "mitigation_timeout": 300 } },
      { "action": "block",
        "expression": "http.request.uri.path eq \"/api/verify-code\"",
        "ratelimit": { "characteristics": ["cf.colo.id","ip.src"], "period": 60, "requests_per_period": 5, "mitigation_timeout": 600 } },
      { "action": "block",
        "expression": "(http.request.uri.path in {\"/api/leads\" \"/api/save-result\"}) and http.request.method eq \"POST\"",
        "ratelimit": { "characteristics": ["cf.colo.id","ip.src"], "period": 60, "requests_per_period": 10, "mitigation_timeout": 300 } }
    ]
  }'
```
> ⚠️ `http_ratelimit` ruleset이 이미 있으면 위 POST는 에러("already exists") → 기존 ruleset GET 후 rules 병합해 PUT(`/rulesets/{id}`). 기존 규칙 덮어쓰기 주의(update는 전체 교체).

### 방법 3 — Terraform (IaC)
```hcl
resource "cloudflare_ruleset" "rate_limiting" {
  zone_id = var.zone_id
  name    = "Rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    action     = "block"
    expression = "http.request.uri.path eq \"/api/send-code\""
    ratelimit {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 60
      requests_per_period = 3
      mitigation_timeout  = 300
    }
  }
  rules {
    action     = "block"
    expression = "http.request.uri.path eq \"/api/verify-code\""
    ratelimit {
      characteristics     = ["cf.colo.id", "ip.src"]
      period              = 60
      requests_per_period = 5
      mitigation_timeout  = 600
    }
  }
}
```

---

## 검증·튜닝
- **테스트**: 같은 IP로 `/api/send-code`를 빠르게 6회 호출 → 4번째부터 429 확인(Pro B안 기준 3/분). 또는 Security → Events에서 rule 매칭 로그 확인.
- **오탐(NAT)**: 회사/학교 등 공유 IP에서 동시 사용자가 많으면 조기 차단 가능 → 한도를 5→10으로 상향하거나 mitigation_timeout 축소.
- **권장 점진 적용**: action을 먼저 `Log`로 1~2일 운영 → Events에서 정상 트래픽 분포 확인 → `Block` 전환.

## 후속 (코드 — 별도 작업, 선택)
- 프론트가 **429 응답을 친화적으로 처리**: "잠시 후 다시 시도해 주세요" 안내(현재는 일반 에러). 진단 OTP 발송/검증 핸들러에 429 분기 추가 권장.
- 더 강한 방어가 필요하면 Worker에 **KV 기반 email별 쿨다운/실패 카운터**(감사 M2·M3 recommendation ②③) — 단 zone 레이트리밋(IP)으로 1차 충분.

> 상태: **운영자 적용 대기.** 적용 시 본 문서 상단에 ✅ 표기.
