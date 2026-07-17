# 이메일 시스템 — 원칙 · 발송 리스트 · 브랜드 템플릿 (운영자 확정 2026-06-20)

> 운영자 지시: 이메일 인증 = OTP(코드) 방식, Resend/Supabase 사용 원칙 수립, 지금 필요한 자동 발송 메일 리스트+템플릿, 모든 메일에 리터스텔라 로고 + 야나완/챌린지/클래스 링크(푸터).

---

## 1. 원칙 — Resend vs Supabase 내장 이메일

| 종류 | 발송 수단 | 이유 |
|---|---|---|
| **사용자 대면·브랜드 메일** (OTP 인증코드·문의 답변·공지·환영·마일스톤·기부 리포트) | **Resend (Worker, 브랜드 HTML 템플릿)** | 완전한 HTML 브랜딩(로고·푸터 링크) 통제 / 발송량·도메인 통제 / 진단앱에 이미 OTP+Resend 패턴 완성 → 일관. |
| **auth 내부 링크** (비밀번호 재설정) | **Supabase 내장** (현행 `resetPasswordForEmail`) | 토큰·보안 Supabase가 처리. 당장 유지, 추후 Resend OTP로 통일 가능. |
| ~~Supabase 회원가입 확인 메일(Confirm email)~~ | **사용 안 함 (OFF)** | OTP를 Resend로 직접 발송하므로 Supabase의 "Confirm email"은 끈다. (testid 로그인 막혔던 그 설정 — OFF 권장.) |

**한 줄 원칙:** *브랜드가 필요한 모든 메일 = Resend(템플릿 통제). Supabase 내장은 비번 재설정만(추후 통일).* 진단앱·챌린지앱 공통 패턴(무상태 HMAC OTP)을 공유한다.

🔴 **운영자 Supabase 설정:** Authentication → Email → **"Confirm email" OFF** (OTP를 우리가 직접 발송하므로). 안 끄면 가입 후 로그인 마찰(testid 사례).

---

## 2. 지금 발송이 필요한 이메일 리스트 (우선순위)

| # | 메일 | 트리거 | 수단 | 상태 |
|---|---|---|---|---|
| E1 | **회원가입 인증코드(OTP)** | 이메일 회원가입 시 6자리 코드 | **Resend** | 🆕 구현 대상(이번) |
| E2 | **문의 답변 알림** | 운영자가 문의에 답변 | Resend | ✅ 진단 Worker에 유사 존재(notify-inquiry) — 챌린지도 연결 |
| E3 | 비밀번호 재설정 | 비번 찾기 | Supabase 내장 | ✅ 현행 유지 |
| E4 | (후속) 가입 환영 | 회원가입 완료 | Resend | 🔜 다음 배치 |
| E5 | (후속) 도전 시작/마일스톤 축하 | 챌린지 시작·3/7/10/30/66/100일 | Resend | 🔜 다음 배치 |
| E6 | (후속) 연 1회 기부 리포트 | 활동연동 기부 집행 후 | Resend | 🔜 (donation_model 출시 후) |

→ **이번 구현 = E1(OTP).** E2는 기존 패턴 연결. E4~E6은 템플릿 골격만 두고 후속.

---

## 3. 브랜드 이메일 템플릿 (재사용 골격)

모든 Resend 메일이 공유하는 골격. `{{BODY}}`만 메일별로 채움. 로고·푸터 링크 고정.
이메일은 인라인 CSS만 안전(클라이언트 호환). 로고는 공개 URL 사용.

