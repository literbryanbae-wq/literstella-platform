// =============================================================
// audioPlayer.js — 전역 오디오(팟캐스트·스토리 낭독) 단일 채널 싱글턴.
//   왜: 스토리 극장 낭독 / 강독 팟캐스트 / (후속)뉴스레터 오디오가 각자 <audio>를 들고 있어
//       컨트롤·이어듣기·잠금화면이 제각각이고 동시에 두 소리가 날 수 있었다 → 하나로 통합.
//   ⚠️ ttsPlayer(기계 낭독)와는 '통합하지 않는다' — 정서도 엔진도 다르다(탐색·길이 개념 없음).
//      유일한 접점은 mediaBus("동시에 두 소리 금지"). 서로 직접 import 하지 않는다(순환 import·흰화면 방지).
//   화면을 닫아도 재생은 계속되고, 도크 필(AudioPill)이 출처·제어를 항상 노출한다(유령 재생 방지).
// =============================================================
import { useSyncExternalStore } from 'react';
import { claimMedia, onMediaClaim } from './mediaBus';

export const RATES = [1, 1.25, 1.5, 2, 0.75];
const posKey = (k) => `ls_audio_pos_${k}`;

let el = null;
let pendingSeek = null;          // load({startAt}) — 목소리 전환 시 듣던 위치 유지
const subs = new Set();
const visibleOwners = new Set(); // 이 오디오를 보여주는 화면(열려있으면 도크 필 숨김)

let state = {
  status: 'idle',        // idle | playing | paused
  src: '', key: '', title: '', subtitle: '', book: '',
  cur: 0, dur: 0, rate: 1, waiting: false, error: '',
  volume: (() => { try { const v = parseFloat(localStorage.getItem('ls_audio_vol')); return isFinite(v) ? Math.max(0, Math.min(1, v)) : 1; } catch (_e) { return 1; } })(), // 세션 영속(플레이어 공통)
  muted: false,
  reopen: null,          // { event, detail } — 도크 필 탭 시 원래 화면 다시 열기
  surfaceVisible: false,
};

function emit() { state = { ...state, surfaceVisible: visibleOwners.size > 0 }; subs.forEach(f => f()); }

function savePos() { try { if (state.key && el && el.currentTime > 5) localStorage.setItem(posKey(state.key), String(Math.floor(el.currentTime))); } catch (_e) { /* noop */ } }
function clearPos() { try { if (state.key) localStorage.removeItem(posKey(state.key)); } catch (_e) { /* noop */ } }
function restorePos() {
  try {
    const p = parseFloat(localStorage.getItem(posKey(state.key)) || '0');
    if (el && p > 5 && p < (el.duration || 0) - 10) el.currentTime = p;
  } catch (_e) { /* noop */ }
}

function setMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: state.title || '리터스텔라', artist: state.subtitle || '리터스텔라', album: state.book || '',
    });
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => audio.skip(-15));
    navigator.mediaSession.setActionHandler('seekforward', () => audio.skip(15));
  } catch (_e) { /* noop */ }
}

function ensureEl() {
  if (el) return el;
  el = new Audio();
  el.preload = 'metadata';
  el.volume = state.volume;
  el.addEventListener('volumechange', () => { state.volume = el.volume; state.muted = el.muted; emit(); });
  el.addEventListener('loadedmetadata', () => {
    state.dur = el.duration || 0; state.error = '';
    if (pendingSeek != null) { el.currentTime = Math.max(0, Math.min(pendingSeek, state.dur - 1)); pendingSeek = null; }
    else restorePos();
    state.cur = el.currentTime; emit();
  });
  el.addEventListener('timeupdate', () => { state.cur = el.currentTime; savePos(); emit(); });
  el.addEventListener('play', () => { state.status = 'playing'; state.error = ''; emit(); });
  el.addEventListener('pause', () => { if (state.status !== 'idle') state.status = 'paused'; emit(); });
  el.addEventListener('ended', () => { state.status = 'paused'; state.ended = true; clearPos(); emit(); }); // ended = 끝까지 들음(스토리 끝 공유 훅) — load/play/seek에서 리셋
  el.addEventListener('waiting', () => { state.waiting = true; emit(); });
  el.addEventListener('playing', () => { state.waiting = false; emit(); });
  el.addEventListener('canplay', () => { state.waiting = false; emit(); });
  el.addEventListener('error', () => { state.waiting = false; state.status = 'paused'; state.error = '오디오를 불러오지 못했어요.'; emit(); });
  // 다른 소스(TTS·영상)가 재생을 시작하면 양보(단일 채널)
  onMediaClaim('audio', () => { if (state.status === 'playing') audio.pause(); });
  return el;
}

export const audio = {
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  snapshot() { return state; },

  // 같은 src면 아무것도 하지 않는다(이어듣기·재생 유지). 새 src면 교체.
  //   startAt: 목소리 전환 등으로 '듣던 위치'를 그대로 이어갈 때(없으면 저장된 이어듣기 위치 복원).
  load({ src, key, title, subtitle, book, reopen, startAt }) {
    if (!src) return;
    const a = ensureEl();
    if (state.src === src) { state = { ...state, title, subtitle, book, reopen: reopen || state.reopen }; emit(); return; }
    pendingSeek = (typeof startAt === 'number' && startAt > 1) ? startAt : null;
    state = { ...state, src, key: key || src, title: title || '', subtitle: subtitle || '', book: book || '', cur: 0, dur: 0, error: '', status: 'idle', ended: false, reopen: reopen || null };
    a.src = src;
    a.load();
    setMediaSession();
    emit();
  },

  play() {
    const a = ensureEl();
    claimMedia('audio');           // TTS·영상이 돌고 있으면 알아서 멈춘다
    state.ended = false;
    a.playbackRate = state.rate;
    a.play().catch(() => { state.error = '재생할 수 없어요. 네트워크를 확인해 주세요.'; emit(); });
  },
  pause() { try { el?.pause(); } catch (_e) { /* noop */ } },
  toggle() { if (state.status === 'playing') audio.pause(); else audio.play(); },
  seek(t) { const a = ensureEl(); a.currentTime = Math.max(0, Math.min(t, state.dur || 0)); state.cur = a.currentTime; state.ended = false; emit(); },
  skip(d) { audio.seek((el?.currentTime || 0) + d); },
  setRate(r) { state.rate = r; if (el) el.playbackRate = r; emit(); },
  cycleRate() { audio.setRate(RATES[(RATES.indexOf(state.rate) + 1) % RATES.length]); },
  setVolume(v) { v = Math.max(0, Math.min(1, v)); const a = ensureEl(); a.muted = false; a.volume = v; state.volume = v; state.muted = false; try { localStorage.setItem('ls_audio_vol', String(v)); } catch (_e) { /* noop */ } emit(); },
  toggleMute() { const a = ensureEl(); a.muted = !a.muted; state.muted = a.muted; emit(); },
  stop() {
    try { el?.pause(); if (el) { el.removeAttribute('src'); el.load(); } } catch (_e) { /* noop */ }
    state = { ...state, status: 'idle', src: '', key: '', title: '', subtitle: '', cur: 0, dur: 0, error: '', reopen: null };
    emit();
  },

  // 이 오디오를 표시 중인 화면 등록/해제 → 도크 필 노출 판단(유령 재생 방지)
  showSurface(id) { visibleOwners.add(id); emit(); },
  hideSurface(id) { visibleOwners.delete(id); emit(); },
};

export function useAudio() {
  return useSyncExternalStore(audio.subscribe, audio.snapshot, audio.snapshot);
}

export const fmtTime = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
export const spokenTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}분 ${s % 60}초`; };
