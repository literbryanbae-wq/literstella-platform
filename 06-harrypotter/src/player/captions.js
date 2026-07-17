// 싱크 자막 로더 — 원어 전사 + 번역 사이드카를 합쳐 PodcastStage에 넘길 배열을 만든다.
//
// 계약(강독 dll-N.tr.json과 동일 — 표면마다 다시 정하지 말 것):
//   원어: `${base}.transcript.json`     = { transcript: [{ start, end, lang, text }] }
//   번역: `${base}.transcript.tr.json`  = { "<lang>": { "<segIndex>": "번역문" }, "_note": … }
//          · 인덱스는 원어 transcript 배열과 1:1  · _로 시작하는 키는 메타(무시)
//          · 번역 없는 조각은 그대로 → 무대가 원문으로 폴백
//   합친 결과: [{ …seg, tr: { en: "…" } }] → PodcastStage가 원어/영어/동시 토글을 자동 노출.
//
// 두 파일 모두 없어도 무해(자막 UI 자체가 숨겨짐) — 회차가 늘어도 코드 수정 없이 파일만 올리면 켜진다.

const getJson = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);

// ── 표시용 끊어 읽기 ────────────────────────────────────────────────────────
// 전사(ASR) 조각은 '문단' 단위다(최대 239자·42초 실측) — 그대로 띄우면 무대 밖으로 넘쳐 뒷줄이 잘린다.
// 자막 표준(2줄·수 초)에 맞춰 화면에서만 쪼갠다. 원본 전사·번역 파일은 손대지 않는다:
//   · 재분할을 데이터 쪽에서 하면 번역 사이드카의 인덱스 1:1 계약이 깨져 24편 재번역이 필요해진다.
//   · 표시 단위는 원래 플레이어 책임 → 여기서 처리하면 모든 표면(강독·스토리·한 문장·HP)이 한 번에 고쳐진다.
// 시간은 글자 수 비례로 나눈다(ASR 워드 타임스탬프가 없으므로 이게 최선의 근사).
const KO_MAX = 46;   // 한국어 ≈ 2줄
const EN_MAX = 90;   // 영어 ≈ 2줄

function chunkText(text, max) {
  const src = String(text || '').trim();
  if (!src) return [];
  if (src.length <= max) return [src];
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const sent of src.split(/(?<=[.!?…。？！])\s+/)) {
    if (!sent) continue;
    if (buf && (`${buf} ${sent}`).length <= max) { buf = `${buf} ${sent}`; continue; }
    flush();
    if (sent.length <= max) { buf = sent; continue; }
    let line = '';                                   // 문장 하나가 max 초과 → 어절 그리디 줄바꿈
    for (const w of sent.split(/\s+/)) {
      if (line && (`${line} ${w}`).length > max) { out.push(line); line = w; }
      else line = line ? `${line} ${w}` : w;
    }
    buf = line;
  }
  flush();
  return out.length ? out : [src];
}

// 번역을 원어 칸의 '경계'에 맞춰 나눈다(어절 단위). 번역을 따로 90자로 쪼개 중간점 부착하면
// 원어 칸과 최대 한 칸씩 어긋나 동시 자막에서 위(한국어)·아래(영어)가 다른 문장을 가리켰다 → 경계 분할로 락스텝 정렬.
// 각 어절을 그 어절 '중간 위치(0~1)'가 걸치는 칸에 넣으므로 유실·중복 0, 원어 칸 수와 무관하게 항상 정렬.
function sliceByBounds(text, bounds) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return bounds.map(() => '');
  const totalChars = words.reduce((n, w) => n + w.length, 0) || 1;
  let acc = 0;
  const mids = words.map((w) => { const m = (acc + w.length / 2) / totalChars; acc += w.length; return m; });
  return bounds.map(([a, b], i) => {
    const last = i === bounds.length - 1;
    return words.filter((_, wi) => mids[wi] >= a && (last || mids[wi] < b)).join(' ');
  });
}

function splitSeg(seg) {
  const max = seg.lang === 'en' ? EN_MAX : KO_MAX;
  const parts = chunkText(seg.text, max);
  if (parts.length <= 1) return [seg];               // 이미 짧으면 그대로(번역도 그대로 유지)
  const span = Math.max(0.001, (seg.end ?? seg.start) - seg.start);
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let acc = 0;
  const subs = parts.map((p) => {
    const a = acc / total; acc += p.length; const b = acc / total;
    return { start: seg.start + a * span, end: seg.start + b * span, lang: seg.lang, text: p, _a: a, _b: b };
  });
  // 번역을 원어 칸 경계 [_a,_b)로 분할해 같은 인덱스 칸에 부착 → 위/아래 락스텝(유실 0).
  const bounds = subs.map((s) => [s._a, s._b]);
  for (const L of Object.keys(seg.tr || {})) {
    const slices = sliceByBounds(seg.tr[L], bounds);
    subs.forEach((s, i) => { if (slices[i]) { s.tr = s.tr || {}; s.tr[L] = slices[i]; } });
  }
  return subs.map(({ _a, _b, ...s }) => s);
}

