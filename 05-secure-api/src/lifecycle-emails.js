// =============================================================
// lifecycle-emails.js — 리터스텔라 라이프사이클 이메일 11종 (Resend 발송용)
//   브랜드 셸(brandEmailShell) + 각 이벤트 body 빌더. index.js에서 import 후
//   sendResendEmail(env, { to, subject, html: renderEmail(key, data) }) 로 발송.
//   금지어(완주·전액기부·도반·대장정·여정) 미사용. 톤=따뜻·비경쟁·응원.
//   배지는 현재 이모지 메달(이메일 안전). 실제 배지 PNG를 public/badge/에 올리면 IMG로 교체 가능.
// =============================================================

const C = {
  bg: '#f4f1ea', card: '#fffdf8', ink: '#1d2433', soft: '#5a5446', muted: '#8a8270',
  gold: '#c8a84b', goldStrong: '#b8932f', accentBg: '#fdf9ee', dash: '#ddca97',
  line: '#efe9da', success: '#3f9b6d', coral: '#f26722',
};

// ── 이메일 카드 본체(로고+본문+푸터, max-width 480) — 미리보기 임베드용으로도 재사용 ──
export function innerCard(bodyHtml) {
  return `<table role="presentation" width="100%" style="max-width:480px;background:${C.card};border-radius:18px;overflow:hidden;border:1px solid #e8e2d4;">`
    + `<tr><td style="padding:26px 32px 8px;text-align:center;"><img src="https://challenge.literstella.co.kr/logo-symbol.png" alt="" width="46" height="46" style="display:inline-block;margin-bottom:6px;" /><br /><img src="https://challenge.literstella.co.kr/logo-literstella-en.png" alt="LiterStella" height="22" style="display:inline-block;" /></td></tr>`
    + `<tr><td style="padding:12px 32px 28px;color:${C.ink};font-size:15px;line-height:1.7;">${bodyHtml}</td></tr>`
    + `<tr><td style="padding:20px 32px;border-top:1px solid ${C.line};background:#faf7ef;text-align:center;font-size:12px;color:${C.muted};">`
    + `<a href="https://read.literstella.co.kr" style="color:${C.gold};text-decoration:none;margin:0 8px;">📖 MY READ TO SPEAK</a>`
    + `<a href="https://challenge.literstella.co.kr" style="color:${C.gold};text-decoration:none;margin:0 8px;">🏆 영어 챌린지 야나완™</a>`
    + `<a href="https://class.literstella.co.kr/classes" style="color:${C.gold};text-decoration:none;margin:0 8px;">🎓 클래식 원서 강독</a>`
    + `<div style="margin-top:12px;color:#b0a892;">© LiterStella · 영어 원서를 끝까지 읽는 습관</div>`
    + `<div style="margin-top:8px;font-size:11px;color:#c2bba8;">{{unsubscribe}}</div>` // 마케팅성 메일 수신거부(법적 필수) — Resend 변수/링크로 치환
    + `</td></tr></table>`;
}

// ── 공통 브랜드 셸 (index.js brandEmailHtml과 동일 골격) ──
export function brandEmailShell(bodyHtml, preheader = '') {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>`
    : '';
  return `<!doctype html><html lang="ko"><body style="margin:0;background:${C.bg};font-family:'Apple SD Gothic Neo',Arial,sans-serif;">${pre}`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:32px 0;"><tr><td align="center">`
    + innerCard(bodyHtml)
    + `</td></tr></table></body></html>`;
}

// ── 배지 이미지 (실제 PNG, public/badge/ 안정 URL — 이모지 메달 미사용, 운영자 2026-06-24) ──
const BADGE_BASE = 'https://challenge.literstella.co.kr/badge/';
const MILESTONE_BADGE = {
  '3일': 'badge_day_003_start.png', '7일': 'badge_day_007_hurdle.png', '10일': 'badge_day_010_routine.png',
  '30일': 'badge_day_030_basic_success.png', '66일': 'badge_day_066_habit_extension.png', '100일': 'badge_day_100_finish.png',
  '완독': 'myenglishbook_finish.png',
};

