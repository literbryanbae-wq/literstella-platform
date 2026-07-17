// =============================================================
// mediaBus.js — 미디어 단일 채널 버스 (동시에 두 소리 금지).
//
//   ⚠️ 플레이어들은 서로 '통합'되지 않는다. 정서도 엔진도 완전히 다르다:
//     · ttsPlayer  = 기계 낭독(SpeechSynthesis). 파일이 아니라 문장을 쪼개 읽음 → 길이·탐색 개념 없음.
//     · audioPlayer = 사람 목소리 MP3(스토리 극장 낭독·강독 팟캐스트). 스크러버·이어듣기·잠금화면 있음.
//     · StreamPlayer = 강의 영상(HLS).
//
//   이 버스가 셋의 **유일한 접점**이다. 서로 직접 import 하지 않는다
//   (순환 import → 모듈 평가 TDZ → 전 앱 흰 화면 사고 이력. [[white-screen-recovery-net]])
//
//   규약: ▶ 재생을 시작할 때 claimMedia('audio'|'tts'|'video')로 "내가 소리를 쓴다"고 방송하면,
//         다른 소스들은 onMediaClaim 콜백으로 스스로 멈춘다. 대칭이라 어느 쪽을 켜도 나머지가 양보한다.
//   예외: tts.speakOnce(단어 발음 1회, ≤1초)는 claim하지 않는다 — 3분 낭독을 단어 하나 때문에 멈추는 게 더 나쁘다.
// =============================================================
const EVT = 'ls:media-claim';

/** ▶ 재생 시작 시 호출. 다른 소스는 자동으로 멈춘다. */
export function claimMedia(source) {
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: { source } })); } catch (_e) { /* noop */ }
}

/** 다른 소스가 재생을 시작하면 stop()이 호출된다. 반환값 = 해제 함수. */
export function onMediaClaim(source, stop) {
  const h = (e) => {
    const s = e?.detail?.source;
    if (s && s !== source) { try { stop(); } catch (_e) { /* noop */ } }
  };
  try { window.addEventListener(EVT, h); } catch (_e) { /* noop */ }
  return () => { try { window.removeEventListener(EVT, h); } catch (_e) { /* noop */ } };
}