// 브랜드명 표시 정규화 — ASR 아웃트로 자막이 정본 'LiterStella'를 'LITTERSTELLA/Litter Stella'로 오전사한다
// ('litter=쓰레기'로 오독). 원어 전사 파일(전사 세션 소유·en 세그라 번역 사이드카 밖)은 무수정으로 두고
// 표시 시점에만 정본 철자로 치환한다 — 자막의 모든 표면(강독·스토리·한 문장·HP)에 일괄 적용. 되돌리기=이 함수 제거.
const normalizeBrand = (s) => (typeof s === 'string' ? s.replace(/litter\s*stella/gi, 'LiterStella') : s);
function normalizeSeg(seg) {
  const text = normalizeBrand(seg.text);
  let tr = seg.tr;
  if (tr) { const nt = {}; for (const k of Object.keys(tr)) nt[k] = normalizeBrand(tr[k]); tr = nt; }
  return text === seg.text && tr === seg.tr ? seg : { ...seg, text, ...(tr ? { tr } : {}) };
}

// ── 얼어붙는 자막 방지 ───────────────────────────────────────────────────────
// ASR이 끝시각을 침묵/음악 구간까지 늘려 찍으면(실측: 13자짜리가 30초 점유) 짧은 자막이 화면에 얼어붙는다.
// 원어 전사(전사 세션 소유)는 무수정으로 두고, '읽는 시간(글자수×RATE+버퍼)'보다 GRACE초 이상 오래
// 남을 자막만 그 시점에 화면에서 지운다(그 뒤 다음 큐까지 자막 없음 = 말 안 하는 구간엔 자막 없음, 정직).
// 자연스러운 1~3초 말미 침묵은 GRACE로 보호 → 정상 자막은 안 건드린다.
const CAP_RATE = 0.16;   // 초/글자(넉넉히 ~6자/초)
const CAP_BUF = 1.5;     // 마무리 여유
const CAP_GRACE = 5;     // 이 이상 초과해 남을 때만 개입
function hideAtOf(seg) {
  const dur = (seg.end ?? seg.start) - seg.start;
  const show = (seg.text ? seg.text.length : 0) * CAP_RATE + CAP_BUF;
  return dur - show > CAP_GRACE ? seg.start + show : (seg.end ?? seg.start);
}

export function splitForDisplay(transcript) {
  if (!Array.isArray(transcript) || !transcript.length) return transcript;
  return transcript.map(normalizeSeg).flatMap(splitSeg).map((s) => ({ ...s, hideAt: hideAtOf(s) }));
}

// 지금 시각(t)에 표시할 자막 조각. 없거나 '얼어붙음 컷' 이후면 null(자막 비움) — 무대 nowLine 단일 소스.
export function activeCaption(caps, t) {
  if (!Array.isArray(caps) || !caps.length) return null;
  let cur = null;
  for (const seg of caps) { if (t >= seg.start - 0.15) cur = seg; else break; }
  if (cur && cur.hideAt != null && t > cur.hideAt) return null;
  return cur;
}

export function mergeCapTr(transcript, tr) {
  if (!Array.isArray(transcript) || !transcript.length) return null;
  const langs = Object.keys(tr || {}).filter(k => !k.startsWith('_'));
  if (!langs.length) return transcript;
  return transcript.map((seg, i) => {
    const m = {};
    for (const lang of langs) {
      const src = tr[lang];
      const v = Array.isArray(src) ? src[i] : (src?.[i] ?? src?.[String(i)]);
      if (v) m[lang] = v;
    }
    return Object.keys(m).length ? { ...seg, tr: m } : seg;
  });
}

// base = 확장자 뺀 경로. 예: '/stella/sentence/kidari-1', '/hp1/day-1'
export async function loadCaptions(base) {
  const [orig, tr] = await Promise.all([
    getJson(`${base}.transcript.json`),
    getJson(`${base}.transcript.tr.json`),
  ]);
  const segs = Array.isArray(orig?.transcript) ? orig.transcript : null;
  return segs ? mergeCapTr(segs, tr) : null;
}
