// =============================================================
// A11yGuideChip — 시각(화면낭독기)·청각(자막·전사) 이용 안내 칩 + SrIntro(낭독 전용 안내)
//   🔴 "시각장애인은 처음에 어떻게 인지하나?"의 답: 웹은 화면낭독기 사용을 감지할 수 없다(브라우저 프라이버시 표준).
//   → 감지 대신 '낭독 순서'에 심는다: <SrIntro>(시각적으로 숨김)를 기능 콘텐츠 맨 앞에 두면
//     기능을 여는 즉시 낭독기가 먼저 읽어준다. 보이는 칩은 청각장애인·일반 사용자의 발견용.
//   내용은 실제 지원 기능과 일치시킬 것(PodcastStage: 스페이스 재생·←→±5초·↑↓±10초·모바일 더블탭 ±10초 /
//   자막 원어·영어 토글 / TranscriptPanel 전사 / 한 문장·HP=전문 텍스트 대체). 허위 안내 금지.
//   자체 테마 표면(HP 버건디 등)은 colors 오버라이드 {text,muted,surface,line} — SatisfactionSurvey 패턴.
// =============================================================
import { useState, useEffect, useRef } from 'react';
import { Accessibility, ChevronDown, Volume2, Square, X } from 'lucide-react';

// 낭독기 전용(화면 비표시) — 다이얼로그/콘텐츠 맨 앞에 두면 진입 직후 읽힘
export function SrIntro({ text }) {
  return (
    <span style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}>
      {text}
    </span>
  );
}

// 프리셋 — 기능별 실지원 안내(시각=낭독기/키보드 · 청각=자막/전문 읽기)
const PRESETS = {
  lecture: {
    intro: '이 강독은 앞이 잘 안 보이는 분(화면낭독기·키보드)과 소리를 못 듣는 분(자막·전문 읽기)이 모두 이용할 수 있게 만들었어요.',
    sr: '화면낭독기 안내: 이 강독은 키보드로 조작할 수 있어요. 스페이스는 재생과 멈춤, 좌우 화살표는 5초 이동, 위아래 화살표는 10초 이동이에요. 낭독 스크립트를 펼치면 강의 전체를 글로 읽을 수 있어요.',
    vision: ['스페이스 = 재생·멈춤, ←→ = 5초 이동, ↑↓ = 10초 이동 (PC)', '모바일은 화면 가운데 탭 = 재생·멈춤, 좌우 더블탭 = 10초 이동', "'낭독 스크립트'를 펼치면 강의 전체를 낭독기가 문장 단위로 읽어줘요"],
    hearing: ['자막 버튼으로 자막을 켜고, 원어 · 영어를 바꿀 수 있어요', "'강의 노트'와 '원문 함께 보기'로 소리 없이 전체 내용을 읽을 수 있어요"],
  },
  story: {
    intro: '이 이야기 극장은 앞이 잘 안 보이는 분(화면낭독기·키보드)과 소리를 못 듣는 분(자막·전문 읽기)이 모두 즐길 수 있게 만들었어요.',
    sr: '화면낭독기 안내: 스페이스는 재생과 멈춤, 좌우 화살표는 5초 이동이에요. 낭독 스크립트를 펼치면 이야기 전체를 글로 읽을 수 있어요.',
    vision: ['스페이스 = 재생·멈춤, ←→ = 5초 이동 (PC)', '모바일은 가운데 탭 = 재생·멈춤, 좌우 더블탭 = 10초 이동, 맨 가장자리 탭 = 이전·다음 화', "'낭독 스크립트'를 펼치면 이야기 전체를 낭독기가 읽어줘요"],
    hearing: ['자막이 기본으로 나와요 — 원어 · 영어 · 동시 표시를 바꿀 수 있어요', "'낭독 스크립트'로 소리 없이 이야기 전체를 읽을 수 있어요"],
  },
  sentence: {
    intro: '이 한 문장 코너는 앞이 잘 안 보이는 분(화면낭독기)과 소리를 못 듣는 분(전문 읽기)이 모두 이용할 수 있게 만들었어요.',
    sr: '화면낭독기 안내: 재생 버튼으로 스텔라의 3분 낭독을 들을 수 있어요. 오디오 아래에 오늘의 문장과 해설 전문이 글로 있어서, 낭독기로 전부 읽을 수 있어요.',
    vision: ['재생 버튼과 이동 버튼에 전부 음성 라벨이 있어요', '오디오가 어려우면 아래 문장 · 해설 전문을 낭독기로 읽어도 같은 내용이에요'],
    hearing: ["이 오디오는 자막이 없는 대신, '문장 읽기'와 '1분 에세이' 전문이 항상 글로 열려 있어요", '오늘의 문장 · 해석 · 해설 전부 소리 없이 읽을 수 있어요'],
  },
  hp: {
    intro: '이 완독 클럽은 앞이 잘 안 보이는 분(화면낭독기)과 소리를 못 듣는 분(자막·전문 읽기)이 모두 이용할 수 있게 만들었어요.',
    sr: '화면낭독기 안내: 각 하루치는 글과 오디오로 되어 있어요. 이야기 요약, 오늘의 한 문장, 워크북 단어가 전부 글이라 낭독기로 읽을 수 있고, 3분 낭독은 재생 버튼으로 들을 수 있어요.',
    vision: ['하루치 내용(이야기 · 한 문장 · 단어)이 전부 글이라 낭독기로 읽을 수 있어요', '3분 낭독은 재생 버튼으로 — 버튼에 음성 라벨이 있어요'],
    hearing: ['강독 영상은 유튜브 자막(설정 → 자막)을 켤 수 있어요', '이야기 요약 · 한 문장 · 에세이가 전부 글이라 소리 없이 읽어도 같은 내용이에요'],
  },
};

