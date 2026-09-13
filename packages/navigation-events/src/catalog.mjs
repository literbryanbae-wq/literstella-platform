export const KAKAO_URL = 'https://pf.kakao.com/_xkxdZxeb/chat';
export const APP_NAMES = { read: '영어 독서 진단', class: '클래식 원서 강독', challenge: '야나완 챌린지', diary: '원서 다이어리', english: '올인원 영어 학습실' };
export const APP_HOME = { read: '/', class: '/classes', challenge: '/', diary: '/?mode=diary', english: '/growth-lab?preview=1&page=start' };
export const EVENTS = Object.freeze([
  { id: 'last100', title: '라스트 야나완 100일', summary: '올해의 마지막 완독 도전', art: 'hogwarts-h4-reading-stage', focal: 'right', end: '2026-09-23', period: '마지막 시작일 2026. 9. 23.', cta: '도전 일정·참여 안내', href: 'https://challenge.literstella.co.kr/#challenge-plan',
    facts: [['대상', '원서 읽기를 꾸준히 이어가고 싶은 분'], ['일정', '시작일과 쉬는 날에 따라 도전 일정이 달라집니다.'], ['참여', '기존 챌린지 안내에서 목표와 참여 조건을 확인하세요.']],
    notice: '도전 연장과 소장 수강권 선물에는 각각 조건이 있습니다. 참여 화면의 안내를 확인해 주세요.' },
  { id: 'together', title: '평생소장 프로필·수강권 선물', summary: '함께 읽을 사람에게 전하는 선물', art: 'classic-c4-saved-next', focal: 'right', end: '2026-09-23', period: '신청 기간·접수 상태는 신청 화면에서 확인', cta: '내 자격·선물 안내 확인', href: 'https://class-new.literstella.co.kr/together',
    facts: [['대상', '올인원 평생소장 컬렉션 8종 연결이 확인된 회원'], ['혜택', '함께 읽을 사람의 독립 계정과 수강 혜택'], ['조건', '설문·의견 참여 동의 등 신청 화면의 조건을 확인하세요.']],
    notice: '이 안내를 읽는 것만으로 수강권이 지급되지 않습니다. 실제 접수 여부와 자격은 기존 신청 화면에서 확인합니다.' },
  { id: 'english-panel', title: '올인원 영어 학습실 평가단', summary: '먼저 써 보고 의견을 들려주세요', art: 'service-english-learning', focal: 'center', period: '모집 안내·신청 상태 확인', cta: '평가단 모집 안내 확인', href: 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation#gi-application',
    facts: [['경험', '읽기·듣기·쓰기·말하기를 이어가는 학습실'], ['참여', '학습실을 이용하고 사용 경험과 의견을 나눕니다.'], ['혜택', '올인원 프로필 제공 범위와 참여 조건은 모집 안내에서 확인하세요.']],
    notice: '모집·선정·이용 조건은 기존 평가단 신청 페이지의 최신 안내가 기준입니다.' },
  { id: 'timer', title: '딱히그냥 타이머', summary: '두 친구와 집중하는 독서 시간', art: 'hogwarts-h3-reading-desk', focal: '84%', period: '상시 이용', cta: '타이머 선택해서 열기', timer: true,
    facts: [['선택', '클래식 또는 딱히그냥 타이머'], ['이용', '타이머를 선택한 뒤 집중할 시간을 정하세요.'], ['기록', '앱의 타이머 연결 기능이 있는 경우 기존 연결 경로를 사용합니다.']],
    notice: '메뉴를 열거나 닫아도 실행 중인 타이머를 새로 시작하지 않습니다.' },
]);
export function dayKey(now = new Date()) { return new Date(now.getTime() + 32400000).toISOString().slice(0, 10); }
export function eventEnded(event, now = new Date()) { return Boolean(event.end && dayKey(now) > event.end); }
export function eventPath(id = '') { return id ? `/events/${encodeURIComponent(id)}` : '/events'; }
export function eventRoute(pathname) {
  const match = /^\/events(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return pathname.startsWith('/events/') ? { id: '__missing' } : null;
  try { return { id: match[1] ? decodeURIComponent(match[1]) : '' }; } catch { return { id: '__missing' }; }
}
export function safeReturn(value, fallback = '/') { return typeof value === 'string' && /^\/(?![\\/])/.test(value) && !/[\r\n\\]/.test(value) && !eventRoute(value.split(/[?#]/)[0]) ? value : fallback; }
export function eventOrigin(value, app) {
  const url = new URL(safeReturn(value, APP_HOME[app] || '/'), 'https://local.invalid');
  for (const key of ['bridge','token','access_token','refresh_token','code','host']) url.searchParams.delete(key);
  if (app === 'diary') url.searchParams.set('mode','diary');
  if (app === 'challenge') url.searchParams.delete('mode');
  return url.pathname + url.search + url.hash;
}
export function savedEventContext(state) {
  const value = state?.usr || state;
  return { app: Object.hasOwn(APP_HOME, value?.lsneApp) ? value.lsneApp : null, path: safeReturn(value?.lsneReturn, '') };
}
export const NETWORK = Object.freeze([
  ['english', '올인원 영어 학습실', 'https://english.literstella.co.kr/growth-lab?preview=1&page=invitation'],
  ['diagnosis', '3분 영어 진단', 'https://read.literstella.co.kr/#diagnosis'],
  ['reader', '원서 리더', 'https://challenge.literstella.co.kr/?read=902'],
  ['class', '클래식 원서 강독', 'https://class-new.literstella.co.kr/classes'],
  ['challenge', '야나완 챌린지', 'https://challenge.literstella.co.kr/'],
  ['diary', '원서 다이어리', 'https://challenge.literstella.co.kr/?mode=diary'],
  ['lyra', '리딩메이트 Lyra', 'https://challenge.literstella.co.kr/?tool=lyra'],
  ['story', '스토리극장', 'https://class-new.literstella.co.kr/stories'],
  ['sentence', '클래식 영어 한 문장', 'https://challenge.literstella.co.kr/?sentence=archive'],
  ['hp', '해리포터 완독클럽·영어 편지', 'https://challenge.literstella.co.kr/?club=hp'],
  ['timer', '독서 타이머', null],
  ['partner', '나도 영어 원서 강독가', 'https://partner.literstella.co.kr/'],
  ['global', '리터스텔라 글로벌', 'https://global.literstella.com/'],
]);
