// langRuns — 자막 문장을 한/영 '런'으로 분해(스크린리더 lang 전환·영문 이탤릭). 챌린지 TranscriptPanel에서 발췌(동일 로직).
const EN_RUN = /[A-Za-z][A-Za-z0-9'’\-]*(?:[ ,]+[A-Za-z][A-Za-z0-9'’\-]*)*/g;

export function langRuns(text, segLang) {
  if (!text) return [];
  if (segLang === 'en') return [{ lang: 'en', t: text }];
  const out = [];
  let last = 0;
  for (const m of text.matchAll(EN_RUN)) {
    // 한 글자짜리 라틴(A, I …)은 영어 런으로 보지 않는다 — 오히려 잘못 끊긴다.
    if (m[0].replace(/[^A-Za-z]/g, '').length < 2) continue;
    if (m.index > last) out.push({ lang: 'ko', t: text.slice(last, m.index) });
    out.push({ lang: 'en', t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ lang: 'ko', t: text.slice(last) });
  return out.length ? out : [{ lang: segLang || 'ko', t: text }];
}