// ── 재사용 컴포넌트 ──
// 마일스톤 히어로 = 실제 배지 이미지(크게)
const heroBadge = (badgeFile, title, sub) =>
  `<div style="text-align:center;margin:6px 0 16px;">`
  + `<img src="${BADGE_BASE}${badgeFile}" alt="${title}" width="96" height="96" style="display:inline-block;margin-bottom:10px;" />`
  + `<div style="font-size:21px;font-weight:900;color:${C.ink};">${title}</div>`
  + (sub ? `<div style="font-size:14px;color:${C.soft};margin-top:6px;">${sub}</div>` : '')
  + `</div>`;
// 배지 없는 메일(가입·신청·1일·다이어리·Lyra) = 골드 룰 + 텍스트(이모지 없이 깔끔)
const heroText = (title, sub) =>
  `<div style="text-align:center;margin:8px 0 18px;">`
  + `<div style="width:42px;height:3px;background:${C.gold};border-radius:2px;margin:0 auto 14px;"></div>`
  + `<div style="font-size:21px;font-weight:900;color:${C.ink};">${title}</div>`
  + (sub ? `<div style="font-size:14px;color:${C.soft};margin-top:6px;">${sub}</div>` : '')
  + `</div>`;
const pointsChip = (points, label = '적립') => points
  ? `<table role="presentation" width="100%" style="margin:0 0 18px;background:${C.accentBg};border:1px dashed ${C.dash};border-radius:14px;"><tr><td style="padding:13px 18px;text-align:center;font-size:14px;font-weight:800;color:${C.goldStrong};">+${points}P ${label} · 마이페이지에 쌓였어요</td></tr></table>`
  : '';

const statStrip = (rows) =>
  `<table role="presentation" width="100%" style="margin:0 0 18px;border:1px solid ${C.line};border-radius:12px;">`
  + rows.map((r, i) =>
    `<tr${i ? ` style="border-top:1px solid ${C.line};"` : ''}><td style="padding:10px 16px;font-size:13px;color:${C.soft};">${r[0]}</td>`
    + `<td style="padding:10px 16px;font-size:14px;font-weight:800;color:${C.ink};text-align:right;">${r[1]}</td></tr>`).join('')
  + `</table>`;

const cta = (text, url, primary = true) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px auto 14px;"><tr><td align="center" style="border-radius:999px;background:${primary ? C.coral : C.card};border:1px solid ${primary ? C.coral : C.dash};">`
  + `<a href="${url}" style="display:inline-block;padding:13px 30px;font-size:15px;font-weight:800;color:${primary ? '#fff' : C.goldStrong};text-decoration:none;">${text}</a>`
  + `</td></tr></table>`;

const nextChip = (text) =>
  `<div style="text-align:center;margin:0 0 16px;"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:#f3eede;color:${C.goldStrong};font-size:12px;font-weight:800;">${text}</span></div>`;

const shareLine = () =>
  `<p style="text-align:center;font-size:13px;color:${C.muted};margin:8px 0 0;">📣 성공 카드를 친구에게 자랑해보세요 — <a href="https://challenge.literstella.co.kr" style="color:${C.gold};">공유하기</a></p>`;

const reviewLine = (kind) =>
  `<p style="text-align:center;font-size:13px;color:${C.muted};margin:8px 0 0;">✍️ ${kind} 후기를 남기면 다른 도전자에게 큰 힘이 돼요 — <a href="https://challenge.literstella.co.kr" style="color:${C.gold};">후기 쓰기</a></p>`;

const classUpsell = () =>
  `<table role="presentation" width="100%" style="margin:18px 0 4px;background:#f7f2e6;border:1px solid ${C.line};border-radius:12px;"><tr><td style="padding:14px 16px;">`
  + `<div style="font-size:13px;font-weight:800;color:${C.ink};">🎓 한 문장씩 더 깊게, 클래식 원서 강독</div>`
  + `<div style="font-size:12px;color:${C.soft};margin:4px 0 10px;">스텔라쌤이 짚어주는 강독으로 완독이 빨라져요. 야나완 도전자 전용 쿠폰이 기다려요.</div>`
  + `<a href="https://class.literstella.co.kr/classes" style="font-size:12px;font-weight:800;color:${C.goldStrong};text-decoration:none;">강독 클래스 보기 →</a>`
  + `</td></tr></table>`;

const p = (t) => `<p style="margin:0 0 14px;color:${C.soft};">${t}</p>`;

