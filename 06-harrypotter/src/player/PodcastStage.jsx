// PodcastStage — 팟캐스트/스토리 낭독의 '무대'. 영상이 없으니 볼 것을 만들어 준다.
//   ▸ scenes(타임코드 삽화)가 있으면 '싱크 시네마틱 스토리북': 낭독에 맞춰 삽화가 크로스페이드+Ken-Burns로
//     바뀌고(드라마·영화 감성), 그 위에 '지금 들리는 문장' 자막을 얹는다.
//   ▸ ambient=true 이면(강의 팟캐스트=55분이라 3분 삽화와 싱크 불가) 삽화 10장을 타임라인 무시하고
//     ~20초마다 크로스페이드로 순환(앰비언트 배경). 재생 중에만 넘어가고, reduced-motion이면 정지.
//   ▸ scenes가 없으면 삽화(hero) 한 장 또는 표지 블러 배경.
//   ⚑ 제어 UI = '강독 VOD(StreamPlayer)'와 같은 언어: 무대 하단 컨트롤 바(스크러버→왼쪽 재생/건너뛰기+시간,
//     오른쪽 ⚙️ 옵션) + 중앙 반투명 재생. 재생 중 자동 숨김, 탭/호버/포커스 시 등장.
//   ▸ voices(있으면) = 무대 좌상단 낭독 목소리(여성/남성 성우) 토글 — 화면 안에서 바로 고른다.
//   옵션(자막 켜기/끄기·크기·배속)은 상시 노출이 아니라 ⚙️ 메뉴로 접는다.
//   접근성: 청각장애 = 화면 자막(켜기/끄기·크기), 시각장애 = role=slider 파형 + role=status 캡션.
//   캔버스·배경 이미지는 장식(aria-hidden). 캡션은 aria-live=off(초당 갱신) — 통독은 전사 패널.
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Captions, Minus, Plus, Settings2, Volume2, VolumeX, Maximize, Minimize, PictureInPicture2, ChevronLeft, ChevronRight, SkipBack, SkipForward } from 'lucide-react';
import { audio, useAudio, fmtTime, spokenTime } from './audioPlayer';
import Waveform from './Waveform';
import { langRuns } from './langRuns';
import { splitForDisplay, activeCaption } from './captions';
import CaptionLine from './CaptionLine';
import PlayerHud from './PlayerHud';

// 여러 브라우저 전체화면 API 이름차 흡수(VOD StreamPlayer와 동일)
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
// 캔버스 말줄바꿈(PiP 프레임용) — 글자 단위(한글·영어 공통)로 줄을 채우고 maxLines 넘으면 자른다. 가운데 정렬.
function wrapCanvasText(ctx, text, cx, cy, maxW, lh, maxLines) {
  const chars = [...String(text || '').trim()]; const lines = []; let line = '';
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = ch; if (lines.length >= maxLines) { line = ''; break; } }
    else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) return;
  const startY = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((ln, i) => ctx.fillText(ln.trim(), cx, startY + i * lh));
}

const SKIP = 15;
const CAP_KEY = 'ls_cap_pref';
const SCALES = [0.6, 0.75, 0.85, 1, 1.2, 1.45]; // 더 작은 단계 추가(좁은 폭 두 줄 방지 요청) — VOD와 통일
const RATE_OPTS = [0.75, 1, 1.25, 1.5, 2];
const AMBIENT_MS = 20000; // 앰비언트 삽화 순환 주기
// 자막 언어(번역 트랙). 'orig'=원문(발화 그대로). 번역은 전사 조각의 tr:{en,ja,…}에서 오며, 있으면 메뉴에 자동 노출.
const LANG_LABEL = { orig: '원어', dual: '동시', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', vi: '베트남어' };

// 무대는 항상 어두운 배경 → 컨트롤 색은 테마(라이트/다크)와 무관하게 '밝게' 고정한다(VOD와 동일).
const ctl = { display: 'grid', placeItems: 'center', border: 0, background: 'transparent', color: '#EDEFF4', borderRadius: '8px', cursor: 'pointer', width: '36px', height: '36px', flexShrink: 0 };
// 화면엔 안 보이고 스크린리더만 읽는 안내 — 시각장애 사용자에게 지원 기능을 처음에 알린다(비장애 화면 무변경).
const SR_ONLY = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };

// 삽화 크로스페이드 + Ken-Burns. 이전 장면은 아래 정적으로 깔고, 현재 장면이 위에서 서서히 나타난다.
//   ambient=true → 타임라인(t) 무시, 타이머로 순환. 아니면 t 기반 싱크(스토리 극장).
function SceneCanvas({ scenes, t, ambient, playing }) {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ambient || reduce || !playing) return undefined;
    const iv = setInterval(() => setTick(k => k + 1), AMBIENT_MS);
    return () => clearInterval(iv);
  }, [ambient, reduce, playing]);
  const idx = useMemo(() => {
    if (ambient) return reduce ? 0 : (tick % scenes.length);
    let k = 0;
    for (let i = 0; i < scenes.length; i++) { if (t >= scenes[i].start - 0.05) k = i; else break; }
    return k;
  }, [ambient, reduce, tick, scenes, t]);
  const prev = useRef(idx);
  const [cur, setCur] = useState(idx);
  useEffect(() => { if (idx !== cur) { prev.current = cur; setCur(idx); } }, [idx, cur]);
  const under = scenes[prev.current] || scenes[0];
  const over = scenes[cur] || scenes[0];
  return (
    <>
      <img src={under.url} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      <img key={cur} src={over.url} alt="" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', animation: reduce ? 'psFade 400ms ease forwards' : 'psFade 900ms ease forwards, psZoom 22s ease-out forwards' }} />
    </>
  );
}

