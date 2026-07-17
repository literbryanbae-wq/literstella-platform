// sources.mjs — 원서 권위 출처(리스트 셀렉션) 정본.
// 순수 상수만. 로직 0. 진단앱 100선·챌린지 카탈로그가 'BBC/TIME/…' 라벨을 같은 값으로 쓰게 하는 게 목표.
// ⚠️ packages/core 에서만 수정. 각 앱 src/core 복사본은 손대지 말 것(sync-core가 덮어씀).
// 출처: 01-reading-diagnosis/authority-books.js AUTHORITY_SOURCES (verbatim, 2026-06-21).
// 🟡 현재 미배선 — 진단앱은 아직 자기 authority-books.js 복사본 사용. 오픈 후 import 전환.

export const AUTHORITY_SOURCES = {
  bbc:     { label: 'BBC 빅리드', short: 'BBC', desc: '2003 영국 대중 70만 표 투표 100선' },
  time:    { label: 'TIME 100', short: 'TIME', desc: 'TIME 선정 1923년 이후 영문소설 100' },
  nyt21:   { label: 'NYT 21세기', short: 'NYT', desc: 'NYT 21세기 최고의 책 100선' },
  snu:     { label: '서울대 권장', short: '서울대', desc: '서울대 권장도서 100선' },
  harvard: { label: 'Harvard 클래식', short: 'Harvard', desc: '하버드 클래식 정전' },
};