// ── 11종 라이프사이클 정의 ──
//   각 항목: subject(제목), preheader(미리보기), build(data)=>bodyHtml
//   data 변수: nickname, book, goalDays, startDate, points, days, streak, pages, books, badgeName
// Lyra 단계(유대) — helper(기본)→mate→tutor→soul. 업그레이드 시 해당 단계 안내.
// Lyra 4단 진화. from=이전 단계, desc=이제 가능한 것, examples=말 걸어볼 예시(사람들이 단계별 사용법 헷갈림 → 2~3개).
const TELLA_STAGE = {
  mate: {
    name: '메이트', from: '헬퍼', title: 'Lyra가 메이트로 자랐어요',
    desc: '사용법만 안내하던 <b>헬퍼</b>에서, 이제 <b>감성 동행자 메이트</b>로 진화했어요. 오늘 읽은 책과 기분을 나누면 함께 곱씹고 공감해줘요.',
    examples: ['오늘 「해리포터」 30쪽 읽었어 — 기분 너무 좋아!', '이 문장이 마음에 남았어, 같이 곱씹어줄래?', '오늘은 못 읽었어… 다시 힘 낼 수 있게 응원해줘'],
  },
  tutor: {
    name: '튜터', from: '메이트', title: 'Lyra가 튜터가 됐어요',
    desc: '감성 동행을 넘어, 이제 <b>영어 학습 튜터</b>가 됐어요(안경을 썼죠). 막히는 문장·단어를 물어보면 차근히 짚어줘요.',
    examples: ['이 문장 구조가 이해가 안 돼 — 풀어서 설명해줘', '‘keen’이랑 ‘eager’ 뉘앙스 차이 알려줘', '오늘 읽은 부분 요약하고 퀴즈 내줘'],
  },
  soul: {
    name: '소울', from: '튜터', title: 'Lyra가 소울이 됐어요',
    desc: '가장 깊은 단계예요. 이제 <b>나를 닮은 독서 분신 소울</b>로, 내 취향과 흐름을 알아보고 먼저 제안해요.',
    examples: ['내 독서 취향에 맞는 다음 원서 추천해줘', '내 약점 위주로 이번 주 학습 계획 짜줘', '지금까지 내 독서 성장을 돌아봐줘'],
  },
};