export default function PodcastStage({ peaks, hero, cover, title, subtitle, transcript, currentTime = 0, idleCaption, scenes, ambient = false, voices, voiceId, onVoice, onPrevEp, onNextEp, epNoun = '화' }) {
  const s = useAudio();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const hideTimer = useRef(null);
  const volRef = useRef(null);
  const [chrome, setChrome] = useState(true);   // 제어판 노출 여부(자동 숨김)
  const [focusIn, setFocusIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false); // 볼륨 세로 팝업
  const [fs, setFs] = useState(false);            // 전체화면(맥스마이즈) — VOD와 통일
  // 오디오 PiP(화면 속 화면) — 오디오 무대엔 <video>가 없어, 캔버스에 '지금 자막 + 제목'을 그려 스트림으로 PiP.
  //   교차출처(R2) 삽화는 캔버스 오염→captureStream 실패라 그리지 않는다(자막/제목만 = 어학 학습 핵심, 항상 안전).
  const pipVideoRef = useRef(null), pipCanvasRef = useRef(null), pipRaf = useRef(0), pipStreamRef = useRef(null), pipCapRef = useRef('');
  const [pip, setPip] = useState(false);
  const pipOk = typeof document !== 'undefined' && !!document.pictureInPictureEnabled && typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
  const [cap, setCap] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CAP_KEY)) || { on: true, size: 1, lang: 'orig' }; } catch (_e) { return { on: true, size: 1, lang: 'orig' }; }
  });
  const saveCap = (next) => { setCap(next); try { localStorage.setItem(CAP_KEY, JSON.stringify(next)); } catch (_e) { /* noop */ } };
  const [hud, setHud] = useState(null);           // 화면 중앙 HUD(건너뛰기·볼륨·재생 순간 피드백)
  const hudSeq = useRef(0), hudTimer = useRef(null);
  const flashHud = useCallback((node, label, bar) => { hudSeq.current += 1; setHud({ node, label, bar, k: hudSeq.current }); clearTimeout(hudTimer.current); hudTimer.current = setTimeout(() => setHud(null), 680); }, []);
  useEffect(() => () => clearTimeout(hudTimer.current), []);
  const playing = s.status === 'playing';
  const dur = s.dur || 0;
  const progress = dur ? s.cur / dur : 0;
  const hasScenes = Array.isArray(scenes) && scenes.length > 0;
  const caps = useMemo(() => splitForDisplay(transcript), [transcript]);
  const hasCaps = (caps?.length > 0) || !!idleCaption;
  const hasVoices = Array.isArray(voices) && voices.length > 1;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const capLang = cap.lang || 'orig';
  const trLangs = useMemo(() => { const s = new Set(); (caps || []).forEach(seg => seg.tr && Object.keys(seg.tr).forEach(l => s.add(l))); return [...s]; }, [caps]);
  const primaryTr = trLangs[0] || null; // '동시'가 원문과 함께 보여줄 번역 언어(첫 번째)
  // 저장된 자막 언어가 현재 콘텐츠에 없으면 '원문'으로 강등(저장값은 유지). 조각별 폴백은 아래 <Runs>가 담당.
  const effLang = capLang === 'dual' ? (trLangs.length ? 'dual' : 'orig') : (capLang === 'orig' || trLangs.includes(capLang) ? capLang : 'orig');
  const langCycle = ['orig', ...trLangs, 'dual'];        // 자막 언어 토글 순환(원어→영어→…→동시)
  const cycleLang = () => saveCap({ ...cap, lang: langCycle[(langCycle.indexOf(effLang) + 1) % langCycle.length] });

  // ── 제어판 자동 숨김 (재생 중에만 숨김 · 포커스·메뉴·정지 중엔 유지 · reduced-motion이면 유지) ──
  //   숨김 판단은 setTimeout이 터질 때의 '실시간' 상태로 한다(클릭 시점 stale 클로저 방지).
  const focusRef = useRef(false), menuRef = useRef(false);
  useEffect(() => { focusRef.current = focusIn; }, [focusIn]);
  useEffect(() => { menuRef.current = menuOpen || volOpen; }, [menuOpen, volOpen]);
  // 볼륨 팝업 = 바깥 클릭 시 닫기
  useEffect(() => {
    if (!volOpen) return undefined;
    const onDown = (e) => { if (volRef.current && !volRef.current.contains(e.target)) setVolOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [volOpen]);
  const wake = useCallback(() => {
    setChrome(true); clearTimeout(hideTimer.current);
    // 재생 중에만 자동 숨김(정지=계속 노출=업계 표준). 메뉴·볼륨 팝업·키보드 포커스·감속모션이면 유지.
    hideTimer.current = setTimeout(() => {
      if (audio.snapshot().status === 'playing' && !focusRef.current && !menuRef.current && !reduce) setChrome(false);
    }, 1300);
  }, [reduce]);
  useEffect(() => { if (!playing || focusIn || menuOpen || volOpen) setChrome(true); }, [playing, focusIn, menuOpen, volOpen]); // 정지=계속 노출(업계 표준)·포커스·메뉴 중엔 유지
  useEffect(() => { if (playing) wake(); }, [playing, wake]); // 재생 시작하면 숨김 카운트다운 시작
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const nowLine = useMemo(() => activeCaption(caps, currentTime), [caps, currentTime]);
  // 자막 = 언어별 '한 줄씩'. dual(동시)=원문(위)+번역(아래). 조각에 번역 없으면 원문만.
  const capLines = useMemo(() => {
    if (!nowLine) return [];
    if (effLang === 'dual') {
      const arr = [{ runs: langRuns(nowLine.text, 'ko') }];
      if (primaryTr && nowLine.tr?.[primaryTr]) arr.push({ runs: langRuns(nowLine.tr[primaryTr], primaryTr) });
      return arr;
    }
    if (effLang !== 'orig' && nowLine.tr?.[effLang]) return [{ runs: langRuns(nowLine.tr[effLang], effLang) }];
    return [{ runs: langRuns(nowLine.text, 'ko') }];
  }, [nowLine, effLang, primaryTr]);
  // PiP 프레임에 그릴 '지금 자막' 평문 — 매 렌더 갱신(캔버스 draw 루프가 읽음). 없으면 idle 캡션.
  pipCapRef.current = capLines.length ? capLines.map(l => l.runs.map(r => r.text).join('')).join('   ') : (idleCaption || '');

  const seekTo = (frac) => { if (dur) audio.seek(Math.max(0, Math.min(dur, frac * dur))); };
  const onPointer = (e) => { const r = wrapRef.current?.getBoundingClientRect(); if (r) { seekTo((e.clientX - r.left) / r.width); wake(); } };
  // 재생/정지·건너뛰기·볼륨 = 화면 중앙 HUD 피드백(키보드·버튼·탭 공용, VOD와 통일)
  const togglePlay = () => { const willPlay = audio.snapshot().status !== 'playing'; audio.toggle(); flashHud(willPlay ? <Play size={32} /> : <Pause size={32} />); wake(); };
  const nudge = (sec) => { audio.skip(sec); flashHud(sec > 0 ? <RotateCw size={30} /> : <RotateCcw size={30} />, `${sec > 0 ? '앞으로' : '뒤로'} ${Math.abs(sec)}초`); wake(); };
  // ⚠️ 기준 볼륨은 React 상태(s.volume)가 아니라 최신 스냅샷에서 읽는다 — 키 꾹 누름(빠른 반복) 시
  //    리렌더 전까지 s.volume이 안 바뀌어 옛 값 기준으로만 계산돼 중간대(20~80%)에 갇히던 버그 방지.
  const bumpVol = (delta) => { const snap = audio.snapshot(); const base = snap.muted ? 0 : (snap.volume ?? 1); const nv = Math.max(0, Math.min(1, base + delta)); audio.setVolume(nv); flashHud(nv === 0 ? <VolumeX size={30} /> : <Volume2 size={30} />, `${Math.round(nv * 100)}%`, nv); wake(); };
  // 배속(</> 또는 ,.) — 최신 배속에서 한 단계, 화면 중앙 HUD 표시
  const bumpRate = (dir) => { const rate = audio.snapshot().rate || 1; const i = RATE_OPTS.reduce((b, r, idx) => Math.abs(r - rate) < Math.abs(RATE_OPTS[b] - rate) ? idx : b, 0); const ni = Math.max(0, Math.min(RATE_OPTS.length - 1, i + dir)); audio.setRate(RATE_OPTS[ni]); flashHud(<span style={{ fontSize: '20px', fontWeight: 900 }}>{RATE_OPTS[ni]}×</span>, '배속'); wake(); };
  // 숫자 0~9 = 구간 점프(0~90%)
  const jumpTo = (frac) => { const d = audio.snapshot().dur || 0; if (!d) return; audio.seek(frac * d); flashHud(<span style={{ fontSize: '22px', fontWeight: 900 }}>{Math.round(frac * 100)}%</span>, '구간 이동'); wake(); };
  // 스크러버(슬라이더) 키보드 — 접근성: 포커스 시 화살표=이동. ←→=±5초(Shift 10)·↑↓=±10초.
  const onKey = (e) => {
    const step = e.shiftKey ? 10 : 5;
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(10); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-10); }
    else if (e.key === 'Home') { audio.seek(0); e.preventDefault(); wake(); }
    else if (e.key === 'End') { audio.seek(Math.max(0, dur - 1)); e.preventDefault(); wake(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay(); }
  };
  // 무대(영역) 키보드(PC) — 스페이스=재생/정지 · ←→=±5초 · ↑↓=볼륨. 슬라이더/버튼 포커스면 그 컨트롤에 양보.
  const stageKey = (e) => {
    const tag = e.target.tagName, onCtl = e.target.getAttribute('role') === 'slider' || tag === 'BUTTON' || tag === 'INPUT';
    if (e.key === ' ' || e.key === 'k') { if (e.key === ' ' && onCtl) return; e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { if (onCtl) return; e.preventDefault(); nudge(5); }
    else if (e.key === 'ArrowLeft') { if (onCtl) return; e.preventDefault(); nudge(-5); }
    else if (e.key === 'ArrowUp') { if (onCtl) return; e.preventDefault(); bumpVol(0.1); }
    else if (e.key === 'ArrowDown') { if (onCtl) return; e.preventDefault(); bumpVol(-0.1); }
    else if (e.key === 'm') { const wasMuted = s.muted; audio.toggleMute(); flashHud(wasMuted ? <Volume2 size={30} /> : <VolumeX size={30} />, wasMuted ? '음소거 해제' : '음소거'); wake(); }
    else if (e.key === 'f') { toggleFs(); }
    else if (e.key === 'c' && hasCaps) { saveCap({ ...cap, on: !cap.on }); wake(); }
    else if (e.key >= '0' && e.key <= '9') { e.preventDefault(); jumpTo(Number(e.key) / 10); }
    else if (e.key === '>' || e.key === '.') { e.preventDefault(); bumpRate(1); }
    else if (e.key === '<' || e.key === ',') { e.preventDefault(); bumpRate(-1); }
    else if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
  };
  // 모바일 좌/우 더블탭 = ±10초(유튜브식) · 가운데 탭 = 재생/정지. 마우스 클릭은 즉시(터치만 이 로직).
  const tapRef = useRef({ t: 0, side: '', timer: null });
  const lastTouchAt = useRef(0);
  useEffect(() => () => clearTimeout(tapRef.current.timer), []);
  const stageSide = (clientX) => { const r = stageRef.current?.getBoundingClientRect(); if (!r || !r.width) return 'center'; const f = (clientX - r.left) / r.width; return f < 0.33 ? 'left' : f > 0.67 ? 'right' : 'center'; };
  const onStageTouchEnd = (e) => {
    if (!e.changedTouches || e.changedTouches.length !== 1) return;              // 멀티터치·핀치 무시
    if (e.target?.closest && e.target.closest('button,[role="slider"],input,[role="menu"],[role="group"]')) return; // 컨트롤 탭은 그 컨트롤이 처리
    lastTouchAt.current = Date.now(); wake();
    // 화면 맨 가장자리(12%) 탭 = 이전/다음 화 — 더블탭 seek 존(12~33%)·가운데(재생/정지)와 분리(운영자: 모든 플레이어 기본기)
    const r0 = stageRef.current?.getBoundingClientRect();
    const frac = r0 && r0.width ? (e.changedTouches[0].clientX - r0.left) / r0.width : 0.5;
    if (frac < 0.12 && onPrevEp) { clearTimeout(tapRef.current.timer); tapRef.current = { t: 0, side: '', timer: null }; onPrevEp(); flashHud(<SkipBack size={30} />, `이전 ${epNoun}`); return; }
    if (frac > 0.88 && onNextEp) { clearTimeout(tapRef.current.timer); tapRef.current = { t: 0, side: '', timer: null }; onNextEp(); flashHud(<SkipForward size={30} />, `다음 ${epNoun}`); return; }
    const side = stageSide(e.changedTouches[0].clientX), tap = tapRef.current, now = Date.now();
    if (side !== 'center' && tap.side === side && now - tap.t < 300) {           // 더블탭 → 탐색(대기 중 단일탭 취소)
      clearTimeout(tap.timer); tapRef.current = { t: 0, side: '', timer: null }; nudge(side === 'right' ? 10 : -10); return;
    }
    if (side === 'center') {                                                     // 가운데 = 즉시 재생/정지
      clearTimeout(tap.timer); tapRef.current = { t: 0, side: '', timer: null }; togglePlay(); try { stageRef.current?.focus({ preventScroll: true }); } catch (_e) { /* noop */ } return;
    }
    clearTimeout(tap.timer);                                                     // 가장자리 첫 탭 → 더블탭 대기(안 오면 재생/정지)
    const timer = setTimeout(() => { tapRef.current = { t: 0, side: '', timer: null }; togglePlay(); }, 300);
    tapRef.current = { t: now, side, timer };
  };

  // 전체화면(맥스마이즈) — 무대 요소를 전체화면. VOD(StreamPlayer)와 통일. 모바일은 가로(landscape) 잠금 시도.
  useEffect(() => {
    const sync = () => { const on = fsElement() === stageRef.current; setFs(on); if (!on) { try { window.screen?.orientation?.unlock?.(); } catch (_e) { /* noop */ } } };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('webkitfullscreenchange', sync); };
  }, []);
  const toggleFs = () => {
    const el = stageRef.current; if (!el) return;
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try { exit?.call(document); } catch (e) { console.error('exitFullscreen', e); }
    } else if (el.requestFullscreen) {
      el.requestFullscreen().then(() => { try { window.screen?.orientation?.lock?.('landscape'); } catch (_e) { /* noop */ } }).catch((e) => { console.error('requestFullscreen', e); });
    } else if (el.webkitRequestFullscreen) {
      try { el.webkitRequestFullscreen(); } catch (e) { console.error('webkitRequestFullscreen', e); }
    }
    wake();
  };

  // ── PiP(화면 속 화면) — 캔버스에 시네마 그라디언트 + 제목 + '지금 자막'을 그려 스트림으로 띄운다. 오디오는 계속 재생. ──
  const drawPip = useCallback(() => {
    const cv = pipCanvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const W = cv.width, H = cv.height;
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1024'); g.addColorStop(1, '#05060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(246,200,120,0.92)'; ctx.font = '600 24px Georgia, "Times New Roman", serif'; ctx.textBaseline = 'top';
    wrapCanvasText(ctx, title || '리터스텔라 강독', W / 2, 26, W - 72, 30, 2);
    ctx.fillStyle = '#f4efe6'; ctx.font = '700 34px system-ui, -apple-system, sans-serif'; ctx.textBaseline = 'middle';
    wrapCanvasText(ctx, pipCapRef.current, W / 2, H * 0.56, W - 88, 44, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.font = '600 14px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
    ctx.fillText('리터스텔라 · 강독', W / 2, H - 16);
  }, [title]);
  const startPip = useCallback(async () => {
    if (!pipOk) return;
    const cv = pipCanvasRef.current, video = pipVideoRef.current; if (!cv || !video) return;
    try {
      drawPip();
      if (!pipStreamRef.current) pipStreamRef.current = cv.captureStream(10);
      const loop = () => { drawPip(); pipRaf.current = requestAnimationFrame(loop); };
      cancelAnimationFrame(pipRaf.current); loop();
      video.srcObject = pipStreamRef.current; video.muted = true;
      await video.play().catch(() => {});
      if (video.readyState < 2) await new Promise((res) => {
        const done = () => { video.removeEventListener('loadeddata', done); res(); };
        video.addEventListener('loadeddata', done); setTimeout(done, 300);
      });
      await video.requestPictureInPicture();
    } catch (e) {
      console.error('오디오 PiP를 열 수 없어요', e); cancelAnimationFrame(pipRaf.current);
      flashHud(<PictureInPicture2 size={28} />, '화면 속 화면을 열 수 없어요');
    }
    wake();
  }, [pipOk, drawPip, wake, flashHud]);
  const stopPip = useCallback(async () => { try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); } catch (e) { console.error('exit PiP', e); } }, []);
  const togglePip = () => { pip ? stopPip() : startPip(); };
  // PiP 진입/이탈 동기 + 정리, 그리고 PiP 창의 재생/정지 버튼 = 오디오 제어(캔버스 비디오는 무음이라 이어줘야 함).
  useEffect(() => {
    const v = pipVideoRef.current; if (!v) return undefined;
    const onEnter = () => setPip(true);
    const onLeave = () => { setPip(false); cancelAnimationFrame(pipRaf.current); try { v.srcObject = null; } catch (_e) { /* noop */ } if (pipStreamRef.current) { try { pipStreamRef.current.getTracks().forEach(t => t.stop()); } catch (_e) { /* noop */ } pipStreamRef.current = null; } };
    const onPlay = () => { if (audio.snapshot().status !== 'playing') audio.play(); };
    const onPause = () => { if (audio.snapshot().status === 'playing') audio.pause(); };
    v.addEventListener('enterpictureinpicture', onEnter);
    v.addEventListener('leavepictureinpicture', onLeave);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => { v.removeEventListener('enterpictureinpicture', onEnter); v.removeEventListener('leavepictureinpicture', onLeave); v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); };
  }, []);
  // 오디오 재생상태 → PiP 캔버스 비디오 동기(오디오가 밖에서 멈추면 PiP도 멈춘 것처럼). onPlay/onPause 가드로 되먹임 없음.
  useEffect(() => {
    const v = pipVideoRef.current; if (!v || !pip) return;
    if (playing && v.paused) v.play().catch(() => {});
    else if (!playing && !v.paused) v.pause();
  }, [playing, pip]);
  useEffect(() => () => { cancelAnimationFrame(pipRaf.current); }, []);

  const bg = hero || cover;
  const capFont = `calc(clamp(15px, 3.4vw, 19px) * ${cap.size})`;
  const showCaption = cap.on && (nowLine || idleCaption);
  const chipBtn = (on) => ({ minHeight: '34px', padding: '0 10px', borderRadius: '999px', border: `1px solid ${on ? 'var(--ls-gold,#f6c878)' : 'rgba(255,255,255,0.22)'}`, background: on ? 'var(--ls-gold,#f6c878)' : 'transparent', color: on ? '#20160a' : '#f4efe6', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' });

  return (
    <div>
      <style>{'@keyframes psFade{from{opacity:0}to{opacity:1}}@keyframes psZoom{from{transform:scale(1.0)}to{transform:scale(1.08)}}@keyframes psSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}.ls-player:focus-visible{outline:2.5px solid #f6c878;outline-offset:-3px}'}</style>

      {/* 스크린리더 전용 사용 안내 (첫 접속 오리엔테이션, 시각 숨김) */}
      <p style={SR_ONLY}>리터스텔라 오디오 강독입니다. 스페이스바로 재생·일시정지, 15초 앞뒤 이동 버튼과, 재생 위치 슬라이더는 좌우 화살표 키로 조절합니다. 자막·배속은 설정(재생 옵션) 메뉴에 있습니다. 화면을 닫아도 계속 들을 수 있습니다.</p>

      {/* PiP(화면 속 화면)용 오프스크린 캔버스+비디오(숨김) — 캔버스 프레임을 스트림으로 PiP 창에 띄운다 */}
      {/* PiP 오프스크린 렌더 — display:none이면 캔버스 미렌더로 captureStream 빈 프레임 → PiP 거부. 화면 밖 1px. */}
      <canvas ref={pipCanvasRef} width={640} height={400} aria-hidden="true"
        style={{ position: 'fixed', left: 0, bottom: 0, width: '1px', height: '1px', opacity: 0, pointerEvents: 'none', zIndex: -1 }} />
      <video ref={pipVideoRef} muted playsInline aria-hidden="true"
        style={{ position: 'fixed', left: 0, bottom: 0, width: '1px', height: '1px', opacity: 0, pointerEvents: 'none', zIndex: -1 }} />

      {/* ── 시네마틱 무대 (제어판을 위에 얹는다 — VOD와 동일한 언어) ── */}
      <div ref={stageRef} tabIndex={0} className="ls-player"
        onMouseMove={wake} onMouseLeave={() => { if (audio.snapshot().status === 'playing' && !menuRef.current && !focusRef.current && !reduce) setChrome(false); }}
        onTouchStart={wake} onTouchEnd={onStageTouchEnd} onKeyDown={stageKey}
        onClick={() => { if (Date.now() - lastTouchAt.current < 600) return; togglePlay(); try { stageRef.current?.focus({ preventScroll: true }); } catch (_e) { /* noop */ } }}
        onFocus={(e) => { let kb = true; try { kb = !!(e.target.matches && e.target.matches(':focus-visible')); } catch (_e) { kb = true; } if (kb) setFocusIn(true); }}
        onBlur={(e) => { if (!stageRef.current?.contains(e.relatedTarget)) setFocusIn(false); }}
        style={fs
          ? { position: 'relative', width: '100vw', height: '100dvh', borderRadius: 0, overflow: 'hidden', background: '#0b0f1e', outline: 'none' }
          : { position: 'relative', width: '100%', aspectRatio: '16 / 10', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 14px 40px rgba(0,0,0,0.45)', background: '#0b0f1e', marginBottom: '12px', outline: 'none' }}>
        {hasScenes
          ? <SceneCanvas scenes={scenes} t={currentTime} ambient={ambient} playing={playing} />
          : bg && <img src={bg} alt="" aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: hero ? 'none' : 'blur(26px) brightness(0.5)', transform: playing ? 'scale(1.06)' : 'scale(1.0)', transition: 'transform 8s ease-out' }} />}
        {!hasScenes && !hero && cover && (
          <img src={cover} alt="" aria-hidden="true" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-58%)', height: '58%', width: 'auto', aspectRatio: '7/10', objectFit: 'cover', borderRadius: '8px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }} />
        )}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(5,7,20,0.12) 34%, rgba(5,7,20,0.55) 72%, rgba(5,7,20,0.9))' }} />

        {/* 낭독 목소리(여성/남성 성우) — 무대 좌상단, 화면 안에서 바로 고른다 */}
        {hasVoices && (
          <div role="group" aria-label="낭독 목소리" style={{ position: 'absolute', top: '8px', left: '8px', display: 'flex', gap: '4px', padding: '3px', borderRadius: '999px', background: 'rgba(5,7,20,0.55)', opacity: chrome ? 1 : 0, transition: 'opacity .25s', pointerEvents: chrome ? 'auto' : 'none' }}>
            {voices.map(v => {
              const on = v.id === voiceId;
              return (
                <button key={v.id} onClick={(e) => { e.stopPropagation(); onVoice?.(v.id); wake(); }} aria-pressed={on}
                  style={{ minHeight: '32px', padding: '0 11px', borderRadius: '999px', border: 0, background: on ? 'var(--ls-gold,#f6c878)' : 'transparent', color: on ? '#20160a' : '#f4efe6', fontSize: '12px', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>{v.label}</button>
              );
            })}
          </div>
        )}

        {/* 이전/다음 화 화살표 — 무대 좌우 가장자리(마우스·터치 공용, 컨트롤 노출 시). 터치는 맨 가장자리 탭도 동일 동작 */}
        {onPrevEp && (
          <button onClick={(e) => { e.stopPropagation(); onPrevEp(); flashHud(<SkipBack size={30} />, `이전 ${epNoun}`); }} aria-label={`이전 ${epNoun}`} title={`이전 ${epNoun}`}
            style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', zIndex: 4, width: '32px', height: '54px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '10px', background: 'rgba(5,7,20,0.45)', color: '#f4efe6', cursor: 'pointer', opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none', transition: 'opacity .25s' }}>
            <ChevronLeft size={19} /></button>
        )}
        {onNextEp && (
          <button onClick={(e) => { e.stopPropagation(); onNextEp(); flashHud(<SkipForward size={30} />, `다음 ${epNoun}`); }} aria-label={`다음 ${epNoun}`} title={`다음 ${epNoun}`}
            style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', zIndex: 4, width: '32px', height: '54px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '10px', background: 'rgba(5,7,20,0.45)', color: '#f4efe6', cursor: 'pointer', opacity: chrome ? 1 : 0, pointerEvents: chrome ? 'auto' : 'none', transition: 'opacity .25s' }}>
            <ChevronRight size={19} /></button>
        )}

        {/* 지금 들리는 문장 (청각장애 자막) — 언어별 한 줄씩(폭 넘치면 자동 축소). 제어판 열리면 위로 밀어 가림 방지 */}
        {showCaption && (
          <div role="status" aria-live="off" style={{ position: 'absolute', left: 0, right: 0, bottom: chrome ? '96px' : '14px', transition: 'bottom .22s ease', padding: '0 clamp(12px,4vw,20px)', textAlign: 'center' }}>
            {nowLine
              ? capLines.map((ln, i) => (
                  <div key={i} style={{ marginTop: i ? '6px' : 0 }}><CaptionLine runs={ln.runs} fontSize={capFont} /></div>
                ))
              : <p style={{ margin: 0, fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: `calc(clamp(14px,3vw,17px) * ${cap.size})`, lineHeight: 1.5, color: '#f4efe6', textShadow: '0 1px 8px rgba(0,0,0,0.75)' }}>{idleCaption}</p>}
          </div>
        )}

        {/* 중앙 재생 버튼 없음 — 삽화/자막을 가리지 않게, 무대 탭/클릭 = 재생·정지(위 onClick). 조작은 하단 바. */}
        {s.waiting && (
          <div aria-hidden="true" style={{ position: 'absolute', top: '44%', left: '50%', transform: 'translate(-50%,-50%)', width: '42px', height: '42px', border: '3px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', borderRadius: '50%', animation: reduce ? 'none' : 'psSpin .8s linear infinite' }} />
        )}

        {/* 조작 HUD — 건너뛰기·볼륨·재생 순간 피드백(화면 중앙) */}
        <PlayerHud hud={hud} />

        {/* ⚙️ 옵션 메뉴 (컨트롤 바 위로 열림) */}
        {menuOpen && (
          <>
            <div onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'default' }} />
            <div role="menu" aria-label="재생 옵션" onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', bottom: '58px', right: '10px', zIndex: 6, minWidth: '208px', maxWidth: 'calc(100% - 20px)', maxHeight: 'calc(100% - 74px)', overflowY: 'auto', padding: '12px', borderRadius: '14px', background: 'rgba(10,14,30,0.97)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 14px 34px rgba(0,0,0,0.55)', color: '#f4efe6' }}>
              {hasCaps && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', marginBottom: '7px' }}>화면 자막</div>
                  <button onClick={() => saveCap({ ...cap, on: !cap.on })} aria-pressed={cap.on}
                    style={{ width: '100%', minHeight: '40px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.16)', background: cap.on ? 'color-mix(in srgb, var(--ls-gold,#f6c878) 22%, transparent)' : 'transparent', color: '#f4efe6', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}>
                    <Captions size={15} /> 자막 <span style={{ flex: 1 }} /> <span style={{ color: cap.on ? 'var(--ls-gold,#f6c878)' : 'rgba(255,255,255,0.6)' }}>{cap.on ? '켬' : '끔'}</span>
                  </button>
                  {cap.on && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                      <span style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.7)', flex: 1 }}>자막 크기</span>
                      <button onClick={() => saveCap({ ...cap, size: SCALES[Math.max(0, SCALES.indexOf(cap.size) - 1)] })} aria-label="자막 작게" disabled={cap.size === SCALES[0]}
                        style={{ width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '9px', background: 'transparent', color: '#f4efe6', cursor: 'pointer', fontSize: '13px', fontWeight: 800, opacity: cap.size === SCALES[0] ? 0.4 : 1 }}><Minus size={15} /></button>
                      <button onClick={() => saveCap({ ...cap, size: SCALES[Math.min(SCALES.length - 1, SCALES.indexOf(cap.size) + 1)] })} aria-label="자막 크게" disabled={cap.size === SCALES[SCALES.length - 1]}
                        style={{ width: '38px', height: '38px', display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '9px', background: 'transparent', color: '#f4efe6', cursor: 'pointer', fontSize: '17px', fontWeight: 800, opacity: cap.size === SCALES[SCALES.length - 1] ? 0.4 : 1 }}><Plus size={15} /></button>
                    </div>
                  )}
                  {trLangs.length > 0 && (
                    <p style={{ margin: '9px 0 0', fontSize: '10.5px', color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>자막 언어(원어·영어·동시)는 아래 <span aria-hidden="true">🔤</span> 버튼에서 바로 바꿔요.</p>
                  )}
                </div>
              )}
              <div>
                <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '0.05em', color: 'rgba(255,255,255,0.6)', marginBottom: '7px' }}>재생 속도</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {RATE_OPTS.map(r => (
                    <button key={r} onClick={() => audio.setRate(r)} aria-pressed={s.rate === r} style={chipBtn(s.rate === r)}>{r}×</button>
                  ))}
                </div>
              </div>
              {/* 화면 속 화면(PiP) — 강독 VOD와 통일. 오디오 무대는 삽화·자막을 캔버스로 띄운다 */}
              {pipOk && (
                <div style={{ marginTop: '12px' }}>
                  <button onClick={() => { togglePip(); setMenuOpen(false); }} aria-pressed={pip}
                    style={{ width: '100%', minHeight: '40px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.16)', background: pip ? 'color-mix(in srgb, var(--ls-gold,#f6c878) 22%, transparent)' : 'transparent', color: '#f4efe6', fontSize: '12.5px', fontWeight: 800, cursor: 'pointer' }}>
                    <PictureInPicture2 size={16} /> 화면 속 화면 <span style={{ flex: 1 }} /> <span style={{ color: pip ? 'var(--ls-gold,#f6c878)' : 'rgba(255,255,255,0.6)' }}>{pip ? '켬' : '끔'}</span>
                  </button>
                  <p style={{ margin: '6px 2px 0', fontSize: '10px', color: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }}>작은 창으로 자막을 보며 다른 일도 할 수 있어요.</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 제어판 오버레이 (스크러버 + 컨트롤 행) — 무대 하단, 자동 숨김 · VOD와 동일 배치 ── */}
        {/* onClick stopPropagation = 컨트롤 영역 클릭이 무대 탭(재생/정지)으로 새지 않게 */}
        <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '26px 12px 10px', background: 'linear-gradient(0deg, rgba(5,7,20,0.92), rgba(5,7,20,0.4) 64%, transparent)', opacity: chrome ? 1 : 0, transform: chrome ? 'translateY(0)' : 'translateY(8px)', transition: 'opacity .25s, transform .25s', pointerEvents: chrome ? 'auto' : 'none' }}>
          {/* 파형 스크러버 */}
          <div ref={wrapRef} role="slider" tabIndex={0} aria-label="재생 위치"
            aria-valuemin={0} aria-valuemax={Math.floor(dur)} aria-valuenow={Math.floor(s.cur)}
            aria-valuetext={`${spokenTime(s.cur)}, 전체 ${spokenTime(dur)}`}
            onClick={(e) => { e.stopPropagation(); onPointer(e); }} onKeyDown={onKey}
            onMouseMove={(e) => { const r = wrapRef.current.getBoundingClientRect(); setHover((e.clientX - r.left) / r.width); }}
            onMouseLeave={() => setHover(null)}
            className="ls-wf" style={{ padding: '2px 0', borderRadius: '8px', outline: 'none', '--wf-played': 'var(--ls-gold, #f6c878)', '--wf-rest': 'rgba(255,255,255,0.3)' }}>
            {peaks?.length
              ? <Waveform peaks={peaks} progress={progress} hover={hover} height={38} />
              : <div style={{ height: '5px', borderRadius: '999px', background: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}>
                  <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--ls-gold,#f6c878)' }} />
                </div>}
          </div>
          {/* 컨트롤 행 — 왼쪽 재생·건너뛰기·시간 | 오른쪽 ⚙️ 옵션 (VOD와 동일) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginTop: '2px' }}>
            <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={playing ? '일시정지' : '재생'} style={ctl}>
              {s.waiting ? <span style={{ fontSize: '12px', fontWeight: 800 }}>…</span> : playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); nudge(-SKIP); }} aria-label={`${SKIP}초 뒤로`} title={`${SKIP}초 뒤로`} style={ctl}>
              <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: '18px', height: '18px' }}><RotateCcw size={18} /><span aria-hidden="true" style={{ position: 'absolute', fontSize: '7px', fontWeight: 800, lineHeight: 1 }}>{SKIP}</span></span>
            </button>
            <button onClick={(e) => { e.stopPropagation(); nudge(SKIP); }} aria-label={`${SKIP}초 앞으로`} title={`${SKIP}초 앞으로`} style={ctl}>
              <span style={{ position: 'relative', display: 'grid', placeItems: 'center', width: '18px', height: '18px' }}><RotateCw size={18} /><span aria-hidden="true" style={{ position: 'absolute', fontSize: '7px', fontWeight: 800, lineHeight: 1 }}>{SKIP}</span></span>
            </button>
            {/* 볼륨 (세로 팝업, 강독 VOD와 통일) */}
            <div ref={volRef} style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
              <button onClick={(e) => { e.stopPropagation(); setVolOpen(o => !o); wake(); }} aria-label={s.muted || (s.volume ?? 1) === 0 ? '음소거됨, 음량 열기' : '음량'} aria-expanded={volOpen} title="음량" style={ctl}>
                {(s.muted || (s.volume ?? 1) === 0) ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              {volOpen && (
                <div role="group" aria-label="음량" onClick={(e) => e.stopPropagation()}
                  style={{ position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 7, padding: '10px 8px 8px', borderRadius: '12px', background: 'rgba(10,14,30,0.97)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <input type="range" min={0} max={1} step={0.05} value={s.muted ? 0 : (s.volume ?? 1)} onChange={(e) => audio.setVolume(parseFloat(e.target.value))}
                    aria-label="음량" aria-valuetext={`음량 ${Math.round((s.muted ? 0 : (s.volume ?? 1)) * 100)}퍼센트`}
                    style={{ writingMode: 'vertical-lr', direction: 'rtl', width: '22px', height: '92px', accentColor: 'var(--ls-gold,#f6c878)', cursor: 'pointer' }} />
                  <button onClick={() => audio.toggleMute()} aria-label={s.muted ? '음소거 해제' : '음소거'} aria-pressed={s.muted}
                    style={{ width: '30px', height: '30px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '8px', background: 'transparent', color: '#f4efe6', cursor: 'pointer' }}>
                    {(s.muted || (s.volume ?? 1) === 0) ? <VolumeX size={15} /> : <Volume2 size={15} />}
                  </button>
                </div>
              )}
            </div>
            <span aria-hidden="true" style={{ fontSize: '11.5px', color: '#EDEFF4', fontVariantNumeric: 'tabular-nums', margin: '0 6px', whiteSpace: 'nowrap' }}>{fmtTime(s.cur)} <span style={{ color: 'rgba(237,239,244,0.55)' }}>/ {fmtTime(dur)}</span></span>
            <div style={{ flex: 1 }} />
            {/* 자막 켜기/끄기 심플 버튼 (어학 학습 필수) — 제어판에 직접 노출 */}
            {hasCaps && (
              <button onClick={(e) => { e.stopPropagation(); saveCap({ ...cap, on: !cap.on }); wake(); }} aria-label={cap.on ? '자막 끄기' : '자막 켜기'} aria-pressed={cap.on} title="자막 켜기/끄기"
                style={{ ...ctl, color: cap.on ? 'var(--ls-gold,#f6c878)' : '#EDEFF4' }}><Captions size={18} /></button>
            )}
            {cap.on && trLangs.length > 0 && (
              <button onClick={(e) => { e.stopPropagation(); cycleLang(); wake(); }} aria-label={`자막 언어: ${LANG_LABEL[effLang]}, 눌러서 바꾸기`} title="자막 언어 (원어·영어·동시)"
                style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '30px', padding: '0 9px', marginRight: '2px', flexShrink: 0, borderRadius: '999px', border: `1px solid ${effLang !== 'orig' ? 'var(--ls-gold,#f6c878)' : 'rgba(255,255,255,0.28)'}`, background: effLang !== 'orig' ? 'color-mix(in srgb, var(--ls-gold,#f6c878) 22%, transparent)' : 'transparent', color: effLang !== 'orig' ? 'var(--ls-gold,#f6c878)' : '#EDEFF4', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}>
                <Captions size={14} />{LANG_LABEL[effLang]}
              </button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); wake(); }} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="재생 옵션"
              style={{ ...ctl, background: menuOpen ? 'rgba(255,255,255,0.14)' : 'transparent' }}><Settings2 size={18} /></button>
            {/* 전체화면(맥스마이즈) — 스토리 극장·강독 VOD와 통일. 모바일은 가로 전환 */}
            <button onClick={(e) => { e.stopPropagation(); toggleFs(); }} aria-label={fs ? '전체화면 나가기' : '전체화면'} title={fs ? '전체화면 나가기' : '전체화면(맥스마이즈)'}
              style={ctl}>{fs ? <Minimize size={18} /> : <Maximize size={18} />}</button>
          </div>
        </div>
      </div>

      {/* 정체(제목/부제) — 컨트롤이 아니라 신원. 무대 아래 상시 노출 */}
      <div style={{ textAlign: 'center', marginBottom: '4px' }}>
        <div style={{ fontWeight: 800, fontSize: '15px', color: 'var(--ls-text)' }}>{title}</div>
        <div style={{ fontSize: '11.5px', color: 'var(--ls-muted)', marginTop: '3px' }}>{subtitle}</div>
      </div>

      {s.error && <div role="alert" style={{ marginTop: '10px', fontSize: '12px', color: 'var(--ls-error,#ff6b6b)', textAlign: 'center' }}>{s.error}</div>}
    </div>
  );
}
