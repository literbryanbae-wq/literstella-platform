# LiterStella English Learning Platform

운영: https://english.literstella.co.kr/

## 2026-09-05 라이브

- 소개·FAQ·목업·고객용 가상 데모와 실제 SSO 평가단 신청을 공개했다.
- 프런트 Worker literstella-english-learning: deb66d63-5e4f-4873-89ef-716d5ec85030.
- 프런트 소스 codex/english-growth-studio-20260903: 800ff83977223a9703d8d663866454866c99b085.
- API Worker literstella-api: 1065edde-e863-4e33-aefe-78acae033a28 (100%). 소스 a9f29623, 인계 문서 b935168d, 격리 codex/english-api-live-20260905.
- 로컬 커밋만 생성. GitHub push는 정책상 별도 전송 승인이 필요하여 차단됐고 우회하지 않았다. origin/main 반영 완료는 아니다.

## 범위와 기록

- 학습 그래프·예측·상황 대화는 가상 데모다. 실회원 학습 통합과 실시간 라일라 음성 대화 완료가 아니다.
- 실제 SSO 계정과 서버의 명시적 8종 소장 원장으로 신청을 판정한다. 클래식7권+theory 필수; 관리자/기간권/파생 접근은 제외한다.
- 100명은 선정 정원이며 자동 선착순 선정이 아니다. 종료일 미정, 신청 정보는 제출일부터90일.
- 두 신청 테이블 FORCE RLS, anon/authenticated 직접 접근·RPC 실행 불가. 기존 requireUser 검증 후 service_role에서 처리한다.
- Supabase remote migrations: 20260905001640 growth_panel_intake, 20260905001859 growth_panel_auth_uid_index.
- 로컬 CLI 생성 migration 시각20260905001224는 같은 SQL의 원격 적용 시각과 다르다. 공용 DB 전체 이력을 보관하는 디렉터리가 아니므로 여기서 supabase db push 금지.
- 철회 즉시 연락처·답변 삭제, 동의·철회 확인은 원래 보관기간까지. API Cron 매일03:25KST (25 18 * * *) 만료 정보 파기.
- 기존 인증 메일·시크릿·계정·학습 원장은 변경하지 않았다. 가상 점수/시간은 서버에 쓰지 않으며 ls_growth_demo_* 기기 전용 키를 사용한다.
- 기존 코어는 Class checkout 소스를 직접 공유하며 복제하지 않는다. AI 예문·사전 조회는 사용자의 명시적 클릭 때 기존 API를 사용한다.
- 모든 앱 메뉴에 홍보 링크를 추가한 것은 아니다.

## 검증

- 연결 빌드1878modules/18files/7,548,128bytes 및 공개 자산/SSO/데모 경계 PASS. 개발 검토 전용 빌드는 별도 유지.
- API24그룹+라우트/CORS/Cron 통합+기존 비DB회귀+dryrun PASS. 운영 비로그인401/no-store, preflight204, 비허용origin CORS거절.
- 운영 service_role rollback10항목: 실제8종/비소장거절/이전동의거절/신청/소장스냅샷/90일/중복불변/재조회/철회필드삭제/만료정리 PASS.
- 실제 브라우저 Class로그인→english SSO→자격통과→운영검수0905 제출→DB번호일치→새로고침 동일 접수번호 PASS.
- 테스트 신청 정리는 사용자 확인 요청 상태. 실비소장 회원 UI와 실제 학습기록 통합/음성대화는 미검증.
- DB 권한·advisor·메일·데모누수 독립 사후감사 P0/P1 없음.

## 재현

공유 dirty Class 전체를 배포하지 않는다. 검토된 위 프런트 커밋이 있는 소스 작업트리에서 독립 빌드만 사용한다.

```powershell
node scripts/prepare-release.mjs 'E:/LiterStella Project/.codex-worktrees/english-growth-studio-20260903'
node ../01-reading-diagnosis/literstella-reading-diagnosis/node_modules/wrangler/bin/wrangler.js deploy --config wrangler.jsonc --keep-vars
```

준비 스크립트는 검증된 공개 산출물만 플랫폼의 ignored dist로 복사한다. env/시크릿/유료콘텐츠/전체 Class라우터 제외. public/은 이전 준비 화면 보관본이며 현재 배포 대상이 아니다.

- index SHA256: 4BFFCFC8431B6BD54CCC47B6FE7E3EE91C9017789A53C68DF2EB34CA4E62F2EB.
- 최초 _redirects 규칙 오류는 Cloudflare가 배포 전 거절했다. SPA asset handling으로 수정 후 정상 공개됐다.
- API 롤백 기준39f5f4fc-0f45-465e-be71-808cf8c30f59. 롤백 시 먼저 campaign 비활성화로 신청 공개상태를 맞춘다.