```html
<!doctype html>
<html lang="ko"><body style="margin:0;background:#f4f1ea;font-family:'Apple SD Gothic Neo',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border-radius:18px;overflow:hidden;border:1px solid #e8e2d4;">
        <!-- 헤더: 로고 -->
        <tr><td style="padding:28px 32px 8px;text-align:center;">
          <img src="https://challenge.literstella.co.kr/assets/logo-literstella-en.png" alt="LiterStella" height="24" style="display:inline-block;" />
        </td></tr>
        <!-- 본문 -->
        <tr><td style="padding:12px 32px 28px;color:#1d2433;font-size:15px;line-height:1.7;">
          {{BODY}}
        </td></tr>
        <!-- 푸터: 야나완 / 챌린지 / 클래스 링크 (운영자 지시 고정) -->
        <tr><td style="padding:20px 32px;border-top:1px solid #efe9da;background:#faf7ef;text-align:center;font-size:12px;color:#8a8270;">
          <a href="https://read.literstella.co.kr" style="color:#c8a84b;text-decoration:none;margin:0 8px;">📖 영어 독서 진단</a>
          <a href="https://challenge.literstella.co.kr" style="color:#c8a84b;text-decoration:none;margin:0 8px;">🏆 야나완 챌린지</a>
          <a href="https://class.literstella.co.kr/classes" style="color:#c8a84b;text-decoration:none;margin:0 8px;">🎓 원서 클래스</a>
          <div style="margin-top:12px;color:#b0a892;">© LiterStella · 영어 원서를 끝까지 읽는 습관</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
```

### E1 — 회원가입 인증코드(OTP) {{BODY}}
```html
<div style="font-size:18px;font-weight:800;margin-bottom:8px;">이메일 인증 코드</div>
<p style="margin:0 0 16px;color:#5a5446;">아래 6자리 코드를 회원가입 화면에 입력해 주세요. (10분 내 유효)</p>
<div style="font-size:34px;font-weight:900;letter-spacing:10px;color:#c8a84b;text-align:center;padding:18px;background:#fdf9ee;border:1px dashed #ddca97;border-radius:14px;">{{CODE}}</div>
<p style="margin:16px 0 0;font-size:13px;color:#8a8270;">본인이 요청하지 않았다면 이 메일을 무시하세요.</p>
```

### E2 — 문의 답변 알림 {{BODY}} (참고)
```html
<div style="font-size:18px;font-weight:800;margin-bottom:8px;">문의에 답변이 등록됐어요</div>
<p style="margin:0 0 12px;color:#5a5446;">{{NICKNAME}}님, 남겨주신 문의에 운영자가 답변했습니다.</p>
<blockquote style="margin:0;padding:12px 16px;background:#fdf9ee;border-left:3px solid #c8a84b;border-radius:8px;color:#1d2433;">{{ANSWER}}</blockquote>
<a href="https://challenge.literstella.co.kr" style="display:inline-block;margin-top:16px;padding:11px 20px;background:#c8a84b;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">확인하러 가기 →</a>
```

---

## 4. 구현 계획 (E1 OTP 회원가입)

**프론트 (LoginModal 신규 'signup' 탭):**
- 이메일 = 아이디 직접입력 + 도메인 선택(naver.com·gmail.com·daum.net·kakao.com·직접입력) 한국형.
- 비밀번호 = 6자 이상, 영문/숫자/특수기호 허용 + 비밀번호 확인.
- 흐름: 입력 → [인증코드 받기](Worker `/api/auth/otp/send`) → 6자리 입력 → [인증·가입](verify + `supabase.auth.signUp`) → 세션 → **다이어리 바로 사용(Level 1)**.
- '도전하기'(onApply)는 챌린지 참가폼 그대로(분리 유지).

**백엔드 (05-secure-api Worker — 진단 OTP 패턴 재사용):**
- `POST /api/auth/otp/send {email}` → 6자리 코드 생성 → Resend로 위 E1 템플릿 발송 → 클라엔 HMAC 토큰만 반환(무상태).
- `POST /api/auth/otp/verify {email, code, token}` → HMAC 재검증 → OK 시 클라가 `signUp(email,password)` 진행.
- 🔴 운영자: Worker에 `RESEND_API_KEY`·`OTP_SECRET` 시크릿 + Supabase "Confirm email" OFF.

**Level 1 다이어리 무료:** 가입(enrollment 없음) = `isLoggedIn` true → 다이어리 모드 사용 가능(이미 동작). 챌린지 유도 배너는 다이어리에 노출 가능(Phase C).

> 진단앱 OTP(diag_email_otp.md)와 동일 무상태 HMAC. from 도메인 인증(7월 도메인 인증 시 인증@literstella.co.kr) 전까지 Resend 무료(onboarding@resend.dev → 제약).
