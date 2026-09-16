// serviceMenu.js — 푸터 '리터스텔라 서비스' 메뉴 정본. 진단·챌린지(다이어리)·클래스 **바이트 동일 사본**.
//
// 🔴 왜 도메인 단위인가(운영자 2026-09-09): 푸터가 기능 단위로 늘어나면서 바로 위의 서비스 카드
//    14개와 겹쳐 같은 곳으로 가는 문이 두 벌이 됐다. 게다가 세 앱이 각자 손으로 유지해 이미
//    갈려 있었다 — 진단에만 '원서 난이도 가이드', 챌린지에만 '딱히그냥 테마', 클래스 첫 항목만
//    이모지 없음. **푸터 = 앱(도메인) 목록, 카드 = 기능 목록**으로 축을 갈라 중복을 없앤다.
//
// 🔴 늘릴 땐 '새 기능'이 아니라 **새 도메인**일 때만 늘린다. 기능은 서비스 카드
//    (packages/service-discovery) 몫이다. 여기에 기능을 넣으면 중복이 다시 시작된다.
//
// ⚠️ 세 앱은 서로 다른 레포다. 이 파일은 `node scripts/check-shared-drift.mjs` 가 세 사본을
//    대조한다(값이 같다 = 아직 안 어긋났다는 뜻일 뿐이라 매번 확인한다).
//    후속: 코덱스의 `packages/service-discovery` 로 승격하면 사본 자체가 사라진다
//    (CODEX-CLAUDE-HANDOFF 2026-09-09 푸터 공용화 요청 참고).
//
// 이모지는 **전 항목 필수**(빈 칸 금지 — 한 칸만 비어도 목록 정렬이 어긋나 보인다).
// href 가 null 이면 아직 열지 않은 서비스라 링크가 아니라 안내로만 그린다.

export const SERVICE_MENU = [
  {
    // 맨 위 — 서비스 8개가 아니라 '여기가 뭐 하는 곳인가'를 먼저 열어 준다(운영자 2026-09-16).
    //   새 기능이 아니라 **새 도메인**이라 이 목록의 규칙에 맞는다(위 주석 참고).
    //   🔴 www 필수 — bare 도메인(literstella.co.kr)은 연결되지 않았다(실측: www 200 / bare 응답 없음).
    key: 'home',
    emoji: '🏠',
    label: '리터스텔라 소개',
    sub: '무엇을 하는 곳인지',
    href: 'https://www.literstella.co.kr',
  },
  {
    key: 'english',
    emoji: '✨',
    label: '올인원 영어 학습실',
    sub: '읽은 영어를 내 말로',
    href: 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation',
    isNew: true,
  },
  {
    key: 'read',
    emoji: '📖',
    label: '무료 영어 독서 진단',
    sub: 'MY READ TO SPEAK',
    href: 'https://read.literstella.co.kr/',
  },
  {
    key: 'challenge',
    emoji: '🏆',
    label: '영어 챌린지 야나완™',
    sub: '원서 완독 100일 습관',
    href: 'https://challenge.literstella.co.kr/',
  },
  {
    key: 'class',
    emoji: '🎓',
    label: '클래식 원서 강독',
    sub: '평생 소장 원서 수업',
    href: 'https://class-new.literstella.co.kr/classes',
  },
  {
    key: 'partner',
    emoji: '🎙️',
    label: '나도 영어 원서 강독가',
    sub: '강독가 과정 안내',
    href: 'https://partner.literstella.co.kr',
  },
  {
    key: 'timer',
    emoji: '⏳',
    label: '딱히그냥 타이머',
    sub: '읽는 시간을 재는 독립 앱',
    href: 'https://literstella-reading-timer.pages.dev/',
  },
  {
    key: 'global',
    emoji: '🌏',
    label: 'LiterStella Global',
    sub: '해외 독자를 위한 영문 사이트',
    href: 'https://global.literstella.com/',
  },
  {
    key: 'goods',
    emoji: '🛍️',
    label: 'Book & Goods',
    sub: '책과 굿즈를 준비하고 있어요',
    href: null,
  },
];

// 지금 보고 있는 앱은 링크가 아니라 '현재'로 표시한다(누르면 제자리인 문을 만들지 않는다).
export function serviceMenuFor(currentKey) {
  return SERVICE_MENU.map((item) => (
    item.key === currentKey
      ? { ...item, current: true, sub: '지금 보고 계신 서비스', href: null }
      : item
  ));
}
