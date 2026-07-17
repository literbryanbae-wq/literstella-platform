// badge-economy.mjs — 배지/포인트 경제 '순수 숫자' 정본.
// 순수 상수만. 로직 0. (JSX 배지 카탈로그·아이콘·계산 헬퍼는 각 앱에 남김 — 데이터/로직 분리 원칙.)
// ⚠️ packages/core 에서만 수정. 각 앱 src/core 복사본은 손대지 말 것(sync-core가 덮어씀).
// 출처: 02-challenge/src/data/challengeData.js (verbatim, 2026-06-21) + [[point-economy]] 운영자 확정값.
// 🟡 현재 미배선 — 챌린지는 아직 challengeData.js 자기 정의 사용. 오픈 후 import 전환.
//    전환 전까지는 challengeData.js 가 실효 정본 — 값 변경 시 양쪽 동기화 주의(이 파일이 존재 이유).

// ── 일수 성공 배지 포인트 (streak). 100일=플래그십 1,000P (운영자 확정 2026-06-18) ──
export const STREAK_BADGE_POINTS = {
  streak_3: 15, streak_7: 25, streak_10: 35, streak_30: 30, streak_66: 66, streak_100: 1000,
};

// ── 성공의전당(100일 성공 누적 회수) 1·2·3회 — streak_100과 별개 명예 (운영자 확정 2026-06-18) ──
// ⚠️ gold(3,000)이 단일 적립행 → point_transactions.amount CHECK ±3,000 이상이어야 DB 적립됨.
export const HONOR_WIN_POINTS = {
  honor_win_bronze: 1000, honor_win_silver: 2000, honor_win_gold: 3000,
};

// ── 도전의전당 참가 회수 배지 임계값 (challengeJoinBadges minJoins) ──
export const JOIN_BADGE_THRESHOLDS = {
  first: 1, bronze: 3, silver: 6, gold: 10,
};

// ── 성공 후기 차등 보상 — 후기 가치는 성공 단계에 비례 (운영자 확정 2026-06-11) ──
export const REVIEW_POINTS = { '30일': 10, '66일': 20, '100일': 30 };

// 참고: 완독 포인트(책별 차등 BOOK_POINTS, 27권)는 challenge 전용·변동이라 아직 challengeData.js 유지.
//      배선 시점에 함께 이전 검토.