// iconOnly=true → 상단 헤더용 '아이콘만' 버튼(공간 절약, 편지 아이콘 옆). 클릭하면 상세 팝업(모달) — 시각·청각 대상 모두 이해하도록 + 🔊 들어주기(TTS).
export default function A11yGuideChip({ preset = 'lecture', colors = {}, style = {}, iconOnly = false }) {
  const p = PRESETS[preset] || PRESETS.lecture;
  const [open, setOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const C = {
    text: colors.text || 'var(--ls-text)',
    muted: colors.muted || 'var(--ls-muted)',
    surface: colors.surface || 'var(--ls-surface-2, rgba(255,255,255,0.04))',
    line: colors.line || 'var(--ls-line-soft)',
  };
  // 🔊 안내 듣기 — **스텔라 목소리로 미리 녹음한 안내**(R2 a11y/{preset}.mp3)를 재생한다.
  //   구 구현은 브라우저 speechSynthesis로 불릿을 그대로 읽어 기계음·이질감이 컸다(운영자 2026-07-21).
  //   🔴 브라우저 음성은 **폴백으로 남긴다** — 녹음이 못 열리는 상황(네트워크·차단)에서 안내가 끊기면
  //      정작 이 기능이 필요한 사용자가 아무것도 못 듣게 된다. 접근성 기능은 무음보다 기계음이 낫다.
  //   대본 원본 = E:\LiterStella_전사\_a11y\{preset}.json (실제 지원 기능과 1:1 — 바꾸면 음성도 재생성할 것)
  const A11Y_AUDIO = `https://pub-f4c490e22e384c7e9b95fc9648cb5f4c.r2.dev/a11y/${preset}.mp3`;
  const fullText = `${p.intro} 화면낭독기로 이용하는 방법. ${p.vision.join('. ')}. 소리 없이 읽는 방법. ${p.hearing.join('. ')}.`;
  const audioRef = useRef(null);
  const speakFallback = () => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(fullText); u.lang = 'ko-KR'; u.rate = 0.98;
      const ko = window.speechSynthesis.getVoices().find(v => /^ko/i.test(v.lang)); if (ko) u.voice = ko;
      u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u); setSpeaking(true);
    } catch (_e) { setSpeaking(false); }
  };
  const stopSpeak = () => {
    try { const a = audioRef.current; if (a) { a.pause(); a.currentTime = 0; } } catch (_e) { /* noop */ }
    try { window.speechSynthesis.cancel(); } catch (_e) { /* noop */ }
    setSpeaking(false);
  };
  const toggleSpeak = () => {
    if (speaking) { stopSpeak(); return; }
    try { window.speechSynthesis.cancel(); } catch (_e) { /* noop */ }
    try {
      const a = audioRef.current || new Audio(A11Y_AUDIO);
      audioRef.current = a;
      a.onended = () => setSpeaking(false);
      a.onerror = () => speakFallback();          // 녹음 실패 → 브라우저 음성으로 이어받기
      a.currentTime = 0;
      const pr = a.play();
      if (pr && pr.catch) pr.catch(() => speakFallback());
      setSpeaking(true);
    } catch (_e) { speakFallback(); }
  };
  const close = () => { stopSpeak(); setOpen(false); };
  useEffect(() => { if (!open) return undefined; const onKey = (e) => { if (e.key === 'Escape') close(); }; window.addEventListener('keydown', onKey); return () => { window.removeEventListener('keydown', onKey); stopSpeak(); }; }, [open]);

  const secTitle = { fontSize: '12.5px', fontWeight: 800, color: C.text, margin: '2px 0 5px' };
  const li = { fontSize: '13px', color: C.muted, lineHeight: 1.65, padding: '3px 0 3px 15px', position: 'relative' };
  const dot = { position: 'absolute', left: '3px', top: '11px', width: '4px', height: '4px', borderRadius: '50%' };

  const body = (
    <>
      <p style={{ fontSize: '12.5px', color: C.text, lineHeight: 1.6, margin: '0 0 12px' }}>{p.intro}</p>
      <button type="button" onClick={toggleSpeak} aria-label={speaking ? '안내 읽기 멈추기' : '안내를 소리 내어 읽어주기'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', minHeight: '40px', padding: '0 15px', marginBottom: '14px', borderRadius: '10px', border: `1.5px solid var(--ls-gold,#d9a84f)`, background: speaking ? 'var(--ls-gold,#d9a84f)' : 'transparent', color: speaking ? '#20160a' : C.text, fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}>
        {speaking ? <Square size={15} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />} {speaking ? '읽기 멈추기' : '🔊 안내 들어보기'}
      </button>
      <p style={secTitle}>👁 앞이 안 보이거나 잘 안 보이면 (화면낭독기·키보드)</p>
      <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
        {p.vision.map((t, i) => <li key={i} style={li}><span aria-hidden="true" style={{ ...dot, background: 'var(--ls-gold,#d9a84f)' }} />{t}</li>)}
      </ul>
      <p style={secTitle}>📖 소리를 못 듣거나 조용히 보려면 (자막·전문 읽기)</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {p.hearing.map((t, i) => <li key={i} style={li}><span aria-hidden="true" style={{ ...dot, background: 'var(--ls-gold,#d9a84f)' }} />{t}</li>)}
      </ul>
    </>
  );

  // 아이콘 전용(상단) — 클릭 시 중앙 모달 팝업(상세 + TTS)
  if (iconOnly) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} aria-label="시각·청각 장애인 이용 안내 — 눌러서 자세히 보기·들어보기"
          title="시각·청각 장애인 이용 안내" style={{ display: 'grid', placeItems: 'center', minWidth: '38px', minHeight: '38px', padding: '8px', border: 'none', borderRadius: '10px', background: 'transparent', color: 'var(--ls-gold,#d9a84f)', cursor: 'pointer', ...style }}>
          <Accessibility size={19} aria-hidden="true" />
        </button>
        {open && (
          <>
            <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)' }} />
            <div role="dialog" aria-modal="true" aria-label="시각·청각 장애인 이용 안내" style={{ position: 'fixed', zIndex: 61, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 'min(440px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 48px)', overflowY: 'auto', background: 'var(--ls-card-strong,#11193a)', border: `1px solid var(--ls-gold,#d9a84f)`, borderRadius: '16px', padding: '18px 18px 20px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Accessibility size={18} aria-hidden="true" style={{ color: 'var(--ls-gold,#d9a84f)' }} />
                <b style={{ fontSize: '14.5px', color: C.text, flex: 1 }}>시각·청각 장애인 이용 안내</b>
                <button type="button" onClick={close} aria-label="닫기" style={{ display: 'grid', placeItems: 'center', width: '34px', height: '34px', border: 'none', borderRadius: '9px', background: 'transparent', color: C.muted, cursor: 'pointer' }}><X size={18} /></button>
              </div>
              {body}
            </div>
          </>
        )}
      </>
    );
  }

  // 인라인(기존) — 칩 + 아래 펼침
  return (
    <div style={style}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        aria-label="시각·청각 장애인 이용 안내 — 화면낭독기와 자막으로 이용하는 방법"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: '32px', padding: '5px 13px', borderRadius: '999px', border: `1.5px solid var(--ls-gold, #d9a84f)`, background: colors.surface || 'color-mix(in srgb, var(--ls-gold, #d9a84f) 14%, transparent)', color: C.text, fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
        <Accessibility size={14} aria-hidden="true" style={{ color: 'var(--ls-gold, #d9a84f)' }} /> 시각·청각 장애인 안내
        <ChevronDown size={12} aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
      </button>
      {open && (
        <div role="region" aria-label="접근성 이용 안내" style={{ marginTop: '8px', padding: '14px', borderRadius: '12px', border: `1px solid ${C.line}`, background: C.surface, textAlign: 'left' }}>
          {body}
        </div>
      )}
    </div>
  );
}

// 기능 프리셋의 sr 인트로 문구 — SrIntro와 함께 쓰기: <SrIntro text={a11ySrText('lecture')} />
export function a11ySrText(preset) { return (PRESETS[preset] || PRESETS.lecture).sr; }
