# LiterStella English Learning Platform

`english.literstella.co.kr`의 독립 배포 루트입니다.

## 현재 공개 상태

- Cloudflare Worker 정적 자산으로 공개 준비 화면만 제공합니다.
- 실제 회원 데이터, 가상 대시보드, 신청 폼, 인증 토큰은 포함하지 않습니다.
- 운영 주소: `https://english.literstella.co.kr/`
- Worker: `literstella-english-learning`
- 2026-09-05 검증 배포 버전: `1ee0d798-9699-405f-852e-7b8ffc790f47`

## 의도한 경계

- 화면과 배포 수명 주기는 이 플랫폼이 소유합니다.
- 로그인은 기존 LiterStella Supabase SSO 싱글턴과 `.literstella.co.kr` 공유 세션을 재사용합니다.
- 신규 평가단 신청은 서버에서 클래식 8종의 명시적 소장 이력을 확인한 뒤에만 허용합니다.
- 원서 리더·문장집·필사·쉐도잉 코어는 복사하지 않습니다. 기존 소유 앱을 호출하고, 공통 학습 이벤트 계약으로 결과를 모읍니다.
- 브라우저별 `localStorage`/IndexedDB는 다른 서브도메인에서 자동 공유되지 않으므로 학습 데이터의 권위 저장소로 사용하지 않습니다.

## 운영 전 남은 항목

1. 평가단 SQL을 검토·승인한 뒤 적용합니다.
2. 보안 API 라우트와 `https://english.literstella.co.kr` CORS 허용을 함께 배포합니다.
3. 연결형 프로덕션 빌드에서 기존 SSO 어댑터를 켭니다.
4. 실계정으로 로그인, 8종 권한, 중복 신청, 철회, 로그아웃을 확인합니다.
5. 통과 후에만 준비 화면을 실제 학습실로 교체합니다.

`wrangler.jsonc`는 Custom Domain, `workers_dev: false`, `preview_urls: false`, 정적 404 및 보안 헤더를 고정합니다.
