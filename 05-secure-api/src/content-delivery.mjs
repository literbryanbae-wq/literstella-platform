const SETTINGS_URL = "https://challenge.literstella.co.kr/?view=settings";

export const CONTENT_AUDIENCE_TABLES = Object.freeze({
  lecture: "lecture_subscribers",
  hp: "hp_subscribers",
});

export const CONTENT_LINK_ORIGINS = Object.freeze([
  "https://challenge.literstella.co.kr",
  "https://read.literstella.co.kr",
  "https://class-new.literstella.co.kr",
  "https://class.literstella.co.kr",
]);

const HP1_DRAFTS = {
  "hp1-day06": {
    audience: "hp",
    kicker: "호그와트 편지 · 발행 전 검수",
    title: "Day 06 · p.16-18",
    book: "Harry Potter and the Sorcerer's Stone",
    teaser: "사진 속에 없는 아이의 아침은 어디에서 시작될까요?",
  },
  "hp1-day07": {
    audience: "hp",
    kicker: "호그와트 편지 · 발행 전 검수",
    title: "Day 07 · p.19-21",
    book: "Harry Potter and the Sorcerer's Stone",
    teaser: "예정에 없던 동행이 생기자 가족의 속마음은 어떻게 드러날까요?",
  },
  "hp1-day08": {
    audience: "hp",
    kicker: "호그와트 편지 · 발행 전 검수",
    title: "Day 08 · p.22-24",
    book: "Harry Potter and the Sorcerer's Stone",
    teaser: "평범해 보이던 동물원에서 무엇이 먼저 해리에게 반응할까요?",
  },
  "hp1-day09": {
    audience: "hp",
    kicker: "호그와트 편지 · 발행 전 검수",
    title: "Day 09 · p.25-27",
    book: "Harry Potter and the Sorcerer's Stone",
    teaser: "유리 너머의 눈맞춤은 실제 대화로 이어질 수 있을까요?",
  },
  "hp1-day10": {
    audience: "hp",
    kicker: "호그와트 편지 · 발행 전 검수",
    title: "Day 10 · p.28-30",
    book: "Harry Potter and the Sorcerer's Stone",
    teaser: "해리에게 온 첫 편지는 평범한 집의 규칙을 어떻게 흔들까요?",
  },
};

export const CONTENT_DELIVERY_DRAFTS = Object.freeze(Object.fromEntries(
  Object.entries(HP1_DRAFTS).map(([contentId, draft]) => [contentId, Object.freeze({
    contentId,
    ...draft,
    releaseStatus: "RELEASE_QA_BLOCKED",
    link: null,
    media: Object.freeze({ imageUrl: null, audioUrl: null }),
  })]),
));

export function getContentDeliveryDraft(contentId) {
  return CONTENT_DELIVERY_DRAFTS[String(contentId || "").trim()] || null;
}

export function isAllowedContentLink(link) {
  const value = String(link || "").trim();
  return CONTENT_LINK_ORIGINS.some((origin) => value.startsWith(`${origin}/`) || value.startsWith(`${origin}?`));
}

function escHtml(value) {
  return String(value || "").replace(/[<>&"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "\"": "&quot;",
  }[char]));
}

function safeHttpsUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 1000) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function contentEmailBodyHtml(content) {
  const media = content?.media && typeof content.media === "object" ? content.media : {};
  const imageUrl = safeHttpsUrl(media.imageUrl);
  const audioUrl = safeHttpsUrl(media.audioUrl);
  const link = isAllowedContentLink(content?.link) ? String(content.link).trim() : null;
  const body = `<div style="font-size:11px;letter-spacing:2px;color:#c8a84b;font-weight:800;margin-bottom:6px;">${escHtml(content?.kicker || "새 콘텐츠가 올라왔어요")}</div>`
    + `<div style="font-size:17px;font-weight:800;margin-bottom:6px;">${escHtml(content?.title || "")}</div>`
    + (content?.book ? `<div style="font-size:13px;color:#8a8270;margin-bottom:14px;">${escHtml(content.book)}</div>` : "")
    + (imageUrl ? `<div data-content-media="image" style="margin:0 0 16px;text-align:center;"><img src="${escHtml(imageUrl)}" alt="" style="display:block;width:100%;height:auto;border-radius:12px;" /></div>` : "")
    + (content?.teaser ? `<p style="margin:0 0 20px;color:#5a5446;font-size:14px;line-height:1.7;">${escHtml(content.teaser)}</p>` : "")
    + (audioUrl ? `<p data-content-media="audio" style="margin:0 0 16px;text-align:center;"><a href="${escHtml(audioUrl)}" style="color:#7a5a21;">오디오 듣기</a></p>` : "")
    + (link
      ? `<div style="text-align:center;margin:8px 0 4px;"><a href="${escHtml(link)}" style="display:inline-block;background:#c8a84b;color:#20160a;font-weight:800;text-decoration:none;padding:13px 26px;border-radius:12px;font-size:14px;">지금 보러 가기 →</a></div>`
      : `<p data-release-preview="blocked" style="margin:16px 0 0;padding:10px 12px;background:#faf7ef;color:#8a8270;font-size:12px;text-align:center;border-radius:10px;">발행 전 검수 중인 관리자 미리보기입니다.</p>`)
    + `<p style="margin:16px 0 0;font-size:12px;color:#8a8270;text-align:center;">전체 내용은 페이지에서 만나요.</p>`
    + `<p style="margin:10px 0 0;font-size:12px;color:#8a8270;text-align:center;"><a href="${SETTINGS_URL}" style="color:#8a8270;text-decoration:underline;">수신 설정 · 구독 해지</a></p>`;
  return body;
}