export const LIFECYCLE = {
  // 1) 회원가입 완료
  signup: {
    label: '회원가입 완료', kind: 'transactional',
    subject: '🎉 리터스텔라에 오신 걸 환영해요, {{nickname}}님!',
    preheader: '영어 원서를 끝까지 읽는 습관, 오늘부터 함께 시작해요.',
    build: (d) => heroText(`환영해요, ${d.nickname}님!`, '영어 원서를 끝까지 읽는 습관, 여기서 시작돼요.')
      + p('가입을 진심으로 축하해요. 리터스텔라에서는 이렇게 시작할 수 있어요:')
      + statStrip([['📖 무료 독서 진단', '내 레벨·취향 3분 진단'], ['✍️ 나의 서재(다이어리)', '오늘 읽은 한 줄부터 무료로'], ['🏆 영어 챌린지 야나완™', '함께 읽고 인증하는 100일 도전']])
      + cta('무료 독서 진단 받기 (3분)', 'https://read.literstella.co.kr')
      + cta('다이어리에 첫 기록 남기기', 'https://challenge.literstella.co.kr', false),
  },
  // 2) 챌린지 가입 완료
  enroll: {
    label: '챌린지 가입 완료', kind: 'transactional',
    subject: '✅ 영어 챌린지 야나완™ 신청이 완료됐어요!',
    preheader: '내일부터 하루 3페이지, 함께 읽어요.',
    build: (d) => heroText('신청이 완료됐어요!', `${d.nickname}님, 이제 함께 읽을 준비가 끝났어요.`)
      + statStrip([['선택한 원서', d.book], ['도전 기간', `${d.goalDays}일`], ['시작일', d.startDate]])
      + p('<b>진행 방식</b><br>① 매일 정한 분량을 읽고 → ② 네이버 카페에 인증글을 남기고 → ③ 앱에서 인증 버튼을 눌러요. 그게 전부예요.')
      + nextChip('🌱 오늘 첫 인증이면 「작심 3일」까지 D-3')
      + cta('오늘 첫 인증하기', 'https://challenge.literstella.co.kr')
      + `<p style="font-size:12px;color:${C.muted};margin:0;">결제·참가비 안내가 필요하면 앱 푸터의 「참가 신청·결제」에서 확인할 수 있어요.</p>`,
  },
  // 3) Day 1
  day1: {
    label: '챌린지 1일 인증', kind: 'info',
    subject: '🌱 첫 인증 완료! 시작이 반이에요, {{nickname}}님',
    preheader: '오늘의 한 걸음이 100일을 만들어요.',
    build: (d) => heroText('첫 인증 완료!', '가장 어려운 한 걸음을 이미 떼셨어요.')
      + p(`${d.nickname}님, 「${d.book}」 1일차 인증을 축하해요. 처음이니 인증 방법을 짧게 안내해 드릴게요.`)
      + p('<b>📌 이렇게 인증해요</b>')
      + statStrip([['① 읽기', '오늘 정한 분량을 읽어요'], ['② 카페 인증', '네이버 카페에 인증글을 남겨요'], ['③ 앱 인증', '앱에서 인증 버튼을 눌러요']])
      + nextChip('🔥 「작심 3일」 배지까지 D-2')
      + cta('내일도 이어가기', 'https://challenge.literstella.co.kr')
      + shareLine(),
  },
  // 4) Day 3 — 작심 3일 돌파(심리적 분기점)
  day3: {
    label: '챌린지 3일 인증', kind: 'info',
    subject: '🔥 작심 3일, 보란 듯이 넘었어요!',
    preheader: '대부분 여기서 멈춰요. 당신은 넘었고요.',
    build: (d) => heroBadge(MILESTONE_BADGE['3일'], '작심 3일 돌파!', '많은 사람이 멈추는 그 고비를 넘었어요.')
      + pointsChip(d.points)
      + p(`${d.nickname}님, 3일 연속 인증은 결코 우연이 아니에요. 이제 루틴이 만들어지기 시작했어요.`)
      + nextChip('💪 「7일 성공」까지 D-4')
      + cta('계속 이어가기', 'https://challenge.literstella.co.kr')
      + shareLine(),
  },
  // 5) Day 7
  day7: {
    label: '챌린지 7일 인증', kind: 'info',
    subject: '💪 일주일 성공! 루틴이 잡히고 있어요',
    preheader: '7일은 습관의 첫 신호예요.',
    build: (d) => heroBadge(MILESTONE_BADGE['7일'], '7일 성공!', '일주일을 채웠어요. 루틴이 자리잡는 중이에요.')
      + pointsChip(d.points)
      + statStrip([['연속 인증', `${d.streak}일`], ['읽은 분량', `${d.pages}쪽`]])
      + nextChip('✨ 「10일 성공」까지 D-3')
      + cta('오늘도 인증하기', 'https://challenge.literstella.co.kr')
      + reviewLine('한 줄'),
  },
  // 6) Day 10
  day10: {
    label: '챌린지 10일 인증', kind: 'info',
    subject: '✨ 10일 성공! 이제 안 읽으면 허전하죠',
    preheader: '두 자릿수 성공, 진짜 독서가의 시작이에요.',
    build: (d) => heroBadge(MILESTONE_BADGE['10일'], '10일 성공!', '이제 원서 읽기가 하루 일과가 되어가요.')
      + pointsChip(d.points)
      + statStrip([['연속 인증', `${d.streak}일`], ['읽은 분량', `${d.pages}쪽`]])
      + nextChip('🏅 다음 목표 「30일 성공」')
      + cta('계속 도전하기', 'https://challenge.literstella.co.kr')
      + reviewLine('한 줄'),
  },
  // 7) Day 30
  day30: {
    label: '챌린지 30일 인증', kind: 'info',
    subject: '🏅 30일 성공! 한 달을 온전히 채웠어요',
    preheader: '한 달의 꾸준함, 정말 대단해요.',
    build: (d) => heroBadge(MILESTONE_BADGE['30일'], '30일 성공!', `${d.nickname}님, 한 달을 채운 당신이 자랑스러워요.`)
      + pointsChip(d.points)
      + statStrip([['연속 인증', `${d.streak}일`], ['읽은 분량', `${d.pages}쪽`], ['읽고 있는 원서', d.book]])
      + nextChip('🧠 「66일 성공」까지 함께 가요')
      + cta('66일까지 이어가기', 'https://challenge.literstella.co.kr')
      + reviewLine('카페 인증'),
  },
  // 8) Day 66
  day66: {
    label: '챌린지 66일 인증', kind: 'info',
    subject: '🧠 66일 — 뇌과학이 말하는 ‘습관 완성’',
    preheader: '습관이 만들어지는 평균 일수, 당신이 증명했어요.',
    build: (d) => heroBadge(MILESTONE_BADGE['66일'], '66일 성공!', '습관이 완성된다는 그 66일을 해냈어요.')
      + pointsChip(d.points)
      + statStrip([['연속 인증', `${d.streak}일`], ['읽은 분량', `${d.pages}쪽`]])
      + nextChip('🏆 「100일 성공」까지 D-34')
      + cta('100일을 향해 가기', 'https://challenge.literstella.co.kr')
      + reviewLine('카페 인증'),
  },
  // 9) Day 100 — 정점
  day100: {
    label: '챌린지 100일 인증', kind: 'info',
    subject: '🏆 100일 성공! 당신은 해냈습니다, {{nickname}}님',
    preheader: '성공의 전당에 이름을 올렸어요.',
    build: (d) => heroBadge(MILESTONE_BADGE['100일'], '100일 성공!', '끝까지 읽어낸 당신, 정말 멋져요.')
      + pointsChip(d.points)
      + statStrip([['총 인증', `${d.days}일`], ['읽은 분량', `${d.pages}쪽`], ['완독한 원서', `${d.books}권`]])
      + p('🎖️ <b>성공의 전당</b>에 이름이 등재됐어요. 이건 평생 남는 기록이에요.')
      + cta('성공의 전당에서 확인하기', 'https://challenge.literstella.co.kr')
      + reviewLine('카페 인증')
      + classUpsell(),
  },
  // 10) 원서 완독
  finish: {
    label: '원서 완독 인증', kind: 'info',
    subject: '📖 완독을 축하해요! 「{{book}}」 한 권을 끝까지',
    preheader: '나의 완독 서재에 한 권이 더 꽂혔어요.',
    build: (d) => heroBadge(MILESTONE_BADGE['완독'], '완독을 축하해요!', `${d.nickname}님, 「${d.book}」를 끝까지 읽어냈어요.`)
      + pointsChip(d.points, '완독 적립')
      + p('📚 <b>나의 완독 서재</b>에 이 책이 추가됐어요. 책장이 한 권씩 채워지는 걸 지켜보는 재미가 시작돼요.')
      + cta('완독 서재 보기', 'https://challenge.literstella.co.kr')
      + reviewLine('카페 완독')
      + classUpsell(),
  },
  // 11) 다이어리 첫 기록
  diaryFirst: {
    label: '다이어리 첫 기록', kind: 'info',
    subject: '✍️ 첫 기록을 남겼어요! 나의 서재가 시작됐어요',
    preheader: '오늘의 한 줄이 나만의 독서 역사가 돼요.',
    build: (d) => heroText('첫 기록 완료!', '나만의 독서 서재가 막 열렸어요.')
      + p(`${d.nickname}님, 첫 다이어리 기록을 축하해요. 처음이니 기록하는 법을 짧게 안내해 드릴게요.`)
      + p('<b>📌 이렇게 기록해요</b>')
      + statStrip([['① 책·분량', '오늘 읽은 원서와 분량을 골라요'], ['② 문장·기분', '마음에 남은 문장과 그날의 기분을 적어요'], ['③ 저장', '저장하면 서재에 차곡차곡 쌓여요']])
      + p('이렇게 모인 기록은 나만의 <b>문장첩 · 무드 달력 · 완독 책장</b>이 돼요.')
      + nextChip('🤝 함께 읽으면 더 오래 가요')
      + cta('오늘 또 기록하기', 'https://challenge.literstella.co.kr')
      + cta('영어 챌린지 야나완™ 둘러보기', 'https://challenge.literstella.co.kr', false),
  },
  // 12) Lyra 단계 업그레이드 (유대 단계 상승 — helper→mate→tutor→soul)
  tellaUpgrade: {
    label: 'Lyra 단계 업그레이드', kind: 'info',
    subject: '✨ Lyra가 {{stageName}}로 한 단계 자랐어요!',
    preheader: '함께 읽은 만큼 Lyra와의 사이가 깊어졌어요.',
    build: (d) => {
      const s = TELLA_STAGE[d.toStage] || TELLA_STAGE.mate;
      const img = `https://challenge.literstella.co.kr/tella/${d.toStage || 'mate'}.png`;
      const examples = `<table role="presentation" width="100%" style="margin:0 0 16px;background:${C.accentBg};border:1px solid ${C.dash};border-radius:14px;"><tr><td style="padding:14px 16px;">`
        + `<div style="font-size:13px;font-weight:800;color:${C.ink};margin-bottom:8px;">💬 이렇게 말 걸어보세요</div>`
        + s.examples.map((ex, i) => `<div style="font-size:13px;color:${C.soft};padding:7px 0;${i ? `border-top:1px solid ${C.line};` : ''}">“${ex}”</div>`).join('')
        + `</td></tr></table>`;
      return `<div style="text-align:center;margin:2px 0 6px;"><img src="${img}" alt="Lyra ${s.name}" width="120" height="150" style="display:inline-block;" /></div>`
        + heroText(s.title, `${d.nickname}님과 함께 읽은 시간이 Lyra를 키웠어요.`)
        + `<p style="text-align:center;margin:0 0 14px;font-size:15px;font-weight:800;color:${C.goldStrong};">${s.from} → ${s.name} 단계로 진화했어요! ✨</p>`
        + p(s.desc)
        + statStrip([['지금 Lyra 단계', s.name], ['함께한 인증', `${d.days}일`], ['친밀도', `${d.intimacy}점`]])
        + examples
        + nextChip('💛 더 자주 함께 읽을수록 Lyra도 함께 자라요')
        + cta('Lyra 만나러 가기', 'https://challenge.literstella.co.kr/?tella=1');
    },
  },
  // 14) 마일스톤 AI 성장 리포트 준비됨 (30/66/100 성공 축하 선물 리마인더)
  milestoneReport: {
    label: '성장 리포트 준비됨', kind: 'info',
    subject: '🎁 {{nickname}}님의 {{milestone}}일 성장 리포트가 준비됐어요!',
    preheader: '몇 가지만 답하면 Lyra가 나만의 AI 리포트를 써줘요.',
    build: (d) => heroText(`${d.milestone}일 성공 축하 선물 🎁`, `${d.nickname}님만을 위한 AI 성장 리포트가 기다려요.`)
      + p(`${d.milestone}일을 해낸 ${d.nickname}님, 정말 멋져요. Lyra가 그동안의 기록을 분석했어요.`)
      + p('앱에서 <b>몇 가지 질문에 답하면</b>, 처음과 지금이 어떻게 달라졌는지 <b>나만의 AI 성장 리포트</b>를 받을 수 있어요. (무료 선물이에요)')
      + cta('내 성장 리포트 받기', 'https://challenge.literstella.co.kr'),
  },
  // 15) Lyra 첫 채팅 (사용법 안내)
  tellaFirstChat: {
    label: 'Lyra 첫 채팅(사용법)', kind: 'info',
    subject: '🤖 리딩메이트 Lyra예요 — 이렇게 함께해요!',
    preheader: '궁금한 건 언제든 Lyra에게 물어보세요.',
    build: (d) => heroText('Lyra와 처음 만났어요!', `${d.nickname}님, 앞으로 함께 읽을 리딩메이트예요.`)
      + p('저는 <b>Lyra</b>예요. 리터스텔라를 함께 쓰는 독서 도우미죠. 이렇게 활용해요:')
      + statStrip([['💬 무엇이든 질문', '사용법·원서·인증 방법을 물어보세요'], ['📖 다이어리 동행', '오늘 읽은 책과 기분을 함께 나눠요'], ['🔔 알림 허브', '배지·완독·답변 소식을 모아 전해요']])
      + p('함께 읽을수록 저도 <b>메이트 → 튜터 → 소울</b>로 자라요. 자주 만나요!')
      + cta('Lyra와 대화하기', 'https://challenge.literstella.co.kr/?tella=1'),
  },
};

// ── 발송용 렌더러 ──
export function renderEmail(key, data = {}) {
  const t = LIFECYCLE[key];
  if (!t) throw new Error('unknown email: ' + key);
  // Lyra 단계명은 항상 표준값으로 정규화(제목 {{stageName}} 깨짐·전달 누락 방지).
  if (key === 'tellaUpgrade' && TELLA_STAGE[data.toStage]) data = { ...data, stageName: TELLA_STAGE[data.toStage].name };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (data[k] != null ? data[k] : ''));
  return {
    subject: fill(t.subject),
    html: brandEmailShell(t.build(data), fill(t.preheader)),
    kind: t.kind,
  };
}
